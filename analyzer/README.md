# Synesthete analyzer

Local FastAPI service that turns an audio file into a `Score`
(canonical shape: `src/types/contracts.ts`). Runs on this machine; no cloud.

## Pipeline (chosen)

`Score.analyzedBy = "python-beatthis+librosa"`

- **beat_this** (CPJKU) — SOTA **beats + downbeats** (transformer; runs on MPS/CPU).
- **Demucs (htdemucs)** — source separation → per-**stem** onsets
  (drums → kick/snare/hat, bass → bassline, vocals → presence). The
  instrument-separated-light unlock; preferred over band-split onsets.
- **librosa** — energy envelope, spectral centroid/flux, chroma + key
  (Krumhansl-Schmuckler), and **section boundaries** (structural segmentation).
  `Section.isDrop` is inferred from sharp energy jumps at boundaries.

The `Score` shape is identical regardless of engine — Scenes never see any of this,
only the Director's per-frame `VisualState`.

## Why not allin1?

allin1 was the original plan (and is still ideal for *semantic* section labels:
verse/chorus/bridge). It is **blocked on native macOS / Apple Silicon**:

- allin1 1.1.0 (Oct 2023, unmaintained) hard-imports the **old** `natten.functional`
  API → needs NATTEN ~0.15.
- NATTEN ships **no macOS wheel**, so it must compile from source — and its 2023-era
  C++ **fails to build under clang 21** (current Xcode).
- The latest NATTEN (0.21.x) installs as a pure-Python wheel but requires
  **torch ≥ 2.8** and a different API allin1 doesn't use → `ImportError`.
- Everything else works natively on arm64: **torch + MPS, Demucs, madmom**. Only
  NATTEN is the wall.

**To revisit allin1 later** (if semantic section labels prove worth it): run it in a
**Linux arm64 Docker container** (NATTEN's supported platform — prebuilt wheels / gcc)
and call it as a subprocess; the Score builder merges its `sections`. The interface
(`Score`) never changes, so this is a drop-in upgrade.

## Commands

    make doctor                                   # dependency preflight
    make analyzer                                 # run the service on :8000
    make analyze FILE=fixtures/click-120bpm.wav   # POST a file (Phase 1+)
