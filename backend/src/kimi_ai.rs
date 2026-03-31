use std::env;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::Serialize;
use serde_json::Value;

use crate::models::{GuideRecord, GuideScoreRecord};

const DEFAULT_KIMI_BASE_URL: &str = "https://api.moonshot.cn/v1";
const DEFAULT_KIMI_MODEL: &str = "kimi-k2.5";
const MINIMUM_AVAILABLE_BALANCE_CNY: f64 = 5.0;
const BALANCE_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct KimiClient {
    http: Client,
    api_key: String,
    model: String,
    base_url: String,
    balance_cache: Arc<RwLock<Option<BalanceSnapshot>>>,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    partial: Option<bool>,
}

#[derive(Serialize)]
struct ThinkingConfig {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Clone)]
struct BalanceSnapshot {
    available_balance: f64,
    checked_at: Instant,
}

impl KimiClient {
    pub fn from_env() -> Result<Self, String> {
        let api_key = env::var("MOONSHOT_API_KEY")
            .or_else(|_| env::var("KIMI_API_KEY"))
            .map_err(|_| "missing MOONSHOT_API_KEY in backend/.env or environment".to_string())?
            .trim()
            .to_string();
        let model = env::var("KIMI_MODEL")
            .unwrap_or_else(|_| DEFAULT_KIMI_MODEL.to_string())
            .trim()
            .to_string();
        let base_url = env::var("KIMI_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_KIMI_BASE_URL.to_string())
            .trim_end_matches('/')
            .to_string();

        if api_key.is_empty()
            || api_key == "..."
            || api_key.eq_ignore_ascii_case("your_api_key")
            || api_key.eq_ignore_ascii_case("your_moonshot_api_key")
        {
            return Err("MOONSHOT_API_KEY is empty or still using a placeholder value".to_string());
        }

        if model.is_empty() {
            return Err("KIMI_MODEL cannot be empty".to_string());
        }

        Ok(Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(120))
                .build()
                .map_err(|error| format!("failed to build Kimi client: {error}"))?,
            api_key,
            model,
            base_url,
            balance_cache: Arc::new(RwLock::new(None)),
        })
    }

    pub async fn generate_travel_guide(
        &self,
        user_prompt: &str,
        guides: &[GuideRecord],
    ) -> Result<String, String> {
        self.ensure_sufficient_balance().await?;

        let context = guides
            .iter()
            .take(20)
            .map(|guide| {
                format!(
                    "- 球场: {}\n  地区: {}\n  代号: {}\n  果岭费: {}\n  最佳季节: {}\n  综合评分: {}\n  备注: {}",
                    guide.course_name,
                    guide.region,
                    guide.course_code,
                    guide.green_fee,
                    if guide.best_season.trim().is_empty() {
                        "待补充"
                    } else {
                        &guide.best_season
                    },
                    guide
                        .composite_score
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "N/A".to_string()),
                    if guide.notes.trim().is_empty() {
                        "无"
                    } else {
                        &guide.notes
                    }
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let response = self
            .chat_completion(ChatCompletionRequest {
                model: self.model.clone(),
                messages: vec![
                    ChatMessage {
                        role: "system",
                        content: "你是 tonysgolfy 的高尔夫旅行编辑。你的职责是基于给定球场资料生成中文旅游攻略。你不能编造不存在的球场，也不能引入给定数据之外的具体事实。".to_string(),
                        partial: None,
                    },
                    ChatMessage {
                        role: "user",
                        content: format!(
                            "请根据用户需求和现有球场数据，生成一份中文旅游攻略。\n\
要求：\n\
1. 只根据给定数据推荐，不要编造不存在的球场。\n\
2. 优先给出 2-4 个最相关的球场建议。\n\
3. 输出结构清晰，包括推荐理由、行程建议、预算判断和注意事项。\n\
4. 如果数据不足，要明确指出。\n\n\
用户需求：\n{}\n\n\
现有球场数据：\n{}",
                            user_prompt.trim(),
                            if context.is_empty() {
                                "当前没有球场数据。".to_string()
                            } else {
                                context
                            }
                        ),
                        partial: None,
                    },
                ],
                max_completion_tokens: Some(1400),
                temperature: sampling_temperature_for_model(&self.model),
                thinking: thinking_config_for_model(&self.model),
                response_format: None,
            })
            .await?;

        if response.trim().is_empty() {
            return Err("Kimi returned an empty travel guide".to_string());
        }

        Ok(response)
    }

    pub async fn calculate_composite_score(
        &self,
        course_name: &str,
        ai_prompt: &str,
        scores: &[GuideScoreRecord],
    ) -> Result<f64, String> {
        self.ensure_sufficient_balance().await?;

        let score_context = scores
            .iter()
            .map(|entry| {
                format!(
                    "- 评委: {}\n  操作人: {}\n  分数: {}\n  录入时间: {}",
                    entry.judge_name, entry.operator_name, entry.score, entry.created_at
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prefix = "{\"score\": ";
        let completion = self
            .chat_completion(ChatCompletionRequest {
                model: self.model.clone(),
                messages: vec![
                    ChatMessage {
                        role: "system",
                        content: "你是 tonysgolfy 的评分分析助手。你只能返回一个 JSON 对象，格式必须是 {\"score\": number}，其中 score 为 0 到 100 之间的小数。不要输出任何额外文本。".to_string(),
                        partial: None,
                    },
                    ChatMessage {
                        role: "user",
                        content: format!(
                            "请根据给定球场评分和用户说明，计算一个 0 到 100 之间的综合评分。\n\
只能基于这些评分和说明进行计算。\n\n\
球场：{}\n\
评分记录：\n{}\n\n\
用户说明：\n{}",
                            course_name.trim(),
                            score_context,
                            ai_prompt.trim()
                        ),
                        partial: None,
                    },
                    ChatMessage {
                        role: "assistant",
                        content: prefix.to_string(),
                        partial: Some(true),
                    },
                ],
                max_completion_tokens: Some(180),
                temperature: sampling_temperature_for_model(&self.model),
                thinking: thinking_config_for_model(&self.model),
                response_format: None,
            })
            .await?;

        let payload = format!("{prefix}{completion}");
        parse_score_payload(&payload)
    }

    async fn ensure_sufficient_balance(&self) -> Result<(), String> {
        let available_balance = self.fetch_available_balance().await?;
        if available_balance < MINIMUM_AVAILABLE_BALANCE_CNY {
            return Err("余额不足，暂停AI服务".to_string());
        }

        Ok(())
    }

    async fn fetch_available_balance(&self) -> Result<f64, String> {
        if let Some(snapshot) = self
            .balance_cache
            .read()
            .map_err(|_| "failed to read Kimi balance cache".to_string())?
            .clone()
            .filter(|snapshot| snapshot.checked_at.elapsed() < BALANCE_CACHE_TTL)
        {
            return Ok(snapshot.available_balance);
        }

        let endpoint = format!("{}/users/me/balance", self.base_url);
        let response = self
            .http
            .get(&endpoint)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|error| classify_transport_error(&error, &endpoint))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "failed to read error body".to_string());
            return Err(format!("Kimi balance request failed with {status}: {body}"));
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|error| format!("failed to parse Kimi balance response: {error}"))?;

        let available_balance = payload
            .get("data")
            .and_then(|data| data.get("available_balance"))
            .and_then(Value::as_f64)
            .ok_or_else(|| {
                format!(
                    "Kimi balance response did not include data.available_balance: {}",
                    compact_json(&payload)
                )
            })?;

        let snapshot = BalanceSnapshot {
            available_balance,
            checked_at: Instant::now(),
        };
        if let Ok(mut cache) = self.balance_cache.write() {
            *cache = Some(snapshot);
        }

        Ok(available_balance)
    }

    async fn chat_completion(&self, request: ChatCompletionRequest) -> Result<String, String> {
        let endpoint = format!("{}/chat/completions", self.base_url);
        let mut last_transport_error = None;
        let mut response = None;

        for attempt in 0..2 {
            match self
                .http
                .post(&endpoint)
                .bearer_auth(&self.api_key)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
            {
                Ok(ok_response) => {
                    response = Some(ok_response);
                    break;
                }
                Err(error) => {
                    if attempt == 0 && should_retry_transport_error(&error) {
                        last_transport_error = Some(error);
                        tokio::time::sleep(Duration::from_millis(600)).await;
                        continue;
                    }

                    return Err(classify_transport_error(&error, &endpoint));
                }
            }
        }

        let response = match response {
            Some(response) => response,
            None => {
                let error = last_transport_error
                    .as_ref()
                    .map(|error| classify_transport_error(error, &endpoint))
                    .unwrap_or_else(|| "failed to call Kimi API: request did not return a response".to_string());
                return Err(error);
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "failed to read error body".to_string());
            return Err(format!("Kimi API request failed with {status}: {body}"));
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|error| format!("failed to parse Kimi API response: {error}"))?;

        extract_message_text(&payload)
    }
}

fn parse_score_payload(raw: &str) -> Result<f64, String> {
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("Kimi returned invalid JSON: {error}"))?;
    let score = value
        .get("score")
        .and_then(Value::as_f64)
        .ok_or_else(|| "Kimi did not return a numeric score field".to_string())?;

    if !(0.0..=100.0).contains(&score) {
        return Err("Kimi returned a score outside 0 to 100".to_string());
    }

    Ok(score)
}

