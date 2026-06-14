# Synesthete

An audio-reactive visual instrument: drop in a song, and the screen *dances* with it — winding up
before the drop and releasing on it, like an EDM light show rendered to a screen instead of lights.

The trick is **anticipation over reaction**. We analyze a song's structure ahead of time with a
state-of-the-art Python pipeline (allin1 for beats/downbeats/sections + Demucs stems for clean
kick/snare/hat/bass timing + librosa for energy/spectral/harmony) and choreograph against it, while
live FFT supplies moment-to-moment texture. A "Director" fuses both into a per-frame `VisualState`
that GPU shader "scenes" render.

## Layout
- `CLAUDE.md` — the constitution (architecture, rules, aesthetic + testing doctrine). Start here.
- `docs/PLAN.md` — phased build order with checkpoints.
- `docs/SETUP.md` — prerequisites, the SOTA Python install (order matters), and the dependency doctor.
- `docs/KICKOFF.md` — the first prompt to give Claude Code.
- `src/types/contracts.ts` — the `Score` and `VisualState` contracts (canonical).

## Start
1. Keep these files in the repo.
2. Skim `CLAUDE.md`, then `docs/SETUP.md`.
3. Paste the block in `docs/KICKOFF.md` as your first message to Claude Code.
4. Claude builds `analyzer/doctor.py` first and tells you exactly which dependencies are missing.

## Stack
Frontend: Vite + React + TypeScript, Three.js + `postprocessing` (bloom), Meyda, Tweakpane.
Analyzer (local, Python): FastAPI + allin1 + Demucs + librosa. Runs on your machine; no cloud needed.
Recommended MCPs for Claude Code: **Context7** (live library docs), **Playwright** (screenshot the
rendered canvas so Claude can see its output), **Chrome DevTools** (profile the render loop),
**GitHub** (reference shaders / project hygiene).
