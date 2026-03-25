use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};

use crate::models::GuideRecord;

#[derive(Debug, Clone, Deserialize)]
pub struct SemanticMatch {
    pub id: String,
    pub score: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticRequest<'a> {
    query: &'a str,
    threshold: f32,
    guides: &'a [GuideRecord],
}

#[derive(Deserialize)]
struct SemanticResponse {
    results: Vec<SemanticMatch>,
}

pub fn rank_guides(query: &str, guides: &[GuideRecord], threshold: f32) -> Result<Vec<SemanticMatch>, String> {
    let script_path = semantic_script_path()?;
    let payload = serde_json::to_vec(&SemanticRequest {
        query,
        threshold,
        guides,
    })
    .map_err(|error| error.to_string())?;

    let mut child = Command::new("python3")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start Python semantic search: {error}"))?;

    let Some(mut stdin) = child.stdin.take() else {
        return Err("failed to open stdin for Python semantic search".to_string());
    };

    stdin
        .write_all(&payload)
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("failed to send semantic payload to Python: {error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for Python semantic search: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Python semantic search failed with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    let response: SemanticResponse =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;

    Ok(response.results)
}

fn semantic_script_path() -> Result<PathBuf, String> {
    let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;
    Ok(current_dir.join("python").join("semantic_search.py"))
}
