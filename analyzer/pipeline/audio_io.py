"""Audio decode + content hashing. One decode, shared across all pipeline stages."""
from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

TARGET_SR = 44100


@dataclass
class LoadedAudio:
    mono: np.ndarray      # float32 [n] @ sr
    stereo: np.ndarray    # float32 [2, n] @ sr (Demucs wants stereo)
    sr: int
    duration_sec: float
    source_hash: str


def load_audio(path: str | Path, target_sr: int = TARGET_SR) -> LoadedAudio:
    """Decode any audio file to mono + stereo float arrays at target_sr."""
    path = str(path)
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)  # [n, ch]
        y = data.T  # [ch, n]
    except Exception:
        # mp3/m4a etc. -> librosa (audioread/ffmpeg backend)
        y, sr = librosa.load(path, sr=None, mono=False)
        y = np.atleast_2d(np.asarray(y, dtype=np.float32))

    if sr != target_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
        sr = target_sr

    stereo = np.repeat(y, 2, axis=0) if y.shape[0] == 1 else y[:2]
    stereo = np.ascontiguousarray(stereo, dtype=np.float32)
    mono = stereo.mean(axis=0).astype(np.float32)
    return LoadedAudio(
        mono=mono,
        stereo=stereo,
        sr=sr,
        duration_sec=float(mono.shape[0] / sr),
        source_hash=_hash(mono, sr),
    )


def _hash(mono: np.ndarray, sr: int) -> str:
    """Stable content hash of the decoded signal (cache key)."""
    h = hashlib.sha256()
    h.update(str(sr).encode())
    h.update(np.round(mono * 32767.0).astype(np.int16).tobytes())
    return h.hexdigest()[:16]


def write_temp_wav(mono: np.ndarray, sr: int) -> str:
    """Write a mono wav to a temp file (for tools that want a path, e.g. beat_this)."""
    fd = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    fd.close()
    sf.write(fd.name, mono, sr, subtype="PCM_16")
    return fd.name
