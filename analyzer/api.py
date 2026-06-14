"""
Synesthete analyzer service (FastAPI).

Phase 0: GET /health only.
Phase 1 adds POST /analyze (multipart upload) -> Score JSON (contracts.ts shape),
cached on disk by sourceHash.

Run:  make analyzer   (uvicorn analyzer.api:app --reload --port 8000)
"""
from __future__ import annotations

import os
import platform
import sys
import tempfile
import traceback

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Synesthete Analyzer", version="0.0.1")

# The frontend (Vite dev server, different origin) POSTs audio here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _torch_device() -> str:
    """Report the acceleration device without hard-depending on torch (Phase 0)."""
    try:
        import torch
    except Exception:
        return "torch-not-installed"
    try:
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "synesthete-analyzer",
        "schemaVersion": 1,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "device": _torch_device(),
    }


@app.post("/analyze")
async def analyze_endpoint(file: UploadFile = File(...)):
    """Analyze an uploaded audio file -> Score JSON (cached by sourceHash)."""
    from analyzer.pipeline.score import analyze

    suffix = os.path.splitext(file.filename or "audio")[1] or ".bin"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(await file.read())
        tmp.close()
        return analyze(tmp.name)
    except Exception as exc:  # surface a clean error to the frontend
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")
    finally:
        try:
            os.remove(tmp.name)
        except OSError:
            pass
