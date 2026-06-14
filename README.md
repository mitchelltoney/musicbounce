# Synesthete

An audio-reactive visual instrument. Drop in a song and the screen *dances* with it — tensing into
builds and releasing on drops — instead of just twitching at the audio like a spectrum analyzer.

The idea is **anticipation over reaction**: a song's structure is analyzed *ahead of time* (offline →
a `Score`) and the visuals are choreographed against it, while a live FFT supplies moment-to-moment
texture. A **Director** fuses both — the latency-compensated audio clock, the `Score`, and the live
features — into a per-frame `VisualState` that GLSL **scenes** render.

> Personal / experimental project. Built for macOS on Apple Silicon. The analyzer runs locally; no
> cloud. It's a work in progress, not a finished product.

---

## How it works

```
audio ──► Python analyzer (FastAPI, local)              live FFT (Meyda)
          beat_this  → beats / downbeats / BPM                │ band energies, smoothed
          Demucs     → stems → kick/snare/hat/bass/melody     │
          librosa    → energy / spectral / chroma+key /       ▼
                       bar-aligned sections           ┌──► DIRECTOR ◄── Score JSON (cached)
          + HPSS corroboration + per-onset strength   │    fuses clock + Score + live
                       │                               │      → VisualState (per frame)
                       └──── POST /analyze ────────────┘             │
                                                                     ▼
                                                      GLSL scenes (read ONLY VisualState)
                                                       + bloom / ACES tone-map + feedback
                                                                     │
                                                                     ▼
                                                                  screen
```

## Two modes (toggle bottom-right)

- **Auto scenes** — analysis-driven. Drop any audio file → the analyzer returns a `Score` → the
  Director drives the scenes. Scene selection follows the song's sections and **crossfades on phrase
  boundaries**. Keys: `n` next scene · `1`–`5` pick · `a` toggle auto · `d` inspector · `t` tuning.
- **Choreograph** — a hand-choreography **tap recorder** (more experimental). Plays a bundled track;
  tap the **spacebar** in time to lay down each element's rhythm, record one element then another,
  and restart from any phrase to fix mistakes. Autosaves to `localStorage`.

## The analyzer

A local FastAPI service (`analyzer/`). Per track it produces a `Score`
([`src/types/contracts.ts`](src/types/contracts.ts)), cached on disk by content hash:

- **beat_this** (CPJKU) — beats, downbeats, BPM.
- **Demucs** (htdemucs) — source separation → per-instrument onsets: kick/snare/hat from the drums
  stem, bass, and melody from the lead/vocal stems.
- **librosa** — energy envelope, spectral centroid/flux, chroma + key (Krumhansl-Schmuckler), and
  bar-aligned structural sections; `isDrop` is inferred from sharp energy jumps.
- **HPSS** is used as an *independent* second opinion to filter spurious onsets, plus a per-onset
  **strength** (relative to the loudest hit in the song).

> **Why beat_this and not allin1?** The original plan used `allin1` for joint beats/sections, but its
> `NATTEN` dependency won't compile on this Mac's toolchain (clang 21). The engine is therefore
> `beat_this` + Demucs + librosa; the `Score` contract is unchanged. See
> [`analyzer/README.md`](analyzer/README.md).

## The scenes (frontend, GLSL via Three.js)

Each scene reads **only** the Director's `VisualState`. Compositor adds bloom + ACES tone-mapping and
ping-pong feedback trails.

- **Constellation** — each isolated layer is a colored dot that moves/pulses on its onsets (size &
  step ∝ hit strength); background tinted by the section's energy tier.
- **Strata** — instrument-separated light: core=kick, ring=bass, flash=snare, nodes=melody, etc.
- **Plasma** — domain-warped FBM fluid advected by the bass.
- **Particles** — a 3D point cloud punched by kicks.
- **Tunnel** — feedback trails forming an infinite tunnel.

## Running it

Two processes: the **analyzer** (`:8000`) and the **frontend** (`:5173`).

**Prereqs** (see [`docs/SETUP.md`](docs/SETUP.md) for detail): macOS/Apple Silicon, `ffmpeg`,
Node ≥ 18, and a native-arm64 **Python 3.10** for the analyzer venv.

```bash
# 1. analyzer env  (install order matters — see docs/SETUP.md)
python3.10 -m venv .venv && source .venv/bin/activate
pip install -r analyzer/requirements.txt
make doctor            # dependency preflight; tells you what's missing

# 2. frontend deps
npm install

# 3. run both (separate terminals), then open http://127.0.0.1:5173
make analyzer          # FastAPI on :8000
make dev               # Vite frontend on :5173
```

Other targets: `make fixtures` (synthetic test audio), `make analyze FILE=…` (POST a file to the
running service), `make test`, `make typecheck`, `make screenshot`.

> First analysis of a new track downloads the beat_this + Demucs model weights (one-time, needs
> network) and takes ~30–40 s to demix; it's cached afterward.

## Repo layout

```
analyzer/              Python FastAPI service
  doctor.py            dependency preflight
  api.py               GET /health, POST /analyze
  pipeline/            rhythm, stems, features, sections, score builder, schema, cache
  tests/               synthetic-signal tests (beats @ 0.5s, silence ~ 0, etc.)
src/
  types/contracts.ts   Score + VisualState (canonical contracts)
  audio/               decode, transport, latency-compensated master clock
  features/            Meyda live features
  director/            the Director (VisualState assembly + choreography)
  scenes/              GLSL scenes + compositor (bloom / tone-map / feedback)
  choreo/              Choreograph mode (tap recorder)
  ui/                  inspector overlay + Tweakpane tuning panel
docs/                  PLAN.md, SETUP.md, KICKOFF.md (the original build spec)
public/                bundled demo track for Choreograph mode
test/                  Playwright headless screenshot specs
CLAUDE.md              project constitution / original design intent
```

## Tests

- **vitest** — contract math + the Director (impulses on beats, `dropProximity`, channels in 0..1).
- **pytest** — synthetic-signal analyzer tests (objective, ear-free).
- **Playwright** — headless WebGL screenshots of each scene + the modes.

```bash
make test                       # vitest + pytest
npm run screenshot              # Playwright (auto specs need the analyzer running)
```
