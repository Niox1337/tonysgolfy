mod auth;
mod google_ai;
mod mail;
mod models;
mod python_semantic;
mod score;
mod search;
mod store;

use std::{
    env,
    path::PathBuf,
    sync::{Arc, RwLock},
};

use auth::{AuthError, AuthService, session_info_from_user, set_cookie_header};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use google_ai::GoogleAiClient;
use mail::MailService;
use models::{
    BulkDeleteRequest, BulkDeleteResponse, CalculateCompositeScoreRequest,
    CalculateCompositeScoreResponse, ChangePasswordRequest, CreateUserRequest, DeleteMailRequest,
    DeleteMailResponse, GenerateGuideRequest, GenerateGuideResponse, GuideInput, GuideListResponse,
    GuideScoresQuery, GuideScoreListResponse, GuidesQuery, HealthResponse, ImportRequest,
    LoginRequest, MailQuery, MailboxResponse, SaveDraftRequest, SendMailRequest, SessionResponse,
    SubmitScoresRequest, SubmitScoresResponse, UpdateUserRequest,
};
use python_semantic::rank_guides;
use score::{ScoreEntryWrite, ScoreService};
use search::{filter_region, sort_semantic_guides};
use store::GuideStore;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    store: Arc<RwLock<GuideStore>>,
    google_ai: GoogleAiClient,
    auth: AuthService,
    mail: MailService,
    scores: ScoreService,
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

type AppResult<T> = Result<T, AppError>;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let database_path = database_path();
    let store = GuideStore::load(database_path.clone()).expect("failed to initialize guide store");
    let google_ai =
        GoogleAiClient::from_env().expect("failed to initialize Google AI Studio client");
    let auth = AuthService::load(&database_path).expect("failed to initialize auth service");
    let mail = MailService::load(&database_path).expect("failed to initialize mail service");
    let scores = ScoreService::load(&database_path).expect("failed to initialize score service");
    let state = AppState {
        store: Arc::new(RwLock::new(store)),
        google_ai,
        auth,
        mail,
        scores,
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/session", get(get_session))
        .route("/api/auth/change-password", post(change_password))
        .route("/api/mail", get(list_mailbox))
        .route("/api/mail/send", post(send_mail))
        .route("/api/mail/draft", post(save_draft))
        .route("/api/mail/delete", post(delete_mail))
        .route("/api/scores", post(submit_scores))
        .route("/api/scores/by-guide", get(list_scores_for_guide))
        .route("/api/guides/composite-score", post(calculate_composite_score))
        .route("/api/users", get(list_users).post(create_user))
        .route("/api/users/{id}", put(update_user))
        .route("/api/users/{id}/deactivate", post(deactivate_user))
        .route("/api/guides", get(list_guides).post(create_guide))
        .route("/api/guides/export.csv", get(export_guides))
        .route("/api/guides/duplicates", get(list_duplicate_groups))
        .route("/api/guides/duplicate-preview", post(preview_duplicates))
        .route("/api/guides/import", post(import_guides))
        .route("/api/guides/generate", post(generate_travel_guide))
        .route("/api/guides/bulk-delete", delete(bulk_delete_guides))
        .route("/api/guides/{id}", get(get_guide).put(update_guide))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    let bind_addr = bind_addr();
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind backend listener");

    println!("tonysgolfy backend listening on http://{bind_addr}");
    axum::serve(listener, app)
        .await
        .expect("backend server failed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> AppResult<(HeaderMap, Json<SessionResponse>)> {
    let (user, cookie) = state
        .auth
        .login(&headers, &request.identifier, &request.password)
        .map_err(auth_error)?;
    let mut headers = HeaderMap::new();
    set_cookie_header(&mut headers, cookie);

    Ok((
        headers,
        Json(SessionResponse {
            authenticated: true,
            user: Some(session_info_from_user(user)),
        }),
    ))
}

async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<(HeaderMap, Json<SessionResponse>)> {
    let cookie = state.auth.logout(&headers).map_err(internal_error_from)?;
    let mut response_headers = HeaderMap::new();
    set_cookie_header(&mut response_headers, cookie);

    Ok((
        response_headers,
        Json(SessionResponse {
            authenticated: false,
            user: None,
        }),
    ))
}

async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<SessionResponse>> {
    let user = state
        .auth
        .current_user(&headers)
        .map_err(internal_error_from)?;

    Ok(Json(SessionResponse {
        authenticated: user.is_some(),
        user: user.map(session_info_from_user),
    }))
}

async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ChangePasswordRequest>,
) -> AppResult<StatusCode> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    state
        .auth
        .change_password(&user.id, &request.current_password, &request.new_password)
        .map_err(auth_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_mailbox(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MailQuery>,
) -> AppResult<Json<MailboxResponse>> {
    let user = state.auth.require_mail_user(&headers).map_err(auth_error)?;
    let response = state
        .mail
        .list_mailbox(&user, query.folder.unwrap_or(models::MailFolder::Inbox))
        .map_err(internal_error_from)?;
    Ok(Json(response))
}

async fn send_mail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SendMailRequest>,
) -> AppResult<Json<MailboxResponse>> {
    let user = state.auth.require_mail_user(&headers).map_err(auth_error)?;
    let response = state.mail.send_mail(&user, request).map_err(bad_request)?;
    Ok(Json(response))
}

