mod models;
mod python_semantic;
mod search;
mod store;

use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

use axum::{
    extract::{Path, Query, State},
    http::{
        header::{CONTENT_DISPOSITION, CONTENT_TYPE},
        HeaderMap, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use models::{
    BulkDeleteRequest, BulkDeleteResponse, GenerateGuideRequest, GenerateGuideResponse,
    GuideInput, GuideListResponse, GuidesQuery, HealthResponse, ImportRequest,
};
use python_semantic::rank_guides;
use search::{filter_and_sort, filter_region, sort_guides, sort_semantic_guides};
use store::GuideStore;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    store: Arc<RwLock<GuideStore>>,
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

type AppResult<T> = Result<T, AppError>;

#[tokio::main]
async fn main() {
    let data_path = data_path();
    let store = GuideStore::load(data_path).expect("failed to initialize guide store");
    let state = AppState {
        store: Arc::new(RwLock::new(store)),
    };

    let app = Router::new()
        .route("/api/health", get(health))
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

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("failed to bind backend listener");

    println!("tonysgolfy backend listening on http://localhost:3000");
    axum::serve(listener, app).await.expect("backend server failed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn list_guides(
    State(state): State<AppState>,
    Query(query): Query<GuidesQuery>,
) -> AppResult<Json<GuideListResponse>> {
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
    Path(id): Path<String>,
) -> AppResult<Json<models::GuideRecord>> {
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
    Json(input): Json<GuideInput>,
) -> AppResult<(StatusCode, Json<models::GuideRecord>)> {
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;

    let created = store.create(input).map_err(bad_request)?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn update_guide(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<GuideInput>,
) -> AppResult<Json<models::GuideRecord>> {
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;

    let updated = store.update(&id, input).map_err(bad_request)?.ok_or_else(|| AppError {
        status: StatusCode::NOT_FOUND,
        message: format!("guide {} not found", id),
    })?;

    Ok(Json(updated))
}

async fn bulk_delete_guides(
    State(state): State<AppState>,
    Json(request): Json<BulkDeleteRequest>,
) -> AppResult<Json<BulkDeleteResponse>> {
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;
    let deleted = store.bulk_delete(&request.ids).map_err(internal_error_from)?;

    Ok(Json(BulkDeleteResponse { deleted }))
}

async fn preview_duplicates(
    State(state): State<AppState>,
    Json(input): Json<GuideInput>,
) -> AppResult<Json<Vec<models::DuplicatePreviewMatch>>> {
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    let preview = store.duplicate_preview(&input).map_err(bad_request)?;
    Ok(Json(preview))
}

async fn list_duplicate_groups(State(state): State<AppState>) -> AppResult<Json<Vec<models::DuplicateGroup>>> {
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    Ok(Json(store.duplicate_groups()))
}

async fn import_guides(
    State(state): State<AppState>,
    Json(request): Json<ImportRequest>,
) -> AppResult<Json<models::ImportResponse>> {
    let mut store = state
        .store
        .write()
        .map_err(|_| internal_error("failed to write guide store"))?;
    let response = store.import_guides(request.guides).map_err(bad_request)?;
    Ok(Json(response))
}

async fn generate_travel_guide(
    State(state): State<AppState>,
    Json(request): Json<GenerateGuideRequest>,
) -> AppResult<Json<GenerateGuideResponse>> {
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;

    let query = GuidesQuery {
        search: request.search,
        search_mode: request.search_mode,
        region: request.region,
        sort: request.sort,
    };
    let filtered_guides =
        list_guides_with_semantic_support(&store, &query).map_err(internal_error_from)?;
    let guide = build_travel_guide_with_semantic_support(&request.prompt, &filtered_guides);
    Ok(Json(GenerateGuideResponse { guide }))
}

async fn export_guides(
    State(state): State<AppState>,
    Query(query): Query<GuidesQuery>,
) -> AppResult<Response> {
    let store = state
        .store
        .read()
        .map_err(|_| internal_error("failed to read guide store"))?;
    let csv = store.export_csv(&query).map_err(internal_error_from)?;

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"));
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"tonysgolfy-guides.csv\""),
    );

    Ok((headers, csv).into_response())
}

fn data_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
        .join("guides.json")
}

fn bad_request(message: String) -> AppError {
    AppError {
        status: StatusCode::BAD_REQUEST,
        message,
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

    if search.is_empty() || !matches!(query.search_mode.unwrap_or_default(), models::SearchMode::Semantic) {
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
        .filter_map(|entry| by_id.get(&entry.id).cloned().map(|guide| (guide, entry.score)))
        .collect::<Vec<_>>();

    sort_semantic_guides(&mut guides, query.sort.unwrap_or_default());

    Ok(guides.into_iter().map(|(guide, _)| guide).collect())
}

fn build_travel_guide_with_semantic_support(prompt: &str, records: &[models::GuideRecord]) -> String {
    if prompt.trim().is_empty() {
        return "输入你的旅行偏好，例如“海景球场、适合 3 天行程、预算 3000 内”，系统会基于当前球场库生成一段攻略建议。".to_string();
    }

    match rank_guides(prompt, records, 0.0) {
        Ok(ranked) => {
            let by_id = records
                .iter()
                .cloned()
                .map(|guide| (guide.id.clone(), guide))
                .collect::<std::collections::HashMap<_, _>>();

            let picks = ranked
                .into_iter()
                .take(3)
                .filter_map(|entry| by_id.get(&entry.id).cloned())
                .collect::<Vec<_>>();

            if picks.is_empty() {
                return format!(
                    "没有在当前库里找到和“{}”高度相关的球场。可以先补充更多目的地资料，再重新生成攻略。",
                    prompt
                );
            }

            let lines = picks
                .iter()
                .enumerate()
                .map(|(index, record)| {
                    format!(
                        "{}. {}，位于 {}，参考果岭费约 ¥{}，建议季节为 {}。{}",
                        index + 1,
                        record.course_name,
                        record.region,
                        record.green_fee,
                        if record.best_season.trim().is_empty() {
                            "待补充"
                        } else {
                            &record.best_season
                        },
                        record.notes
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");

            format!(
                "根据“{}”，建议优先关注以下球场：\n{}\n\n行程建议：优先选择同一地区或航班直达的组合，先确认 tee time，再根据旺季情况安排酒店与交通。",
                prompt, lines
            )
        }
        Err(_) => {
            let mut fallback = filter_and_sort(
                records,
                &models::GuidesQuery {
                    search: None,
                    search_mode: None,
                    region: None,
                    sort: Some(models::SortMode::UpdatedDesc),
                },
            );
            sort_guides(&mut fallback, models::SortMode::UpdatedDesc);
            let picks = fallback.into_iter().take(3).collect::<Vec<_>>();

            if picks.is_empty() {
                return format!(
                    "没有在当前库里找到和“{}”高度相关的球场。可以先补充更多目的地资料，再重新生成攻略。",
                    prompt
                );
            }

            let lines = picks
                .iter()
                .enumerate()
                .map(|(index, record)| {
                    format!(
                        "{}. {}，位于 {}，参考果岭费约 ¥{}，建议季节为 {}。{}",
                        index + 1,
                        record.course_name,
                        record.region,
                        record.green_fee,
                        if record.best_season.trim().is_empty() {
                            "待补充"
                        } else {
                            &record.best_season
                        },
                        record.notes
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");

            format!(
                "根据“{}”，建议优先关注以下球场：\n{}\n\n行程建议：优先选择同一地区或航班直达的组合，先确认 tee time，再根据旺季情况安排酒店与交通。",
                prompt, lines
            )
        }
    }
}
