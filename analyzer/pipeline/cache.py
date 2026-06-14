"""Disk cache for Score JSON, keyed by sourceHash (re-analysis of a file is instant)."""
from __future__ import annotations

import json
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parents[1] / ".score_cache"


def cache_path(source_hash: str) -> Path:
    return CACHE_DIR / f"{source_hash}.json"


def read(source_hash: str) -> dict | None:
    p = cache_path(source_hash)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def write(source_hash: str, score: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path(source_hash).write_text(json.dumps(score))
