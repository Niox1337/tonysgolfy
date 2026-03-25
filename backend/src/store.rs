use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use uuid::Uuid;

use crate::{
    models::{GuideInput, GuideRecord, GuidesQuery, ImportResponse},
    search::{
        build_import_audits, build_travel_guide, duplicate_groups, duplicate_preview,
        filter_and_sort, fingerprint_for_record, validate_guide_input,
    },
};

pub struct GuideStore {
    guides: Vec<GuideRecord>,
    data_path: PathBuf,
}

impl GuideStore {
    pub fn load(data_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = data_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let guides = if data_path.exists() {
            let content = fs::read_to_string(&data_path).map_err(|error| error.to_string())?;
            serde_json::from_str(&content).map_err(|error| error.to_string())?
        } else {
            let guides = seed_guides();
            persist_to_path(&data_path, &guides)?;
            guides
        };

        Ok(Self { guides, data_path })
    }

    pub fn list(&self, query: &GuidesQuery) -> Vec<GuideRecord> {
        filter_and_sort(&self.guides, query)
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
            updated_at: Utc::now().to_rfc3339(),
        };

        self.guides.insert(0, guide.clone());
        self.persist()?;
        Ok(guide)
    }

    pub fn update(&mut self, id: &str, input: GuideInput) -> Result<Option<GuideRecord>, String> {
        validate_guide_input(&input)?;

        if let Some(existing) = self.guides.iter_mut().find(|guide| guide.id == id) {
            existing.course_name = input.course_name.trim().to_string();
            existing.region = input.region.trim().to_string();
            existing.course_code = input.course_code.trim().to_string();
            existing.green_fee = input.green_fee;
            existing.best_season = input.best_season.trim().to_string();
            existing.notes = input.notes.trim().to_string();
            existing.updated_at = Utc::now().to_rfc3339();

            let updated = existing.clone();
            self.persist()?;
            return Ok(Some(updated));
        }

        Ok(None)
    }

    pub fn bulk_delete(&mut self, ids: &[String]) -> Result<usize, String> {
        let before = self.guides.len();
        self.guides.retain(|guide| !ids.contains(&guide.id));
        let deleted = before.saturating_sub(self.guides.len());

        if deleted > 0 {
            self.persist()?;
        }

        Ok(deleted)
    }

    pub fn duplicate_preview(&self, input: &GuideInput) -> Result<Vec<crate::models::DuplicatePreviewMatch>, String> {
        validate_guide_input(input)?;
        Ok(duplicate_preview(&self.guides, input))
    }

    pub fn duplicate_groups(&self) -> Vec<crate::models::DuplicateGroup> {
        duplicate_groups(&self.guides)
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

        let skipped_count = audits.len().saturating_sub(inserted.len());

        for guide in inserted.iter().rev().cloned() {
            self.guides.insert(0, guide);
        }

        if !inserted.is_empty() {
            self.persist()?;
        }

        Ok(ImportResponse {
            inserted_count: inserted.len(),
            skipped_count,
            inserted,
            audits,
        })
    }

    pub fn generate_travel_guide(&self, prompt: &str, query: &GuidesQuery) -> String {
        let filtered = filter_and_sort(&self.guides, query);
        build_travel_guide(prompt, &filtered)
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
                    guide.updated_at,
                ])
                .map_err(|error| error.to_string())?;
        }

        let bytes = writer.into_inner().map_err(|error| error.to_string())?;
        String::from_utf8(bytes).map_err(|error| error.to_string())
    }

    fn persist(&self) -> Result<(), String> {
        persist_to_path(&self.data_path, &self.guides)
    }
}

fn persist_to_path(path: &Path, guides: &[GuideRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(guides).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
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
            updated_at: timestamp,
        },
    ]
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::models::{GuideInput, GuidesQuery};

    use super::GuideStore;

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("tonysgolfy-{}.json", uuid::Uuid::new_v4()))
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

        assert_eq!(store.list(&GuidesQuery::default()).len(), before + 1);

        let reloaded = GuideStore::load(path).expect("reload should succeed");
        assert!(reloaded.get(&created.id).is_some());
    }
}
