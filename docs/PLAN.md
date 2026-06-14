# Synesthete — Build Plan

Working software at every checkpoint. Each phase ends with **green tests + a captured screenshot**
(where visual) and a stated "Done when." Don't start a phase until the previous checkpoint passes.
Read `CLAUDE.md` and `src/types/contracts.ts` first.

The analyzer is **Python, state-of-the-art, from day one** (allin1 + Demucs stems + librosa).

---

## Phase 0 — Monorepo skeleton + the doctor + harnesses

Stand up both halves and the safety nets before any real feature.

- **Frontend** (`src/`): Vite + React + TypeScript (strict). File-drop + Web Audio playback driven by
  the **latency-compensated `audioContext.currentTime` clock**. Transport (play/pause/seek). A render
  canvas with one trivial animated GLSL shader on a fullscreen quad (Three.js + `postprocessing`).
  On-screen FPS counter.
- **Analyzer** (`analyzer/`): FastAPI skeleton with `GET /health` and **`doctor.py` FIRST**
  (`python -m analyzer.doctor` / `make doctor`) — checks every dependency (see SETUP) and prints a
  ✓/✗ report with the exact fix command per miss, exits non-zero on any required miss.
- **Harnesses**: a synthetic **click-track generator** (writes `fixtures/click-120bpm.wav`,
  `silence.wav`, `tone-440.wav`, `noise-burst.wav`); a headless **Playwright screenshot** script for
  the canvas (with the WebGL flags from SETUP).
- **Tooling**: a `Makefile` (`doctor`, `analyzer` = run service, `dev` = run frontend,
  `analyze FILE=…`, `test`). Generate `analyzer/requirements.txt`/`pyproject` **after** doctor confirms
  the platform-correct torch/NATTEN versions — don't guess pins.

**Done when:** `make doctor` prints a full dependency report; `GET /health` returns ok; an audio file
plays and the canvas animates on the audio clock; `npm test` is green on a stub; a headless screenshot
of the canvas is captured to disk.

---

## Phase 1 — SOTA analyzer → Score

The heart. Implement the real pipeline and the `Score` contract.

- allin1 → BPM, beats, downbeats, beat-positions, sections. Normalize labels via `ALLIN1_LABEL_MAP`.
- Reuse allin1's Demucs demix cache → per-**stem** onsets (drums→kick/snare/hat, bass→bassline) via
  librosa. Do **not** demix twice.
- librosa → per-**band** onsets (full-mix fallback), energy envelope (normalized 0..1), spectral
  centroid/flux, chroma + key (Krumhansl-Schmuckler). Infer `Section.isDrop` from energy jumps.
- Fuse → `Score` JSON. `POST /analyze` (multipart upload) returns it. **Cache by `sourceHash`** to
  disk so re-analysis of the same file is instant.
- Frontend: a thin client that POSTs the dropped file, shows an analysis progress/loading state, and
  stores the returned `Score`.

**Done when (objective, no ears):**
- `fixtures/click-120bpm.wav` → detected beats at 0.5 s ± tolerance, BPM ≈ 120, downbeats every 4 beats.
- `silence.wav` → energy envelope ≈ 0, no spurious onsets.
- `tone-440.wav` → energy concentrated in the correct band; `noise-burst.wav` → onset at the right time.
- A real EDM track → `sections` include a high-energy `chorus`/`drop`; drums-stem onsets line up with
  the audible kick on a timeline overlay (human spot-check).
- Same file analyzed twice → second call served from cache.

---

## Phase 2 — Live features

The alive texture that the offline Score can't provide.

- Meyda `createMeydaAnalyzer` on the playing source → RMS, the 7 band energies (`BandName`), spectral
  centroid/flux, chroma. Smooth each with `smooth()` and per-channel `tau`.
- A debug overlay (meters/bars) visualizing the live features in real time. Drive the Phase-0 shader
  from live `low/mid/high` so the link is visible.

**Done when:** the debug meters and the trivial shader visibly track the music in real time; smoothing
removes jitter without lag that feels wrong.

---

## Phase 3 — The Director (the conductor)

Fuse everything into `VisualState`. This is where anticipation is manufactured.