async fn save_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SaveDraftRequest>,
) -> AppResult<Json<MailboxResponse>> {
    let user = state.auth.require_mail_user(&headers).map_err(auth_error)?;
    let response = state.mail.save_draft(&user, request).map_err(bad_request)?;
    Ok(Json(response))
}

async fn delete_mail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DeleteMailRequest>,
) -> AppResult<Json<DeleteMailResponse>> {
    let user = state.auth.require_mail_user(&headers).map_err(auth_error)?;
    let response = state.mail.delete_messages(&user, &request.ids).map_err(internal_error_from)?;
    Ok(Json(response))
}

async fn submit_scores(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SubmitScoresRequest>,
) -> AppResult<Json<SubmitScoresResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;

    let judge_name = if matches!(user.role, models::UserRole::Judge) {
        user.name.clone()
    } else {
        request.judge_name.trim().to_string()
    };

    if judge_name.is_empty() {
        return Err(bad_request("评委姓名不能为空。".to_string()));
    }

    let resolved_scores = {
        let store = state
            .store
            .read()
            .map_err(|_| internal_error("failed to read guide store"))?;
        let mut seen = std::collections::HashSet::new();
        let mut resolved = Vec::with_capacity(request.scores.len());

        for entry in request.scores {
            if !seen.insert(entry.guide_id.clone()) {
                return Err(bad_request("同一批提交里不能重复选择同一个球场。".to_string()));
            }

            let guide = store.get(&entry.guide_id).ok_or_else(|| {
                bad_request("提交中包含不存在的球场，请重新选择。".to_string())
            })?;

            resolved.push(ScoreEntryWrite {
                guide_id: guide.id,
                course_name: guide.course_name,
                score: entry.score,
            });
        }

        resolved
    };

    let submitted = state
        .scores
        .submit_scores(&user, &judge_name, &resolved_scores)
        .map_err(bad_request)?;

    Ok(Json(SubmitScoresResponse { submitted }))
}

async fn list_scores_for_guide(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GuideScoresQuery>,
) -> AppResult<Json<GuideScoreListResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号只能进入球场评分页面。".to_string()));
    }
    let response = state
        .scores
        .list_scores_for_guide(&query.guide_id)
        .map_err(internal_error_from)?;
    Ok(Json(response))
}

