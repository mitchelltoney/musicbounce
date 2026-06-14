"""Structural segmentation -> bar-aligned sections with recurrence-consistent
labels and isDrop inference.

GENRE-AGNOSTIC: labels come from energy tier + recurrence clustering + position,
not assumed song form. Boundaries are computed on beat-synchronous features and
snapped to downbeats so sections land on bar lines. isDrop only fires on a genuine
sharp energy jump, so songs without a drop never set it.
"""
from __future__ import annotations

import librosa
import numpy as np


def analyze_sections(
    mono: np.ndarray, sr: int, energy_times, energy_values, duration: float,
    beats=None, downbeats=None, hop: int = 1024,
) -> list[dict]:
    et = np.asarray(energy_times, dtype=float)
    ev = np.asarray(energy_values, dtype=float)
    beats = np.asarray([] if beats is None else beats, dtype=float)
    downbeats = np.asarray([] if downbeats is None else downbeats, dtype=float)

    try:
        chroma = librosa.feature.chroma_cqt(y=mono, sr=sr, hop_length=hop)
        mfcc = librosa.feature.mfcc(y=mono, sr=sr, hop_length=hop, n_mfcc=13)
    except Exception:
        return [_section(0.0, max(duration, 0.0), ev, et, "unknown", False)]

    n_frames = chroma.shape[1]
    if n_frames < 8 or duration <= 0:
        return [_section(0.0, max(duration, 0.0), ev, et, "unknown", False)]

    # beat-synchronous features -> clean, musically-aligned boundaries
    if beats.size >= 8:
        bf = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=hop), 0, n_frames - 1)
        feat = np.vstack([
            librosa.util.normalize(librosa.util.sync(chroma, bf, aggregate=np.median), axis=0),
            librosa.util.normalize(librosa.util.sync(mfcc, bf, aggregate=np.mean), axis=0),
        ])
        unit_times = beats
    else:
        feat = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=0)])
        unit_times = librosa.frames_to_time(np.arange(feat.shape[1]), sr=sr, hop_length=hop)

    n_units = feat.shape[1]
    k = int(np.clip(round(duration / 18.0), 4, 11))
    k = min(k, max(2, n_units // 4))
    try:
        bound_units = librosa.segment.agglomerative(feat, k)
    except Exception:
        bound_units = np.linspace(0, n_units, k + 1).astype(int)[1:-1]
    bound_units = np.unique(np.clip(np.asarray(bound_units, dtype=int), 0, len(unit_times) - 1))

    bounds = np.array([0.0] + [float(unit_times[u]) for u in bound_units] + [duration])
    bounds = np.unique(np.clip(bounds, 0.0, duration))
    bounds = _snap_to_downbeats(bounds, downbeats)
    bounds = _merge_short(bounds, min_len=2.0)

    # per-segment energy + timbre/harmony features (for recurrence clustering)
    segs = []
    for i in range(len(bounds) - 1):
        s, e = float(bounds[i]), float(bounds[i + 1])
        m = (et >= s) & (et < e)
        en = float(np.mean(ev[m])) if m.any() else 0.0
        fs = int(librosa.time_to_frames(s, sr=sr, hop_length=hop))
        fe = min(n_frames, max(fs + 1, int(librosa.time_to_frames(e, sr=sr, hop_length=hop))))
        cf = chroma[:, fs:fe].mean(axis=1) if fe > fs else np.zeros(12)
        mf = mfcc[:, fs:fe].mean(axis=1) if fe > fs else np.zeros(13)
        segs.append((s, e, en, np.concatenate([cf, mf])))

    labels = _label_segments(segs)
    energies = [g[2] for g in segs]
    emax = max(energies) or 1e-9

    out = []
    for i, (s, e, en, _) in enumerate(segs):
        prev = energies[i - 1] if i > 0 else en
        is_drop = (i > 0) and (prev < 0.45 * emax) and (en > 0.70 * emax) and ((en - prev) > 0.25 * emax)
        out.append(_section(s, e, ev, et, "drop" if is_drop else labels[i], is_drop))
    for i in range(len(out) - 1):
        if out[i + 1]["isDrop"] and out[i]["label"] not in ("intro", "silence", "drop"):
            out[i]["label"] = "build"
    return out


def _bar_len(downbeats: np.ndarray) -> float:
    return float(np.median(np.diff(downbeats))) if downbeats.size >= 2 else 2.0


def _snap_to_downbeats(bounds: np.ndarray, downbeats: np.ndarray) -> np.ndarray:
    if downbeats.size == 0:
        return bounds
    tol = _bar_len(downbeats) * 1.5
    snapped = [bounds[0]]
    for b in bounds[1:-1]:
        j = int(np.argmin(np.abs(downbeats - b)))
        cand = float(downbeats[j])
        snapped.append(cand if abs(cand - b) < tol else float(b))
    snapped.append(bounds[-1])
    return np.unique(np.clip(np.array(snapped), 0.0, bounds[-1]))


def _merge_short(bounds: np.ndarray, min_len: float = 2.0) -> np.ndarray:
    if bounds.size < 3:
        return bounds
    out = [float(bounds[0])]
    for b in bounds[1:]:
        if b - out[-1] >= min_len:
            out.append(float(b))
    out[-1] = float(bounds[-1])
    return np.array(out) if len(out) >= 2 else np.array([bounds[0], bounds[-1]])


def _label_segments(segs: list) -> list[str]:
    n = len(segs)
    energies = np.array([g[2] for g in segs])
    emax = float(energies.max()) or 1e-9
    feats = np.array([g[3] for g in segs])

    # cluster by timbre/harmony so recurring sections share a tier (chorus == chorus)
    cluster_id = np.zeros(n, dtype=int)
    if n >= 3:
        try:
            from sklearn.cluster import AgglomerativeClustering
            f = (feats - feats.mean(0)) / (feats.std(0) + 1e-9)
            cluster_id = AgglomerativeClustering(n_clusters=min(3, n)).fit_predict(f)
        except Exception:
            cluster_id = np.zeros(n, dtype=int)

    cluster_energy = {c: float(energies[cluster_id == c].mean()) for c in set(cluster_id.tolist())}
    ranked = sorted(cluster_energy, key=lambda c: cluster_energy[c])  # low -> high energy
    tier = {c: i for i, c in enumerate(ranked)}
    top = len(ranked) - 1

    labels = []
    for i in range(n):
        rel = energies[i] / emax
        if energies[i] < 0.05:
            labels.append("silence")
        elif tier[cluster_id[i]] == top and rel >= 0.6:
            labels.append("chorus")
        elif tier[cluster_id[i]] == 0 and rel < 0.4:
            labels.append("breakdown")
        else:
            labels.append("verse")
    labels[0] = "silence" if energies[0] < 0.05 else "intro"
    labels[-1] = "silence" if energies[-1] < 0.05 else "outro"
    return labels


def _section(s: float, e: float, ev: np.ndarray, et: np.ndarray, label: str, is_drop: bool) -> dict:
    m = (et >= s) & (et < e)
    energy = float(np.mean(ev[m])) if m.any() else 0.0
    return {
        "startSec": round(s, 3),
        "endSec": round(e, 3),
        "label": label,
        "energy": round(energy, 4),
        "isDrop": bool(is_drop),
    }
