# Synesthete — audio-reactive visual instrument

> The screen is an instrument the song plays. We translate sound into a visual sense —
> not a meter that twitches at audio, but a performer that **dances** with it.
>
> Working name "Synesthete" (the app translates one sense into another). Rename freely.

This file is the constitution. `docs/PLAN.md` is the build order. `docs/SETUP.md` is the
environment + dependencies. `src/types/contracts.ts` is the law for data shapes. Read all four
before writing code.

---

## Prime directive: anticipation over reaction

A spectrum analyzer can only react to a transient *after* it fires. We refuse that. We analyze the
song's **structure ahead of time** (offline → a `Score`) and choreograph against it — visuals wind
up *before* the drop and release *on* it. Offline analysis = choreography; live FFT = texture.
Two clocks, one feeling. Reaction is easy and dead; anticipation is the craft.

---

## Architecture (five layers, clean contracts)

```
audio file
  │ decode (Web Audio)                         ┌── POST /analyze (multipart) ──┐
  ▼                                            ▼                               │
Audio I/O ── master clock ──┐        Python analyzer (LOCAL service)           │
  │ play                    │        allin1 (beats/downbeats/sections)         │
  ▼                         │        + Demucs stems → per-stem onsets          │
AnalyserNode + Meyda        │        + librosa (bands/energy/chroma/key)       │
  │ live features           │                  │                               │
  ▼                         │                  ▼                               │
(smoothed bands) ───────────┴────────►  D I R E C T O R  ◄──── Score JSON ──────┘ (cached by hash)
                                        fuses currentTime + Score + live feats
                                                 │  → VisualState (per frame)
                                                 ▼
                                          Scene (GLSL) ×N      ← reads ONLY VisualState
                                                 │ render-to-texture
                                                 ▼
                                     Feedback (ping-pong) + Bloom / Post
                                                 │
                                                 ▼
                                               Screen
```

- **Audio I/O** — decode, transport, and the master clock.
- **Analyzer (Python, local, SOTA)** — see below. Emits a `Score`.
- **Live features** — Meyda on the playing source → smoothed band energies (the alive texture).
- **Director** — the only brain. Fuses `audioContext.currentTime` + `Score` + live features into a
  per-frame `VisualState`. Owns all choreography, impulses, phase, and aesthetics.
- **Render** — Scenes consume `VisualState` and nothing else. Compositor adds feedback + bloom.

---

## Analysis: state of the art, Python from day one

We do not compromise on tracking quality. The analyzer is a **local FastAPI service**
(`analyzer/`) the frontend POSTs audio to. No cloud required — it runs on this machine.

Primary pipeline per track:
1. **allin1** (`mir-aidj/all-in-one`) — joint **beats, downbeats, beat-positions, BPM, and
   functional sections** (intro/verse/chorus/bridge/break/inst…). SOTA on Harmonix. It demixes with
   **Demucs (htdemucs)** internally, so stems are available.
2. **Stems → per-stem onsets** (librosa onset detection on the isolated stems). This is the quality
   unlock: onsets on the **drums** stem give clean **kick / snare / hat** timing; **bass** stem gives
   the bassline; **vocals** stem energy gives vocal presence. Prefer stem onsets over band-split
   onsets whenever stems exist. Reuse allin1's demix cache — do not demix twice.
3. **librosa** — per-**band** onsets (full-mix fallback), energy envelope, spectral
   centroid/flux, chroma + key (Krumhansl-Schmuckler). Normalize envelopes to 0..1.
4. Fuse → `Score` JSON (exact shape in `contracts.ts`). Cache by `sourceHash`.

`Score.sections` come from allin1, normalized via `ALLIN1_LABEL_MAP`. **Drops are not labeled by
allin1** — infer `isDrop` from a sharp energy jump at a section onset (esp. into a high-energy
`chorus`/`build`→`drop` after a `breakdown`). The Director turns this into `dropProximity`.

Swappable: `beat_this` is the rhythm-only SOTA fallback if allin1 install is blocked. Essentia.js
(WASM) may be added later as an offline no-server fallback. The interface (`Score`) never changes.

---

## Hard rules

- **CLOCK.** Drive everything from `audioContext.currentTime`, latency-compensated:
  `t = ctx.currentTime - startOffset - ctx.outputLatency`. NEVER rAF timestamps or `Date.now()` for
  musical timing. Scenes read `VisualState.tSec`.
- **Analysis never blocks the UI.** It's an out-of-process Python service; the frontend awaits it.
  In-browser fallback analysis (if ever added) runs in a Web Worker, never the main thread.
