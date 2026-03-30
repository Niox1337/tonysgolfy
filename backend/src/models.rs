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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Judge,
    Employee,
    Admin,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub identifier: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUserInfo {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub role: UserRole,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub authenticated: bool,
    pub user: Option<SessionUserInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRecord {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub role: UserRole,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub role: UserRole,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub role: UserRole,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MailFolder {
    Inbox,
    Sent,
    Drafts,
    Trash,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailQuery {
    pub folder: Option<MailFolder>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessage {
    pub id: String,
    pub folder: MailFolder,
    pub from_address: String,
    pub to_address: String,
    pub subject: String,
    pub body: String,
    pub is_read: bool,
    pub created_at: String,
    pub updated_at: String,
    pub sent_at: Option<String>,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxResponse {
    pub address: String,
    pub folder: MailFolder,
    pub messages: Vec<MailMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMailRequest {
    pub to: String,
    pub subject: String,
    pub body: String,
    pub reply_to_message_id: Option<String>,
    pub draft_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftRequest {
    pub draft_id: Option<String>,
    pub to: String,
    pub subject: String,
    pub body: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteMailRequest {
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DeleteMailResponse {
    pub updated: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreInput {
    pub guide_id: String,
    pub score: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitScoresRequest {
    pub judge_name: String,
    pub scores: Vec<ScoreInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitScoresResponse {
    pub submitted: usize,
}
