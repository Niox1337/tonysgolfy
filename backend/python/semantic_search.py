#!/usr/bin/env python3

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from huggingface_hub import snapshot_download
from sentence_transformers import SentenceTransformer, util
from transformers.utils import logging as transformers_logging


MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "semantic_search"

_MODEL: SentenceTransformer | None = None
transformers_logging.set_verbosity_error()


def get_model() -> SentenceTransformer:
    global _MODEL
    if _MODEL is None:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                local_model_path = snapshot_download(MODEL_NAME, local_files_only=True)
                _MODEL = SentenceTransformer(
                    local_model_path,
                    local_files_only=True,
                    tokenizer_kwargs={"use_fast": False},
                )
            except Exception:
                local_model_path = snapshot_download(MODEL_NAME)
                _MODEL = SentenceTransformer(local_model_path, tokenizer_kwargs={"use_fast": False})
    return _MODEL


def normalize(text: str) -> str:
    return text.strip()


def guide_to_document(guide: dict[str, Any]) -> str:
    parts = [
        f"球场名称: {normalize(str(guide.get('courseName', '')))}",
        f"地区: {normalize(str(guide.get('region', '')))}",
        f"代号: {normalize(str(guide.get('courseCode', '')))}",
        f"果岭费: {guide.get('greenFee', 0)}",
        f"最佳季节: {normalize(str(guide.get('bestSeason', '')))}",
        f"备注: {normalize(str(guide.get('notes', '')))}",
    ]
    return "\n".join(part for part in parts if part.split(": ", 1)[1])


def cache_key(guides: list[dict[str, Any]]) -> str:
    payload = [
        {
            "id": guide.get("id"),
            "courseName": guide.get("courseName"),
            "region": guide.get("region"),
            "courseCode": guide.get("courseCode"),
            "greenFee": guide.get("greenFee"),
            "bestSeason": guide.get("bestSeason"),
            "notes": guide.get("notes"),
            "updatedAt": guide.get("updatedAt"),
        }
        for guide in guides
    ]
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_or_encode_documents(model: SentenceTransformer, guides: list[dict[str, Any]]) -> np.ndarray:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = cache_key(guides)
    cache_path = CACHE_DIR / f"{key}.npy"

    if cache_path.exists():
        return np.load(cache_path)

    documents = [guide_to_document(guide) for guide in guides]
    embeddings = model.encode(
        documents,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    np.save(cache_path, embeddings)
    return embeddings


def rank_guides(payload: dict[str, Any]) -> list[dict[str, Any]]:
    query = str(payload.get("query", "")).strip()
    guides = payload.get("guides", [])
    threshold = float(payload.get("threshold", 0.3))

    if not query or not guides:
        return []

    model = get_model()
    doc_embeddings = load_or_encode_documents(model, guides)
    query_embedding = model.encode(
        [query],
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )

    similarities = util.dot_score(query_embedding, doc_embeddings).cpu().numpy()[0]
    ranked = []

    for guide, score in zip(guides, similarities, strict=True):
        score_value = float(score)
        if score_value >= threshold:
            ranked.append({"id": guide["id"], "score": round(score_value, 6)})

    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked


def main() -> int:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    ranked = rank_guides(payload)
    sys.stdout.write(json.dumps({"results": ranked}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
