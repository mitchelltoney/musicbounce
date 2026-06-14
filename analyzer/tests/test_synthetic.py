"""Synthetic-signal tests — objective, ear-free correctness (CLAUDE.md doctrine).

These run in CI without audio hardware and without the heavy Demucs stage.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from analyzer import make_fixtures as mf
from analyzer.pipeline import audio_io, features, rhythm

FIX = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture(scope="session", autouse=True)
def _ensure_fixtures():
    if not (FIX / "click-120bpm.wav").exists():
        mf.main()


def test_click_tempo_is_120_and_beats_on_half_second():
    a = audio_io.load_audio(FIX / "click-120bpm.wav")
    wav = audio_io.write_temp_wav(a.mono, a.sr)
    r = rhythm.analyze_rhythm(wav)
    assert 118.0 <= r.bpm <= 122.0
    ibi = np.diff(np.asarray(r.beat_times))
    assert abs(float(np.median(ibi)) - 0.5) < 0.03  # 120 BPM -> 0.5 s/beat


def test_silence_has_zero_energy_and_no_onsets():
    a = audio_io.load_audio(FIX / "silence.wav")
    _, values = features.energy_envelope(a.mono, a.sr)
    assert max(values) < 1e-3
    total_onsets = sum(len(o) for o in features.band_onsets(a.mono, a.sr).values())
    assert total_onsets == 0


def test_tone_440_concentrates_in_mid_band():
    a = audio_io.load_audio(FIX / "tone-440.wav")
    band_energy = features.band_energy_means(a.mono, a.sr)
    assert max(band_energy, key=band_energy.get) == "mid"  # 440 Hz lives in mid (400-1k)


def test_noise_burst_onset_lands_near_one_second():
    a = audio_io.load_audio(FIX / "noise-burst.wav")
    onsets = [t for times in features.band_onsets(a.mono, a.sr).values() for t in times]
    assert any(0.85 <= t <= 1.25 for t in onsets)  # burst placed at 1.0 s
