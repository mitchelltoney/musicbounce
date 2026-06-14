"""Demucs (htdemucs) demix -> per-stem onsets, kick/snare/hat split, stem energy.

The instrument-separated-light unlock: clean drum/bass/vocal timing from isolated
stems instead of band-splitting the full mix. mps with cpu fallback.
"""
from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

from . import runtime  # noqa: F401  (SSL config on import)
from .features import HOP, _bandpass, _norm01

_MODEL: dict = {}


@dataclass
class Stems:
    onsets_by_stem: dict          # {stem: [onset times]}
    onset_strengths: dict         # {layer: [local RMS per onset]} for kick/snare/hat/bass/melody
    drum_hits: dict               # {kick:[], snare:[], hat:[]}
    stem_energy: dict             # {stem: (times, values 0..1)}
    device: str


def _get_model(device: str):
    if device not in _MODEL:
        from demucs.pretrained import get_model
        m = get_model("htdemucs")
        m.eval()
        m.to(device)
        _MODEL[device] = m
    return _MODEL[device]


def _demix(stereo: np.ndarray, sr: int, device: str) -> dict[str, np.ndarray]:
    import torch
    from demucs.apply import apply_model

    model = _get_model(device)
    wav = torch.from_numpy(np.ascontiguousarray(stereo, dtype=np.float32))  # [2, n]
    ref = wav.mean(0)
    wav_n = (wav - ref.mean()) / (ref.std() + 1e-8)  # demucs expects mix-normalized input
    with torch.no_grad():
        out = apply_model(model, wav_n[None], device=device, progress=False, split=True, overlap=0.25)[0]
    out = out * ref.std() + ref.mean()
    names = model.sources  # ['drums', 'bass', 'other', 'vocals']
    return {
        name: out[i].mean(0).detach().cpu().numpy().astype(np.float32)
        for i, name in enumerate(names)
    }


HOP_ON = 512
# per-stem onset peak-picking (delta, wait): stricter than defaults so only salient
# events survive (kills the spurious flicker the full mix can't separate).
_STEM_PARAMS = {"drums": (0.06, 4), "bass": (0.12, 10), "vocals": (0.10, 8), "other": (0.14, 10)}


def analyze_stems(stereo: np.ndarray, sr: int, mono: np.ndarray | None = None, device: str = "cpu") -> Stems:
    try:
        stems = _demix(stereo, sr, device)
    except Exception as exc:
        if device != "cpu":
            print(f"[stems] {device} demix failed ({type(exc).__name__}); retrying on cpu")
            stems = _demix(stereo, sr, "cpu")
            device = "cpu (fallback)"
        else:
            raise

    # Independent second opinion (NOT Demucs): HPSS percussive/harmonic onset
    # strength. Real drum hits land in 'percussive', real melody in 'harmonic';
    # onsets where the corroborating component is weak get suppressed.
    perc_env = harm_env = None
    if mono is not None:
        try:
            harm, perc = librosa.effects.hpss(mono)
            perc_env = librosa.onset.onset_strength(y=perc, sr=sr, hop_length=HOP_ON)
            harm_env = librosa.onset.onset_strength(y=harm, sr=sr, hop_length=HOP_ON)
        except Exception:
            perc_env = harm_env = None
    gate = {"drums": perc_env, "bass": harm_env, "vocals": harm_env, "other": harm_env}

    onsets = {}
    stem_str = {}
    for name, y in stems.items():
        d, w = _STEM_PARAMS.get(name, (0.08, 6))
        t, s = _onsets(y, sr, d, w, gate.get(name))
        onsets[name] = t
        stem_str[name] = s
    energy = {name: _energy(y, sr) for name, y in stems.items()}
    drums = stems.get("drums")
    if drums is not None:
        drum_hits, drum_str = _drum_split(drums, sr, perc_env)
    else:
        drum_hits = {"kick": [], "snare": [], "hat": []}
        drum_str = {"kick": [], "snare": [], "hat": []}
    onset_strengths = {
        "kick": drum_str["kick"], "snare": drum_str["snare"], "hat": drum_str["hat"],
        "bass": stem_str.get("bass", []), "melody": stem_str.get("other", []),
    }
    return Stems(
        onsets_by_stem=onsets, onset_strengths=onset_strengths,
        drum_hits=drum_hits, stem_energy=energy, device=device,
    )


def _onsets(y: np.ndarray, sr: int, delta: float = 0.08, wait: int = 6, gate_env=None):
    """Salient onset times via strict peak-picking, corroborated by an HPSS
    component envelope. Returns (times, strengths) where strength = local RMS
    of the layer signal at each onset (comparable across layers)."""
    try:
        env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_ON)
    except Exception:
        return [], []
    if env.size == 0:
        return [], []
    if gate_env is not None and len(gate_env):
        m = min(len(env), len(gate_env))
        env = env[:m].astype(float).copy()
        g = np.asarray(gate_env[:m], dtype=float)
        env *= 0.25 + 0.75 * (g / (float(g.max()) + 1e-9))
    env = env / (float(env.max()) + 1e-9)
    try:
        peaks = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=5, post_avg=5, delta=delta, wait=wait)
    except Exception:
        return [], []
    times = [float(t) for t in librosa.frames_to_time(peaks, sr=sr, hop_length=HOP_ON)]
    return times, _local_rms(y, sr, times)


def _local_rms(y: np.ndarray, sr: int, times: list[float], win: float = 0.025) -> list[float]:
    """RMS of the signal in a small window around each onset = how hard the hit was."""
    w = int(win * sr)
    out: list[float] = []
    for t in times:
        i = int(t * sr)
        seg = y[max(0, i - w): min(len(y), i + w)]
        out.append(float(np.sqrt(np.mean(seg ** 2))) if seg.size else 0.0)
    return out


def _energy(y: np.ndarray, sr: int, hop: int = HOP) -> tuple[list[float], list[float]]:
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    return times.tolist(), _norm01(rms).tolist()


def _drum_split(drums: np.ndarray, sr: int, perc_env=None):
    """Band-split the isolated drums stem into kick (low) / snare (mid) / hat (high),
    each strict-peak-picked + percussive-corroborated. Returns (hits, strengths)."""
    bands = {
        "kick": (20.0, 150.0, 0.08, 8),
        "snare": (250.0, 2000.0, 0.16, 13),
        "hat": (6000.0, min(16000.0, sr / 2 * 0.99), 0.05, 4),
    }
    hits: dict[str, list[float]] = {}
    strengths: dict[str, list[float]] = {}
    for name, (lo, hi, d, w) in bands.items():
        try:
            filt = _bandpass(drums, sr, lo, hi).astype(np.float32)
            t, s = _onsets(filt, sr, d, w, perc_env)
            hits[name] = t
            strengths[name] = s
        except Exception:
            hits[name] = []
            strengths[name] = []
    return hits, strengths
