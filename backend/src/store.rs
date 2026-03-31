use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{Connection, params};
use uuid::Uuid;

use crate::{
    models::{GuideInput, GuideRecord, GuidesQuery, ImportResponse},
    search::{
        build_import_audits, duplicate_groups, duplicate_preview, filter_and_sort,
        fingerprint_for_record, validate_guide_input,
    },
};

pub struct GuideStore {
    guides: Vec<GuideRecord>,
    database_path: PathBuf,
}

impl GuideStore {
    pub fn load(database_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let database_exists = database_path.exists();
        let mut connection = open_database(&database_path)?;
        initialize_schema(&connection)?;

        let guides = if database_exists {
            let loaded = load_guides(&connection)?;
            if loaded.is_empty() {
                let seeded = seed_guides();
                insert_guides(&mut connection, &seeded)?;
                seeded
            } else {
                loaded
            }
        } else {
            let initial_guides = load_legacy_guides(&database_path)?.unwrap_or_else(seed_guides);
            insert_guides(&mut connection, &initial_guides)?;
            initial_guides
        };

        Ok(Self {
            guides,
            database_path,
        })
    }

    pub fn list(&self, query: &GuidesQuery) -> Vec<GuideRecord> {
        filter_and_sort(&self.guides, query)
    }

    pub fn all(&self) -> Vec<GuideRecord> {
        self.guides.clone()
    }

    pub fn get(&self, id: &str) -> Option<GuideRecord> {
        self.guides.iter().find(|guide| guide.id == id).cloned()
    }

    pub fn create(&mut self, input: GuideInput) -> Result<GuideRecord, String> {
        validate_guide_input(&input)?;

        let guide = GuideRecord {
            id: Uuid::new_v4().to_string(),
            course_name: input.course_name.trim().to_string(),
            region: input.region.trim().to_string(),
            course_code: input.course_code.trim().to_string(),
            green_fee: input.green_fee,
            best_season: input.best_season.trim().to_string(),
            notes: input.notes.trim().to_string(),
            composite_score: None,
            updated_at: Utc::now().to_rfc3339(),
        };

        let mut connection = open_database(&self.database_path)?;
        insert_guides(&mut connection, std::slice::from_ref(&guide))?;

        self.guides.insert(0, guide.clone());
        Ok(guide)
    }

    pub fn update(&mut self, id: &str, input: GuideInput) -> Result<Option<GuideRecord>, String> {
        validate_guide_input(&input)?;

        let Some(index) = self.guides.iter().position(|guide| guide.id == id) else {
            return Ok(None);
        };

        let mut updated = self.guides[index].clone();
        updated.course_name = input.course_name.trim().to_string();
        updated.region = input.region.trim().to_string();
        updated.course_code = input.course_code.trim().to_string();
        updated.green_fee = input.green_fee;
        updated.best_season = input.best_season.trim().to_string();
        updated.notes = input.notes.trim().to_string();
        updated.updated_at = Utc::now().to_rfc3339();

        let connection = open_database(&self.database_path)?;
        update_guide_row(&connection, &updated)?;

        self.guides[index] = updated.clone();
        Ok(Some(updated))
    }

    pub fn bulk_delete(&mut self, ids: &[String]) -> Result<usize, String> {
        let before = self.guides.len();
        let ids_to_delete = ids
            .iter()
            .filter(|id| self.guides.iter().any(|guide| &guide.id == *id))
            .cloned()
            .collect::<Vec<_>>();

        if ids_to_delete.is_empty() {
            return Ok(0);
        }

        let connection = open_database(&self.database_path)?;
        delete_guides_by_ids(&connection, &ids_to_delete)?;

        self.guides
            .retain(|guide| !ids_to_delete.contains(&guide.id));
        Ok(before.saturating_sub(self.guides.len()))
    }

    pub fn duplicate_preview(
        &self,
        input: &GuideInput,
    ) -> Result<Vec<crate::models::DuplicatePreviewMatch>, String> {
        validate_guide_input(input)?;
        Ok(duplicate_preview(&self.guides, input))
    }

    pub fn duplicate_groups(&self) -> Vec<crate::models::DuplicateGroup> {
        duplicate_groups(&self.guides)
    }

