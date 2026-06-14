"""Runtime environment config for the analyzer: SSL certs + torch device.

Importing this module configures SSL so model-weight downloads work."""
from __future__ import annotations

import functools
import os


def configure_ssl() -> None:
    """python.org's framework Python ships without a CA bundle, so model-weight
    downloads (beat_this checkpoints, Demucs via torch.hub) fail with
    CERTIFICATE_VERIFY_FAILED. Point ssl/requests at certifi's bundle."""
    try:
        import certifi
    except Exception:
        return
    where = certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", where)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", where)


@functools.lru_cache(maxsize=1)
def pick_device(prefer: str = "auto") -> str:
    """Acceleration device: cuda > mps > cpu (unless overridden)."""
    try:
        import torch
    except Exception:
        return "cpu"
    if prefer and prefer != "auto":
        return prefer
    try:
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


configure_ssl()
