"""
Generate deterministic synthetic test fixtures for the analyzer.

    python -m analyzer.make_fixtures      (or: make fixtures)

These WAVs are ground truth for objective, ear-free tests (CLAUDE.md testing
doctrine — Claude cannot hear, so correctness must be measurable):

  - click-120bpm.wav : beats every 0.5 s; accented downbeat every 4 beats
  - silence.wav      : digital silence (energy ~ 0, no onsets)
  - tone-440.wav     : pure 440 Hz sine (only the matching band should light)
  - noise-burst.wav  : one band-limited noise burst at a known time (onset timing)
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100
FIX = Path(__file__).resolve().parents[1] / "fixtures"


def _click(buf: np.ndarray, t: float, freq: float, amp: float, dur: float = 0.03) -> None:
    """Place a short exponentially-decaying sine 'click' at time t (seconds)."""
    i0 = int(t * SR)
    if i0 >= len(buf):
        return
    n = min(int(dur * SR), len(buf) - i0)
    tt = np.arange(n) / SR
    env = np.exp(-tt / (dur * 0.4))
    buf[i0:i0 + n] += amp * env * np.sin(2 * np.pi * freq * tt)


def make_click(path: Path, bpm: float = 120.0, bars: int = 8, beats_per_bar: int = 4) -> None:
    spb = 60.0 / bpm  # 0.5 s/beat at 120 BPM
    n_beats = bars * beats_per_bar
    buf = np.zeros(int((n_beats * spb + 0.5) * SR), dtype=np.float32)
    for b in range(n_beats):
        downbeat = (b % beats_per_bar) == 0
        _click(buf, b * spb, freq=1500.0 if downbeat else 1000.0, amp=0.9 if downbeat else 0.5)
    _write(path, buf)


def make_silence(path: Path, dur: float = 5.0) -> None:
    _write(path, np.zeros(int(dur * SR), dtype=np.float32))


def make_tone(path: Path, freq: float = 440.0, dur: float = 5.0) -> None:
    tt = np.arange(int(dur * SR)) / SR
    _write(path, (0.5 * np.sin(2 * np.pi * freq * tt)).astype(np.float32))


def make_noise_burst(
    path: Path, dur: float = 4.0, onset: float = 1.0, blen: float = 0.25,
    band: tuple[float, float] = (2000.0, 4000.0),
) -> None:
    rng = np.random.default_rng(42)
    buf = np.zeros(int(dur * SR), dtype=np.float32)
    n = int(blen * SR)
    noise = rng.standard_normal(n).astype(np.float32)
    # crude FFT band-limit so the onset lands in a known band (presence ~3 kHz)
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spec[~((freqs >= band[0]) & (freqs <= band[1]))] = 0
    bnoise = np.fft.irfft(spec, n).astype(np.float32)
    peak = np.max(np.abs(bnoise))
    if peak > 0:
        bnoise /= peak
    i0 = int(onset * SR)
    buf[i0:i0 + n] += 0.8 * np.hanning(n).astype(np.float32) * bnoise
    _write(path, buf)


def _write(path: Path, buf: np.ndarray) -> None:
    peak = float(np.max(np.abs(buf))) if buf.size else 0.0
    if peak > 1.0:
        buf = buf / peak
    sf.write(str(path), buf, SR, subtype="PCM_16")
    try:
        shown: Path | str = path.relative_to(FIX.parent)
    except ValueError:
        shown = path  # e.g. a pytest tmp path outside the repo
    print(f"  wrote {shown}  ({len(buf) / SR:.2f}s, peak {peak:.2f})")


def main() -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    print(f"generating fixtures in {FIX} @ {SR} Hz")
    make_click(FIX / "click-120bpm.wav")
    make_silence(FIX / "silence.wav")
    make_tone(FIX / "tone-440.wav")
    make_noise_burst(FIX / "noise-burst.wav")
    print("done.")


if __name__ == "__main__":
    main()