    pub fn set_composite_score(
        &mut self,
        id: &str,
        composite_score: Option<f64>,
    ) -> Result<Option<GuideRecord>, String> {
        let Some(index) = self.guides.iter().position(|guide| guide.id == id) else {
            return Ok(None);
        };

        let mut updated = self.guides[index].clone();
        updated.composite_score = composite_score;
        updated.updated_at = Utc::now().to_rfc3339();

        let connection = open_database(&self.database_path)?;
        update_guide_row(&connection, &updated)?;

        self.guides[index] = updated.clone();
        Ok(Some(updated))
    }

    pub fn import_guides(&mut self, inputs: Vec<GuideInput>) -> Result<ImportResponse, String> {
        for input in &inputs {
            validate_guide_input(input)?;
        }

        let imported = inputs
            .into_iter()
            .map(|input| GuideRecord {
                id: Uuid::new_v4().to_string(),
                course_name: input.course_name.trim().to_string(),
                region: input.region.trim().to_string(),
                course_code: input.course_code.trim().to_string(),
                green_fee: input.green_fee,
                best_season: input.best_season.trim().to_string(),
                notes: input.notes.trim().to_string(),
                composite_score: None,
                updated_at: Utc::now().to_rfc3339(),
            })
            .collect::<Vec<_>>();

        let audits = build_import_audits(&self.guides, &imported);
        let existing_fingerprints = self
            .guides
            .iter()
            .map(fingerprint_for_record)
            .collect::<Vec<_>>();

        let inserted = imported
            .into_iter()
            .filter(|guide| !existing_fingerprints.contains(&fingerprint_for_record(guide)))
            .collect::<Vec<_>>();

        if !inserted.is_empty() {
            let mut connection = open_database(&self.database_path)?;
            insert_guides(&mut connection, &inserted)?;

            for guide in inserted.iter().rev().cloned() {
                self.guides.insert(0, guide);
            }
        }

        let skipped_count = audits.len().saturating_sub(inserted.len());

        Ok(ImportResponse {
            inserted_count: inserted.len(),
            skipped_count,
            inserted,
            audits,
        })
    }

    pub fn export_csv(&self, query: &GuidesQuery) -> Result<String, String> {
        let guides = filter_and_sort(&self.guides, query);
        let mut writer = csv::Writer::from_writer(Vec::new());

        writer
            .write_record([
                "courseName",
                "region",
                "courseCode",
                "greenFee",
                "bestSeason",
                "notes",
                "compositeScore",
                "updatedAt",
            ])
            .map_err(|error| error.to_string())?;

        for guide in guides {
            writer
                .write_record([
                    guide.course_name,
                    guide.region,
                    guide.course_code,
                    guide.green_fee.to_string(),
                    guide.best_season,
                    guide.notes,
                    guide.composite_score
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    guide.updated_at,
                ])
                .map_err(|error| error.to_string())?;
        }

        let bytes = writer.into_inner().map_err(|error| error.to_string())?;
        String::from_utf8(bytes).map_err(|error| error.to_string())
    }
}

fn open_database(path: &Path) -> Result<Connection, String> {
    Connection::open(path).map_err(|error| error.to_string())
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS guides (
                id TEXT PRIMARY KEY,
                course_name TEXT NOT NULL,
                region TEXT NOT NULL,
                course_code TEXT NOT NULL,
                green_fee INTEGER NOT NULL,
                best_season TEXT NOT NULL,
                notes TEXT NOT NULL,
                composite_score REAL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_guides_region ON guides(region);
            CREATE INDEX IF NOT EXISTS idx_guides_updated_at ON guides(updated_at);
            ",
        )
        .map_err(|error| error.to_string())?;

    ensure_column(connection, "guides", "composite_score", "REAL")
}