- Each frame: read latency-compensated `tSec`, locate position in `Score` (current/next beat,
  downbeat, section) and combine with live features →
  - continuous channels (`energy`, `band[]`, `low/mid/high`, `vocalPresence`, `brightness`) — smoothed.
  - impulses (`beat`, `kick`, `snare`, `hat`, `bass`, `downbeat`) — fired from Score onset times
    (prefer stems), instant attack + `decayImpulse()`. Schedule with a small lookahead against `tSec`.
  - phase (`beatPhase`, `barPhase`, `beatsUntilDownbeat`).
  - structure (`section`, `sectionProgress`, `intensity`).
  - **`dropProximity`**: ramp 0→1 over the bars leading into the next `isDrop` section onset; snap to 0
    at the drop, then `sinceDrop` governs the afterglow. THE anticipation signal.
  - aesthetics (`palette`, `hueShift`, `mood`) from key/chroma/energy.
- Provide a **VisualState inspector** overlay (numeric + sparkline) for verification.

**Done when:** impulses fire exactly on beats (verified against the timeline overlay and `tSec`);
`dropProximity` ramps in the bars before a labeled drop and releases on it; all channels stay in 0..1
and look sane on the inspector across a full track.

---

## Phase 4 — Scenes + compositor (the art)

- A `Scene` interface (`init(gl, ctx)`, `render(visualState)`, `resize`, `dispose`) + a scene manager.
- 3–4 distinct GLSL worlds, each reading ONLY `VisualState`. Suggested archetypes:
  - **Particle Field** — `Points`, count/size/turbulence driven by energy + `kick`/`bass`.
  - **Fluid / Plasma** — domain-warped FBM noise, advected by bass, ignited by impulses.
  - **Geometric Tunnel** — raymarched or layered geometry with **feedback** for the infinite-tunnel look.
  - **Reaction-Diffusion** — a living organism that blooms on drops.
- A reusable **ping-pong feedback** utility (RTT, sample previous frame transformed + faded → trails).
- Post: **bloom** (`UnrealBloomPass`, non-negotiable for the glow), optional chromatic aberration +
  film grain. Bloom strength can track `intensity`.

**Done when:** each scene holds ≥60 fps at the target resolution, reacts musically, and a screenshot of
each is captured for review.

---

## Phase 5 — Mapping presets + choreography

Turn raw reactivity into a performance.

- **Presets / "VJ packs"**: data that defines how `VisualState` maps to each scene's params + the
  palette logic. Hot-swappable.
- **Section-aware direction**: choose/blend scenes by `section` and `intensity`; **crossfade on phrase
  boundaries** (downbeats), never mid-phrase. Build → drop choreography uses `dropProximity` (tension)
  then `sinceDrop` (release/afterglow).
- **Live tuning panel** (Tweakpane or leva) exposing the mapping params so Mitchell tunes the feel in
  real time. This is the human-in-the-loop aesthetic interface — build it usable.

**Done when:** a full track plays start→finish with scene changes landing on phrase boundaries, a
build that visibly tenses, and a drop that lands; mapping params are tunable live and the change is
immediate.

---

## Phase 6 — Polish, performance, deploy

- Performance pass: profile (Chrome DevTools MCP), lock 60 fps (120 where the display allows), guard
  against GC hitches, handle resize / DPI / fullscreen, keyboard shortcuts (play, next scene, fullscreen,
  toggle overlays).
- UX: error states (analyzer down, unsupported file, model still downloading), loading states, a scene/
  preset switcher.
- **Deploy**: frontend ships static (Vercel/Netlify/Cloudflare Pages, like NoteFlow). The analyzer runs
  **locally** — package it for one-command start (`make analyzer`, optional Dockerfile). Document that
  the hosted frontend talks to `localhost` analyzer for personal use.
- Optional reach goals: **video export** (`MediaRecorder` on the canvas), shareable preset JSON,
  **mic / line-in** mode for live VJ use (live features only, no offline Score).

**Done when:** the app is fullscreen-capable, recovers gracefully from analyzer/model issues, holds the
frame budget on a real track, and starts with documented commands.
