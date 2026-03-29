use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideRecord {
    pub id: String,
    pub course_name: String,
    pub region: String,
    pub course_code: String,
    pub green_fee: u32,
    pub best_season: String,
    pub notes: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideInput {
    pub course_name: String,
    pub region: String,
    pub course_code: String,
    pub green_fee: u32,
    pub best_season: String,
    pub notes: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GuidesQuery {
    pub search: Option<String>,
    pub search_mode: Option<SearchMode>,
    pub region: Option<String>,
    pub sort: Option<SortMode>,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    #[default]
    Keyword,
    Semantic,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
pub enum SortMode {
    #[serde(rename = "updated-desc")]
    #[default]
    UpdatedDesc,
    #[serde(rename = "updated-asc")]
    UpdatedAsc,
    #[serde(rename = "fee-desc")]
    FeeDesc,
    #[serde(rename = "fee-asc")]
    FeeAsc,
    #[serde(rename = "name-asc")]
    NameAsc,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideListResponse {
    pub guides: Vec<GuideRecord>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePreviewMatch {
    pub guide: GuideRecord,
    pub exact: bool,
    pub score: f32,
}

#[derive(Debug, Serialize)]
pub struct DuplicateGroup {
    pub key: String,
    pub items: Vec<GuideRecord>,
}

#[derive(Debug, Deserialize)]
pub struct BulkDeleteRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BulkDeleteResponse {
    pub deleted: usize,
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub guides: Vec<GuideInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAudit {
    pub id: String,
    pub course_name: String,
    pub course_code: String,
    pub region: String,
    pub exact_matches: usize,
    pub similar_matches: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResponse {
    pub inserted: Vec<GuideRecord>,
    pub audits: Vec<ImportAudit>,
    pub inserted_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateGuideRequest {
    pub prompt: String,
    pub search: Option<String>,
    pub search_mode: Option<SearchMode>,
    pub region: Option<String>,
    pub sort: Option<SortMode>,
}

#[derive(Debug, Serialize)]
pub struct GenerateGuideResponse {
    pub guide: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub authenticated: bool,
    pub username: Option<String>,
}
