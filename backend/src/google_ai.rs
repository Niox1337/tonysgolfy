use std::env;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::models::{GuideRecord, GuideScoreRecord};

#[derive(Clone)]
pub struct GoogleAiClient {
    http: Client,
    api_key: String,
    model: String,
}

#[derive(Serialize)]
struct GenerateContentRequest {
    contents: Vec<Content>,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct Part {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    content: Option<CandidateContent>,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Vec<CandidatePart>,
}

#[derive(Deserialize)]
struct CandidatePart {
    text: Option<String>,
}

impl GoogleAiClient {
    pub fn from_env() -> Result<Self, String> {
        let api_key = env::var("GOOGLE_AI_STUDIO_API_KEY")
            .or_else(|_| env::var("GOOGLE_API_KEY"))
            .map_err(|_| {
                "missing GOOGLE_AI_STUDIO_API_KEY in backend/.env or environment".to_string()
            })?
            .trim()
            .to_string();
        let model = env::var("GOOGLE_AI_MODEL")
            .unwrap_or_else(|_| "gemini-3-flash-preview".to_string())
            .trim()
            .to_string();

        if api_key.is_empty() || api_key == "..." || api_key.eq_ignore_ascii_case("your_api_key") {
            return Err(
                "GOOGLE_AI_STUDIO_API_KEY is empty or still using a placeholder value".to_string(),
            );
        }

        if model.is_empty() {
            return Err("GOOGLE_AI_MODEL cannot be empty".to_string());
        }

        Ok(Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|error| format!("failed to build Google AI Studio client: {error}"))?,
            api_key,
            model,
        })
    }

    pub async fn generate_travel_guide(
        &self,
        user_prompt: &str,
        guides: &[GuideRecord],
    ) -> Result<String, String> {
        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            self.model
        );

        let context = guides
            .iter()
            .take(20)
            .map(|guide| {
                format!(
                    "- 球场: {}\n  地区: {}\n  代号: {}\n  果岭费: {}\n  最佳季节: {}\n  备注: {}",
                    guide.course_name,
                    guide.region,
                    guide.course_code,
                    guide.green_fee,
                    if guide.best_season.trim().is_empty() {
                        "待补充"
                    } else {
                        &guide.best_season
                    },
                    if guide.notes.trim().is_empty() {
                        "无"
                    } else {
                        &guide.notes
                    }
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "你是 tonysgolfy 的高尔夫旅行编辑。请根据用户需求和现有球场数据，生成一份中文旅游攻略。\n\
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
        );

        let response = self
            .http
            .post(endpoint)
            .header("x-goog-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&GenerateContentRequest {
                contents: vec![Content {
                    parts: vec![Part { text: prompt }],
                }],
            })
            .send()
            .await
            .map_err(|error| format!("failed to call Google AI Studio: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "failed to read error body".to_string());
            return Err(format!(
                "Google AI Studio request failed with {status}: {body}"
            ));
        }

        let payload: GenerateContentResponse = response
            .json()
            .await
            .map_err(|error| format!("failed to parse Google AI Studio response: {error}"))?;

        let text = payload
            .candidates
            .unwrap_or_default()
            .into_iter()
            .flat_map(|candidate| candidate.content.into_iter())
            .flat_map(|content| content.parts.into_iter())
            .filter_map(|part| part.text)
            .collect::<Vec<_>>()
            .join("\n");

        if text.trim().is_empty() {
            return Err("Google AI Studio returned an empty response".to_string());
        }

        Ok(text)
    }

    pub async fn calculate_composite_score(
        &self,
        course_name: &str,
        ai_prompt: &str,
        scores: &[GuideScoreRecord],
    ) -> Result<f64, String> {
        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            self.model
        );

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

        let prompt = format!(
            "你是 tonysgolfy 的评分分析助手。请根据给定球场评分和用户说明，计算一个 0 到 100 之间的综合评分。\n\
要求：\n\
1. 只能输出一个数字，不要输出单位、说明或多余文本。\n\
2. 结果必须是 0 到 100 之间的小数。\n\
3. 只基于提供的评分和用户说明进行计算。\n\n\
球场：{}\n\
评分记录：\n{}\n\n\
用户说明：\n{}",
            course_name.trim(),
            score_context,
            ai_prompt.trim()
        );

        let response = self
            .http
            .post(endpoint)
            .header("x-goog-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&GenerateContentRequest {
                contents: vec![Content {
                    parts: vec![Part { text: prompt }],
                }],
            })
            .send()
            .await
            .map_err(|error| format!("failed to call Google AI Studio: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "failed to read error body".to_string());
            return Err(format!(
                "Google AI Studio request failed with {status}: {body}"
            ));
        }

        let payload: GenerateContentResponse = response
            .json()
            .await
            .map_err(|error| format!("failed to parse Google AI Studio response: {error}"))?;

        let text = payload
            .candidates
            .unwrap_or_default()
            .into_iter()
            .flat_map(|candidate| candidate.content.into_iter())
            .flat_map(|content| content.parts.into_iter())
            .filter_map(|part| part.text)
            .collect::<Vec<_>>()
            .join("\n");

        parse_score_value(&text)
    }
}

fn parse_score_value(raw: &str) -> Result<f64, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Google AI Studio returned an empty score".to_string());
    }

    let candidate = trimmed
        .split(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
        .find(|part| !part.is_empty())
        .ok_or_else(|| "Google AI Studio did not return a numeric score".to_string())?;

    let value = candidate
        .parse::<f64>()
        .map_err(|_| "Google AI Studio returned an invalid numeric score".to_string())?;

    if !(0.0..=100.0).contains(&value) {
        return Err("Google AI Studio returned a score outside 0 to 100".to_string());
    }

    Ok(value)
}
