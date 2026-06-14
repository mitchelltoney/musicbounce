"""librosa features: energy envelope, spectral centroid/flux, chroma + key,
per-band onsets (full-mix fallback), and per-band energy."""
from __future__ import annotations

import librosa
import numpy as np
from scipy.signal import butter, sosfiltfilt

from .schema import BAND_EDGES_HZ

HOP = 1024


def _norm01(x: np.ndarray) -> np.ndarray:
    """Normalize to 0..1 by the 99th percentile; silence -> zeros (never NaN)."""
    x = np.nan_to_num(np.asarray(x, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    x = np.maximum(x, 0.0)
    ref = float(np.percentile(x, 99)) if x.size else 0.0
    if ref <= 1e-9:
        return np.zeros_like(x)
    return np.clip(x / ref, 0.0, 1.0)


def energy_envelope(mono: np.ndarray, sr: int, hop: int = HOP) -> tuple[list[float], list[float]]:
    rms = librosa.feature.rms(y=mono, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    return times.tolist(), _norm01(rms).tolist()


def spectral_features(mono: np.ndarray, sr: int, hop: int = HOP):
    cen = librosa.feature.spectral_centroid(y=mono, sr=sr, hop_length=hop)[0]
    flux = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop)
    n = min(len(cen), len(flux))
    times = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=hop)
    cen01 = np.clip(cen[:n] / 8000.0, 0.0, 1.0)  # 8 kHz ~ perceptual brightness ceiling
    return times.tolist(), cen01.tolist(), _norm01(flux[:n]).tolist()


def _bandpass(y: np.ndarray, sr: int, lo: float, hi: float) -> np.ndarray:
    nyq = sr / 2.0
    lo = max(float(lo), 1.0)
    hi = min(float(hi), nyq * 0.999)
    sos = butter(4, [lo / nyq, hi / nyq], btype="band", output="sos")
    return sosfiltfilt(sos, y)


def band_onsets(mono: np.ndarray, sr: int) -> dict[str, list[float]]:
    """Per-band onset times from the full mix (the always-available fallback)."""
    out: dict[str, list[float]] = {}
    for band, (lo, hi) in BAND_EDGES_HZ.items():
        try:
            filt = _bandpass(mono, sr, lo, hi).astype(np.float32)
            ons = librosa.onset.onset_detect(y=filt, sr=sr, units="time", backtrack=False)
            out[band] = [float(t) for t in ons]
        except Exception:
            out[band] = []
    return out


def band_energy_means(mono: np.ndarray, sr: int) -> dict[str, float]:
    """Mean RMS per band (used by the tone-440 synthetic test)."""
    out: dict[str, float] = {}
    for band, (lo, hi) in BAND_EDGES_HZ.items():
        try:
            filt = _bandpass(mono, sr, lo, hi)
            out[band] = float(np.sqrt(np.mean(filt ** 2)))
        except Exception:
            out[band] = 0.0
    return out


# --- key (Krumhansl-Schmuckler) ---
_KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def chroma_key(mono: np.ndarray, sr: int, hop: int = HOP) -> dict:
    chroma = librosa.feature.chroma_cqt(y=mono, sr=sr, hop_length=hop)
    mean = chroma.mean(axis=1)
    mx = float(mean.max())
    chroma12 = (mean / mx) if mx > 1e-9 else mean
    tonic, mode, conf = _ks_key(mean)
    return {
        "tonic": tonic,
        "mode": mode,
        "chroma12": [float(c) for c in chroma12],
        "confidence": conf,
    }


def _ks_key(chroma_mean: np.ndarray) -> tuple[str, str, float]:
    c = chroma_mean - chroma_mean.mean()
    nc = float(np.linalg.norm(c)) or 1e-9
    scored = []
    for mode, prof in (("major", _KS_MAJOR), ("minor", _KS_MINOR)):
        p = prof - prof.mean()
        npr = float(np.linalg.norm(p)) or 1e-9
        for tonic in range(12):
            r = float(np.dot(c, np.roll(p, tonic)) / (nc * npr))
            scored.append((r, mode, tonic))
    scored.sort(reverse=True)
    r, mode, tonic = scored[0]
    conf = float(np.clip((r - scored[1][0]) * 3.0 + 0.3, 0.0, 1.0))
    return _NOTES[tonic], mode, round(conf, 3)