async fn calculate_composite_score(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CalculateCompositeScoreRequest>,
) -> AppResult<Json<CalculateCompositeScoreResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号只能进入球场评分页面。".to_string()));
    }

    let selected = state
        .scores
        .selected_scores_for_guide(&request.guide_id, &request.score_ids)
        .map_err(bad_request)?;

    let calculated = match request.method {
        models::CompositeScoreMethod::Equal => {
            let total = selected.scores.iter().map(|entry| entry.score).sum::<f64>();
            total / selected.scores.len() as f64
        }
        models::CompositeScoreMethod::Weighted => {
            let weights = request
                .weights
                .ok_or_else(|| bad_request("加权评分需要提供每条评分的权重。".to_string()))?;

            if weights.len() != selected.scores.len() {
                return Err(bad_request("每条选中评分都需要对应一个权重。".to_string()));
            }

            let mut by_id = std::collections::HashMap::new();
            let mut weight_sum = 0.0_f64;
            for weight in weights {
                if !weight.weight.is_finite() || weight.weight < 0.0 {
                    return Err(bad_request("权重必须是非负数字。".to_string()));
                }
                weight_sum += weight.weight;
                by_id.insert(weight.score_id, weight.weight);
            }

            if (weight_sum - 1.0).abs() > 0.000001 {
                return Err(bad_request("权重之和必须等于 1.0。".to_string()));
            }

            let mut total = 0.0_f64;
            for entry in &selected.scores {
                let weight = by_id
                    .get(&entry.id)
                    .ok_or_else(|| bad_request("权重和选中评分不匹配。".to_string()))?;
                total += entry.score * weight;
            }
            total
        }
        models::CompositeScoreMethod::Ai => {
            let prompt = request
                .ai_prompt
                .ok_or_else(|| bad_request("AI 计算需要提供说明文字。".to_string()))?;
            if prompt.trim().is_empty() {
                return Err(bad_request("AI 计算说明不能为空。".to_string()));
            }

            state
                .google_ai
                .calculate_composite_score(&selected.course_name, &prompt, &selected.scores)
                .await
                .map_err(internal_error_from)?
        }
    };

    let rounded = (calculated * 100.0).round() / 100.0;
    let guide = {
        let mut store = state
            .store
            .write()
            .map_err(|_| internal_error("failed to write guide store"))?;
        store
            .set_composite_score(&request.guide_id, Some(rounded))
            .map_err(internal_error_from)?
            .ok_or_else(|| bad_request("球场不存在。".to_string()))?
    };

    Ok(Json(CalculateCompositeScoreResponse {
        guide,
        used_scores: selected.scores,
        calculated_score: rounded,
        method: match request.method {
            models::CompositeScoreMethod::Equal => "equal",
            models::CompositeScoreMethod::Weighted => "weighted",
            models::CompositeScoreMethod::Ai => "ai",
        },
    }))
}

async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<models::UserRecord>>> {
    state.auth.require_admin(&headers).map_err(auth_error)?;
    let users = state.auth.list_users().map_err(internal_error_from)?;
    Ok(Json(users))
}

async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateUserRequest>,
) -> AppResult<(StatusCode, Json<models::UserRecord>)> {
    state.auth.require_admin(&headers).map_err(auth_error)?;
    let user = state
        .auth
        .create_user(
            request.name,
            request.phone,
            request.email,
            request.role,
            request.password,
        )
        .map_err(auth_error)?;
    Ok((StatusCode::CREATED, Json(user)))
}

async fn update_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<UpdateUserRequest>,
) -> AppResult<Json<models::UserRecord>> {
    state.auth.require_admin(&headers).map_err(auth_error)?;
    let user = state
        .auth
        .update_user(
            &id,
            request.name,
            request.phone,
            request.email,
            request.role,
        )
        .map_err(auth_error)?;
    Ok(Json(user))
}

async fn deactivate_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<models::UserRecord>> {
    let admin = state.auth.require_admin(&headers).map_err(auth_error)?;
    let user = state
        .auth
        .deactivate_user(&admin.id, &id)
        .map_err(auth_error)?;
    Ok(Json(user))
}

async fn list_guides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GuidesQuery>,
) -> AppResult<Json<GuideListResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号只能进入球场评分页面。".to_string()));
    }
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    let guides = list_guides_with_semantic_support(&store, &query).map_err(internal_error_from)?;
    let total = guides.len();

    Ok(Json(GuideListResponse { guides, total }))
}

async fn get_guide(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<models::GuideRecord>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号只能进入球场评分页面。".to_string()));
    }
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;

    let guide = store.get(&id).ok_or_else(|| AppError {
        status: StatusCode::NOT_FOUND,
        message: format!("guide {} not found", id),
    })?;

    Ok(Json(guide))
}

async fn create_guide(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<GuideInput>,
) -> AppResult<(StatusCode, Json<models::GuideRecord>)> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能修改球场数据。".to_string()));
    }
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;

    let created = store.create(input).map_err(bad_request)?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn update_guide(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<GuideInput>,
) -> AppResult<Json<models::GuideRecord>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能修改球场数据。".to_string()));
    }
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;

    let updated = store
        .update(&id, input)
        .map_err(bad_request)?
        .ok_or_else(|| AppError {
            status: StatusCode::NOT_FOUND,
            message: format!("guide {} not found", id),
        })?;

    Ok(Json(updated))
}

async fn bulk_delete_guides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<BulkDeleteRequest>,
) -> AppResult<Json<BulkDeleteResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能删除球场数据。".to_string()));
    }
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;
    let deleted = store
        .bulk_delete(&request.ids)
        .map_err(internal_error_from)?;

    Ok(Json(BulkDeleteResponse { deleted }))
}

