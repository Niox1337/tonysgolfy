mod auth;
mod google_ai;
mod mail;
mod models;
mod python_semantic;
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
    BulkDeleteRequest, BulkDeleteResponse, ChangePasswordRequest, CreateUserRequest,
    DeleteMailRequest, DeleteMailResponse, GenerateGuideRequest, GenerateGuideResponse, GuideInput,
    GuideListResponse, GuidesQuery, HealthResponse, ImportRequest, LoginRequest, MailQuery,
    MailboxResponse, SaveDraftRequest, SendMailRequest, SessionResponse, UpdateUserRequest,
};
use python_semantic::rank_guides;
use search::{filter_region, sort_semantic_guides};
use store::GuideStore;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    store: Arc<RwLock<GuideStore>>,
    google_ai: GoogleAiClient,
    auth: AuthService,
    mail: MailService,
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
    let state = AppState {
        store: Arc::new(RwLock::new(store)),
        google_ai,
        auth,
        mail,
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
    state.auth.require_user(&headers).map_err(unauthorized)?;
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