- **Smoothing.** Every continuous channel is one-pole low-passed (`smooth()` in `contracts.ts`),
  per-channel `tau` (slow for `intensity`, fast for `air`). Nothing pops except intentional impulses.
- **Impulses.** Beats/kicks/etc. snap to ~1 then `decayImpulse()`. Instant attack, exp decay. Never
  strobe a continuous channel to fake a hit; never harsh on/off flicker.
- **60 fps is the floor.** Heavy lifting goes to the GPU in fragment shaders, not JS. The render loop
  does minimal per-frame CPU work.
- **React stays out of the loop.** React renders UI chrome only (file drop, transport, scene picker,
  tuning panel). The render loop and audio live in imperative modules with refs — zero per-frame
  re-renders.
- **Contracts are law.** `src/types/contracts.ts` is canonical. The Python analyzer mirrors `Score`
  exactly. Shapes don't drift silently.

---

## Aesthetic doctrine (output must have taste, not just react)

- **Restraint creates dynamic range.** Quiet sections look quiet so the drop *hits*. Map energy to
  visual energy across a WIDE range; never max everything always. Use `intensity`.
- **Phrasing.** Major visual changes (scene swaps, palette shifts) snap to **downbeats / phrase
  boundaries** (4, 8, 16 bars), never random frames.
- **Instrument-separated light.** Different sources drive different layers: `kick` → core pulse,
  `bass` → global warp/scale, `mid`/`snare` → texture, `hat`/`air` → sparkle/particles, `vocalPresence`
  → a foreground element. It should read like the arrangement.
- **The screen remembers.** Use feedback / ping-pong trails for flow and motion memory.
- **Color is feeling.** 2–3 hues + an accent, modulated by key/chroma (`hueShift`, `mood`). Never a
  rainbow. Restrained palettes that shift with the music's harmony.
- **A few strong scenes beat many weak ones.** Each scene is a distinct visual *world*, not a filter.

---

## Testing doctrine — we are deaf, make correctness objective

Claude cannot hear audio or judge sync by ear. So sync correctness must be *testable*, and aesthetic
judgment is the human's (Mitchell, via fast HMR + the tuning panel + screenshots).

- **Synthetic signals are ground truth.** Unit-test the analyzer with generated fixtures:
  a 120 BPM click → beats at 0.5 s ± tolerance AND downbeats every 4 beats; silence → ~zero energy;
  a pure 440 Hz tone → only the matching band lights; a band-limited noise burst → onset detected in
  the right band/stem. These run in CI without ears.
- **Visual loop.** Use the Playwright MCP to launch the app and screenshot rendered frames; a human
  reviews feel. Headless Chromium needs WebGL flags (see SETUP).
- **Every phase ends with green tests + a captured screenshot.** No big-bang; working software at
  each checkpoint.

---

## When you need me, STOP and say so

You can't install system packages, download model weights, grant tool access, or supply audio
yourself. The **first thing you build is `analyzer/doctor.py`** (`python -m analyzer.doctor` /
`make doctor`): it checks every dependency and prints a ✓/✗ report with the exact fix command for
each miss. Run it, then tell me — in plain terms — precisely what is missing or what action I must
take and why. Do not fake analysis output, stub past a missing model, or guess install commands.
Verify library APIs and install matrices against live docs (Context7) rather than memory; the
torch / NATTEN / allin1 version matrix shifts and a wrong pin will waste a day.

---

## Repo layout

```
CLAUDE.md                 this file
docs/PLAN.md              phased build order + checkpoints
docs/SETUP.md             prerequisites, env, dependency matrix, the doctor
docs/KICKOFF.md           the first prompt (reference copy)
src/
  types/contracts.ts      Score + VisualState (canonical)
  audio/                  decode, transport, master clock
  features/               Meyda live features + smoothing
  director/               the conductor: VisualState assembly, choreography, drop logic
  scenes/                 GLSL scenes + scene manager + feedback/bloom compositor
  presets/                mapping "VJ packs"
  ui/                     React chrome + Tweakpane tuning panel
analyzer/                 Python FastAPI service (allin1 + Demucs + librosa)
  doctor.py               dependency preflight (BUILD FIRST)
  api.py                  POST /analyze, GET /health
  pipeline/              allin1 wrapper, stem onsets, librosa features, Score builder
  tests/                 synthetic-signal unit tests
fixtures/                test audio (see SETUP)
test/                    frontend tests + Playwright screenshot scripts
```