fn classify_transport_error(error: &reqwest::Error, endpoint: &str) -> String {
    if error.is_timeout() {
        return format!(
            "failed to call Kimi API: request to {endpoint} timed out. Please retry, or reduce generation length if this keeps happening."
        );
    }

    if error.is_connect() {
        return format!(
            "failed to call Kimi API: could not connect to {endpoint}. Check outbound network access, DNS, and TLS connectivity on the server."
        );
    }

    format!("failed to call Kimi API: {error}")
}

fn should_retry_transport_error(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request()
}

fn sampling_temperature_for_model(model: &str) -> Option<f64> {
    if model.trim().starts_with("kimi-k2.5") {
        None
    } else {
        Some(1.0)
    }
}

fn thinking_config_for_model(model: &str) -> Option<ThinkingConfig> {
    if model.trim().starts_with("kimi-k2.5") {
        Some(ThinkingConfig { kind: "disabled" })
    } else {
        None
    }
}

fn extract_message_text(payload: &Value) -> Result<String, String> {
    let choice = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| format!("Kimi API response did not include any choices: {}", compact_json(payload)))?;

    let message = choice
        .get("message")
        .ok_or_else(|| format!("Kimi API response did not include a message object: {}", compact_json(choice)))?;

    if let Some(content) = message.get("content").and_then(extract_content_value) {
        if !content.trim().is_empty() {
            return Ok(content);
        }
    }

    if let Some(reasoning) = message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Err(format!(
            "Kimi returned reasoning content but no final answer. This usually means the model stopped before producing the visible reply. Reasoning preview: {}",
            truncate_text(reasoning, 180)
        ));
    }

    let finish_reason = choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    Err(format!(
        "Kimi returned an empty response (finish_reason: {finish_reason}). Raw message: {}",
        compact_json(message)
    ))
}

fn extract_content_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.to_string()),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                })
                .collect::<Vec<_>>()
                .join("\n");

            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

fn compact_json(value: &Value) -> String {
    truncate_text(&value.to_string(), 240)
}

fn truncate_text(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}
