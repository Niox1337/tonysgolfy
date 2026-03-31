use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::{
    auth::SessionUser,
    models::{GuideScoreListResponse, GuideScoreRecord},
};

#[derive(Clone)]
pub struct ScoreService {
    database_path: PathBuf,
}

pub struct ScoreEntryWrite {
    pub guide_id: String,
    pub course_name: String,
    pub score: f32,
}

#[derive(Clone)]
pub struct SelectedGuideScores {
    pub course_name: String,
    pub scores: Vec<GuideScoreRecord>,
}

impl ScoreService {
    pub fn load(database_path: &Path) -> Result<Self, String> {
        let connection = Connection::open(database_path).map_err(|error| error.to_string())?;
        initialize_schema(&connection)?;

        Ok(Self {
            database_path: database_path.to_path_buf(),
        })
    }

    pub fn submit_scores(
        &self,
        user: &SessionUser,
        judge_name: &str,
        scores: &[ScoreEntryWrite],
    ) -> Result<usize, String> {
        let judge_name = judge_name.trim();
        if judge_name.is_empty() {
            return Err("评委姓名不能为空。".to_string());
        }
        if scores.is_empty() {
            return Err("至少需要提交一条球场评分。".to_string());
        }

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let created_at = Utc::now().to_rfc3339();

        for entry in scores {
            if entry.guide_id.trim().is_empty() {
                return Err("球场不能为空。".to_string());
            }
            if !entry.score.is_finite() || !(0.0..=100.0).contains(&entry.score) {
                return Err("分数需要在 0 到 100 之间。".to_string());
            }

            transaction
                .execute(
                    "
                    INSERT INTO judge_scores (
                        id, judge_name, guide_id, course_name, score, submitted_by_user_id, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    ",
                    params![
                        Uuid::new_v4().to_string(),
                        judge_name,
                        &entry.guide_id,
                        &entry.course_name,
                        entry.score,
                        &user.id,
                        &created_at
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())?;
        Ok(scores.len())
    }

    pub fn list_scores_for_guide(&self, guide_id: &str) -> Result<GuideScoreListResponse, String> {
        let connection = self.open_connection()?;
        let mut statement = connection
            .prepare(
                "
                SELECT
                    scores.id,
                    scores.guide_id,
                    scores.course_name,
                    scores.judge_name,
                    COALESCE(users.name, '未知操作人') AS operator_name,
                    scores.score,
                    scores.created_at
                FROM judge_scores AS scores
                LEFT JOIN users ON users.id = scores.submitted_by_user_id
                WHERE scores.guide_id = ?1
                ORDER BY scores.created_at DESC, scores.rowid DESC
                ",
            )
            .map_err(|error| error.to_string())?;

        let scores = statement
            .query_map(params![guide_id], |row| {
                Ok(GuideScoreRecord {
                    id: row.get(0)?,
                    guide_id: row.get(1)?,
                    course_name: row.get(2)?,
                    judge_name: row.get(3)?,
                    operator_name: row.get(4)?,
                    score: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(GuideScoreListResponse {
            guide_id: guide_id.to_string(),
            course_name: scores
                .first()
                .map(|entry| entry.course_name.clone())
                .unwrap_or_default(),
            scores,
        })
    }

    pub fn selected_scores_for_guide(
        &self,
        guide_id: &str,
        score_ids: &[String],
    ) -> Result<SelectedGuideScores, String> {
        if score_ids.is_empty() {
            return Err("至少需要选择一条评分。".to_string());
        }

        let listing = self.list_scores_for_guide(guide_id)?;
        if listing.scores.is_empty() {
            return Err("当前球场还没有评分记录。".to_string());
        }

        let selected = listing
            .scores
            .into_iter()
            .filter(|entry| score_ids.contains(&entry.id))
            .collect::<Vec<_>>();

        if selected.len() != score_ids.len() {
            return Err("选择的评分中包含无效记录，请刷新后重试。".to_string());
        }

        Ok(SelectedGuideScores {
            course_name: selected
                .first()
                .map(|entry| entry.course_name.clone())
                .unwrap_or(listing.course_name),
            scores: selected,
        })
    }

    fn open_connection(&self) -> Result<Connection, String> {
        Connection::open(&self.database_path).map_err(|error| error.to_string())
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS judge_scores (
                id TEXT PRIMARY KEY,
                judge_name TEXT NOT NULL,
                guide_id TEXT NOT NULL,
                course_name TEXT NOT NULL,
                score REAL NOT NULL,
                submitted_by_user_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_judge_scores_guide_id ON judge_scores(guide_id);
            CREATE INDEX IF NOT EXISTS idx_judge_scores_judge_name ON judge_scores(judge_name);
            CREATE INDEX IF NOT EXISTS idx_judge_scores_created_at ON judge_scores(created_at DESC);
            ",
        )
        .map_err(|error| error.to_string())
}
