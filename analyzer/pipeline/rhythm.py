"""beat_this -> beats, downbeats, BPM, time signature, beat positions.

beat_this is small; CPU is reliable (MPS has had op gaps). dbn=True gives cleaner,
metrically-consistent downbeats than the minimal post-processing.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import runtime  # noqa: F401  (configures SSL on import)

_F2B = None


@dataclass
class Rhythm:
    bpm: float
    tempo_confidence: float
    time_signature: int
    beat_times: list[float]
    downbeat_times: list[float]
    beat_positions: list[float]


def _get_f2b():
    global _F2B
    if _F2B is None:
        from beat_this.inference import File2Beats
        try:
            _F2B = File2Beats(checkpoint_path="final0", device="cpu", dbn=True)
        except Exception:
            _F2B = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
    return _F2B


def analyze_rhythm(wav_path: str) -> Rhythm:
    beats, downbeats = _get_f2b()(wav_path)
    beats = np.asarray(beats, dtype=float)
    downbeats = np.asarray(downbeats, dtype=float)

    if beats.size < 2:
        return Rhythm(0.0, 0.0, 4, beats.tolist(), downbeats.tolist(), [])

    ibi = np.diff(beats)
    median_ibi = float(np.median(ibi))
    bpm = 60.0 / median_ibi if median_ibi > 0 else 0.0
    # confidence: tighter inter-beat-interval spread -> higher
    spread = float(np.std(ibi) / median_ibi) if median_ibi > 0 else 1.0
    tempo_conf = float(np.clip(1.0 - spread, 0.0, 1.0))

    ts, positions = _beat_positions(beats, downbeats)
    return Rhythm(
        bpm=round(bpm, 2),
        tempo_confidence=round(tempo_conf, 3),
        time_signature=ts,
        beat_times=beats.tolist(),
        downbeat_times=downbeats.tolist(),
        beat_positions=positions,
    )


def _beat_positions(beats: np.ndarray, downbeats: np.ndarray) -> tuple[int, list[float]]:
    """Position 1..ts of each beat within its bar, derived from downbeat indices."""
    if downbeats.size == 0:
        return 4, [float((i % 4) + 1) for i in range(len(beats))]

    # index of the beat nearest to each downbeat
    db_idx = sorted({int(np.argmin(np.abs(beats - d))) for d in downbeats})
    gaps = np.diff(db_idx)
    ts = int(round(float(np.median(gaps)))) if gaps.size else 4
    ts = int(np.clip(ts, 2, 12)) or 4

    pos: list[float] = []
    first = db_idx[0]
    for i in range(len(beats)):
        prev = [j for j in db_idx if j <= i]
        ref = prev[-1] if prev else first
        pos.append(float(((i - ref) % ts + ts) % ts + 1))
    return ts, pos