fn load_guides(connection: &Connection) -> Result<Vec<GuideRecord>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, course_name, region, course_code, green_fee, best_season, notes, composite_score, updated_at
            FROM guides
            ORDER BY updated_at DESC, rowid DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(GuideRecord {
                id: row.get(0)?,
                course_name: row.get(1)?,
                region: row.get(2)?,
                course_code: row.get(3)?,
                green_fee: row.get(4)?,
                best_season: row.get(5)?,
                notes: row.get(6)?,
                composite_score: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn insert_guides(connection: &mut Connection, guides: &[GuideRecord]) -> Result<(), String> {
    if guides.is_empty() {
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    {
        let mut statement = transaction
            .prepare(
                "
                INSERT INTO guides (
                    id, course_name, region, course_code, green_fee, best_season, notes, composite_score, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ",
            )
            .map_err(|error| error.to_string())?;

        for guide in guides {
            statement
                .execute(params![
                    &guide.id,
                    &guide.course_name,
                    &guide.region,
                    &guide.course_code,
                    guide.green_fee,
                    &guide.best_season,
                    &guide.notes,
                    &guide.composite_score,
                    &guide.updated_at
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn update_guide_row(connection: &Connection, guide: &GuideRecord) -> Result<(), String> {
    connection
        .execute(
            "
            UPDATE guides
            SET course_name = ?2,
                region = ?3,
                course_code = ?4,
                green_fee = ?5,
                best_season = ?6,
                notes = ?7,
                composite_score = ?8,
                updated_at = ?9
            WHERE id = ?1
            ",
            params![
                &guide.id,
                &guide.course_name,
                &guide.region,
                &guide.course_code,
                guide.green_fee,
                &guide.best_season,
                &guide.notes,
                &guide.composite_score,
                &guide.updated_at
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn delete_guides_by_ids(connection: &Connection, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }

    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("DELETE FROM guides WHERE id IN ({placeholders})");
    let params = rusqlite::params_from_iter(ids.iter());

    connection
        .execute(&sql, params)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn seed_guides() -> Vec<GuideRecord> {
    let timestamp = Utc::now().to_rfc3339();

    vec![
        GuideRecord {
            id: Uuid::new_v4().to_string(),
            course_name: "Mission Hills Blackstone".to_string(),
            region: "Shenzhen, China".to_string(),
            course_code: "CN-SZX-BLK".to_string(),
            green_fee: 2380,
            best_season: "October to December".to_string(),
            notes: "适合安排 2 天游玩，球场维护优秀，建议住度假酒店。".to_string(),
            composite_score: None,
            updated_at: timestamp.clone(),
        },
        GuideRecord {
            id: Uuid::new_v4().to_string(),
            course_name: "Sentosa Serapong".to_string(),
            region: "Singapore".to_string(),
            course_code: "SG-SEN-SRP".to_string(),
            green_fee: 3100,
            best_season: "February to April".to_string(),
            notes: "适合城市高尔夫短途，夜间餐厅选择多，机场交通方便。".to_string(),
            composite_score: None,
            updated_at: timestamp.clone(),
        },
        GuideRecord {
            id: Uuid::new_v4().to_string(),
            course_name: "Cape Kidnappers".to_string(),
            region: "Hawke’s Bay, New Zealand".to_string(),
            course_code: "NZ-HKB-CPK".to_string(),
            green_fee: 4200,
            best_season: "November to March".to_string(),
            notes: "悬崖海景极强，适合做高端目的地专题，建议自驾。".to_string(),
            composite_score: None,
            updated_at: timestamp.clone(),
        },
        GuideRecord {
            id: Uuid::new_v4().to_string(),
            course_name: "Mission Hills Blackstone".to_string(),
            region: "Shenzhen, China".to_string(),
            course_code: "CN-SZX-BLK".to_string(),
            green_fee: 2280,
            best_season: "October to December".to_string(),
            notes: "重复样例，用于演示球场攻略去重审计。".to_string(),
            composite_score: None,
            updated_at: timestamp,
        },
    ]
}

fn load_legacy_guides(database_path: &Path) -> Result<Option<Vec<GuideRecord>>, String> {
    let Some(parent) = database_path.parent() else {
        return Ok(None);
    };

    let legacy_path = parent.join("guides.json");
    if !legacy_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(legacy_path).map_err(|error| error.to_string())?;
    let guides = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(Some(guides))
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&pragma)
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    if columns.iter().any(|existing| existing == column_name) {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use crate::models::{GuideInput, GuidesQuery};

    use super::GuideStore;

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("tonysgolfy-{}.db", uuid::Uuid::new_v4()))
    }

    #[test]
    fn create_and_reload_round_trip() {
        let path = temp_path();
        let mut store = GuideStore::load(path.clone()).expect("store should load");
        let before = store.list(&GuidesQuery::default()).len();

        let created = store
            .create(GuideInput {
                course_name: "Test Course".to_string(),
                region: "Tokyo".to_string(),
                course_code: "JP-TKO-TST".to_string(),
                green_fee: 1800,
                best_season: "April".to_string(),
                notes: "test".to_string(),
            })
            .expect("create should succeed");

        assert!(path.exists());
        assert_eq!(store.list(&GuidesQuery::default()).len(), before + 1);

        let reloaded = GuideStore::load(path.clone()).expect("reload should succeed");
        assert!(reloaded.get(&created.id).is_some());

        let _ = fs::remove_file(path);
    }
}
