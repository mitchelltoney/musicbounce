"""Fuse rhythm + features + stems + sections into a Score (contracts.ts shape).

One decode is shared across all stages (no double-demix). Result is validated by
the pydantic Score model and cached on disk by sourceHash.
"""
from __future__ import annotations

import datetime as _dt
import os

from . import cache, features as feat, rhythm as rhythm_mod, runtime
from . import sections as sec_mod, stems as stems_mod
from .audio_io import load_audio, write_temp_wav
from .schema import Score


def _normalize_strengths(strengths: dict) -> dict | None:
    """Normalize per-onset RMS across ALL layers (relative to the song): a hit's
    strength is how loud it is vs. the loudest onset in the track. Gamma-shaped."""
    import numpy as np

    allv = [v for arr in strengths.values() for v in arr]
    if not allv:
        return None
    ref = float(np.percentile(allv, 95)) or 1e-9
    return {k: [min(1.0, v / ref) ** 0.6 for v in arr] for k, arr in strengths.items()}


def analyze(path: str, use_cache: bool = True, do_stems: bool = True) -> dict:
    audio = load_audio(path)

    if use_cache:
        cached = cache.read(audio.source_hash)
        if cached is not None:
            return cached

    device = runtime.pick_device()

    # --- rhythm (beat_this wants a path) ---
    wav = write_temp_wav(audio.mono, audio.sr)
    try:
        r = rhythm_mod.analyze_rhythm(wav)
    finally:
        try:
            os.remove(wav)
        except OSError:
            pass

    # --- librosa features ---
    e_times, e_vals = feat.energy_envelope(audio.mono, audio.sr)
    sp_t, sp_c, sp_f = feat.spectral_features(audio.mono, audio.sr)
    onsets_band = feat.band_onsets(audio.mono, audio.sr)
    key = feat.chroma_key(audio.mono, audio.sr)

    # --- stems (Demucs) ---
    onsets_stem = drum_hits = stem_energy = onset_strength = None
    if do_stems:
        try:
            st = stems_mod.analyze_stems(audio.stereo, audio.sr, mono=audio.mono, device=device)
            onsets_stem = st.onsets_by_stem
            drum_hits = st.drum_hits
            stem_energy = {
                name: {"timesSec": t, "values": v} for name, (t, v) in st.stem_energy.items()
            }
            onset_strength = _normalize_strengths(st.onset_strengths)
        except Exception as exc:  # never fail the whole analysis if demix dies
            print(f"[score] stems unavailable: {type(exc).__name__}: {exc}")

    # --- structure ---
    sections = sec_mod.analyze_sections(
        audio.mono, audio.sr, e_times, e_vals, audio.duration_sec,
        beats=r.beat_times, downbeats=r.downbeat_times,
    )

    score = {
        "schemaVersion": 1,
        "analyzedBy": "python-beatthis+librosa",
        "generatedAtISO": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "sourceHash": audio.source_hash,
        "durationSec": round(audio.duration_sec, 3),
        "sampleRate": audio.sr,
        "bpm": r.bpm,
        "tempoConfidence": r.tempo_confidence,
        "timeSignature": r.time_signature,
        "beatTimesSec": r.beat_times,
        "downbeatTimesSec": r.downbeat_times,
        "beatPositions": r.beat_positions,
        "onsetsByBand": onsets_band,
        "onsetsByStem": onsets_stem,
        "drumHits": drum_hits,
        "onsetStrength": onset_strength,
        "energyEnvelope": {"timesSec": e_times, "values": e_vals},
        "stemEnergy": stem_energy,
        "spectral": {"timesSec": sp_t, "centroid": sp_c, "flux": sp_f},
        "sections": sections,
        "key": key,
    }

    validated = Score(**score).model_dump()
    cache.write(audio.source_hash, validated)
    return validated