async fn preview_duplicates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<GuideInput>,
) -> AppResult<Json<Vec<models::DuplicatePreviewMatch>>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能访问球场编辑功能。".to_string()));
    }
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    let preview = store.duplicate_preview(&input).map_err(bad_request)?;
    Ok(Json(preview))
}

async fn list_duplicate_groups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<models::DuplicateGroup>>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能访问球场编辑功能。".to_string()));
    }
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    Ok(Json(store.duplicate_groups()))
}

async fn import_guides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ImportRequest>,
) -> AppResult<Json<models::ImportResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能导入球场数据。".to_string()));
    }
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;
    let response = store.import_guides(request.guides).map_err(bad_request)?;
    Ok(Json(response))
}

async fn generate_travel_guide(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<GenerateGuideRequest>,
) -> AppResult<Json<GenerateGuideResponse>> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能访问球场攻略工作台。".to_string()));
    }
    let query = GuidesQuery {
        search: request.search,
        search_mode: request.search_mode,
        region: request.region,
        sort: request.sort,
    };
    let filtered_guides = {
        let store = state
            .store
            .read()
            .map_err(|_| internal_error("failed to read guide store"))?;
        list_guides_with_semantic_support(&store, &query).map_err(internal_error_from)?
    };
    let guide = state
        .google_ai
        .generate_travel_guide(&request.prompt, &filtered_guides)
        .await
        .map_err(internal_error_from)?;
    Ok(Json(GenerateGuideResponse { guide }))
}

async fn export_guides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GuidesQuery>,
) -> AppResult<Response> {
    let user = state.auth.require_user(&headers).map_err(unauthorized)?;
    if matches!(user.role, models::UserRole::Judge) {
        return Err(forbidden("评委账号不能导出球场数据。".to_string()));
    }
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    let csv = store.export_csv(&query).map_err(internal_error_from)?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"tonysgolfy-guides.csv\""),
    );

    Ok((headers, csv).into_response())
}

fn database_path() -> PathBuf {
    if let Ok(path) = env::var("DATABASE_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
        .join("guides.sqlite")
}

fn bind_addr() -> String {
    let host = env::var("APP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("APP_PORT").unwrap_or_else(|_| "3000".to_string());
    format!("{host}:{port}")
}

fn bad_request(message: String) -> AppError {
    AppError {
        status: StatusCode::BAD_REQUEST,
        message,
    }
}

fn unauthorized(message: String) -> AppError {
    AppError {
        status: StatusCode::UNAUTHORIZED,
        message,
    }
}

fn forbidden(message: String) -> AppError {
    AppError {
        status: StatusCode::FORBIDDEN,
        message,
    }
}

fn too_many_requests(message: String) -> AppError {
    AppError {
        status: StatusCode::TOO_MANY_REQUESTS,
        message,
    }
}

fn auth_error(error: AuthError) -> AppError {
    match error {
        AuthError::Unauthorized(message) => unauthorized(message),
        AuthError::Forbidden(message) => forbidden(message),
        AuthError::TooManyRequests(message) => too_many_requests(message),
        AuthError::BadRequest(message) => bad_request(message),
        AuthError::Internal(message) => internal_error_from(message),
    }
}

fn internal_error(message: &str) -> AppError {
    AppError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: message.to_string(),
    }
}

fn internal_error_from(message: String) -> AppError {
    AppError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message,
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "error": self.message,
            })),
        )
            .into_response()
    }
}

fn list_guides_with_semantic_support(
    store: &GuideStore,
    query: &GuidesQuery,
) -> Result<Vec<models::GuideRecord>, String> {
    let search = query.search.as_deref().unwrap_or_default().trim();

    if search.is_empty()
        || !matches!(
            query.search_mode.unwrap_or_default(),
            models::SearchMode::Semantic
        )
    {
        return Ok(store.list(query));
    }

    let filtered = filter_region(&store.all(), query.region.as_deref());
    let ranked = rank_guides(search, &filtered, 0.35)?;

    let by_id = filtered
        .into_iter()
        .map(|guide| (guide.id.clone(), guide))
        .collect::<std::collections::HashMap<_, _>>();

    let mut guides = ranked
        .into_iter()
        .filter_map(|entry| {
            by_id
                .get(&entry.id)
                .cloned()
                .map(|guide| (guide, entry.score))
        })
        .collect::<Vec<_>>();

    sort_semantic_guides(&mut guides, query.sort.unwrap_or_default());

    Ok(guides.into_iter().map(|(guide, _)| guide).collect())
}
