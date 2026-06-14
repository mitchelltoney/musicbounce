# Synesthete — Kickoff Prompt

Paste the block below as your **first message** to Claude Code, with `CLAUDE.md`, `docs/PLAN.md`,
`docs/SETUP.md`, and `src/types/contracts.ts` already in the repo. (This file is just a reference copy.)

---

```
You're building Synesthete with me — a state-of-the-art audio-reactive visual instrument. Read
CLAUDE.md, docs/PLAN.md, docs/SETUP.md, and src/types/contracts.ts first. They are the constitution,
the build order, the environment, and the law for data shapes. Don't write code until we've agreed
on the plan (steps 1–3 below).

THE PHILOSOPHY, in one line: the screen is an instrument the song plays. We are NOT building a
spectrum analyzer that twitches at audio. We're building a performer that DANCES with the music — it
winds up before the drop and releases on it. That anticipation is the whole point, and it's only
possible because we analyze the song's STRUCTURE ahead of time (offline → a "Score") and choreograph
against it, while live FFT handles moment-to-moment texture. Reaction is easy and dead; anticipation
is the craft.

TASTE MATTERS AS MUCH AS CORRECTNESS. Restraint creates dynamic range — quiet parts look quiet so the
drop lands. Major visual changes snap to downbeats / phrase boundaries, never random frames. Different
instruments drive different visual layers (kick → core pulse, bass → global warp, snare/mid → texture,
hat/air → sparkle, vocals → a foreground element) so it reads like the arrangement. The screen
remembers (feedback trails). Color is 2–3 hues plus an accent that shift with the music's harmony,
never a rainbow. A few strong scenes beat many weak ones.

ANALYSIS IS STATE OF THE ART, PYTHON, FROM DAY ONE — no compromise. A local FastAPI service
(analyzer/) that the frontend POSTs audio to:
- allin1 (mir-aidj/all-in-one) for joint beats, downbeats, BPM, and functional sections.
- It demixes with Demucs, so reuse the stems: detect onsets on the isolated DRUMS stem for clean
  kick/snare/hat, BASS stem for the bassline, VOCALS stem energy for presence. Prefer stem onsets over
  band-split onsets. Do not demix twice.
- librosa for per-band onsets (full-mix fallback), energy envelope, spectral features, chroma + key.
- Fuse into the Score JSON exactly as defined in contracts.ts (mirror it with a pydantic model).
- Infer drops from energy jumps (allin1 doesn't label them); the Director turns that into
  dropProximity, the anticipation signal.

BEFORE WRITING ANY CODE:
1. Read the four files and restate the architecture and the two contracts (Score, VisualState) back to
   me in your own words, so I know we're aligned.
2. Propose the full phased plan (Phases 0–6 from docs/PLAN.md) with the exact "Done when" checkpoint
   for each. Refine the contracts if you see real gaps — but flag every change explicitly; never let
   the analyzer and renderer drift silently.
3. List your assumptions and your questions for me (e.g. confirm I'm on Apple Silicon, whether to ship
   beat_this as the rhythm fallback now or later, what test audio you need).

THEN BUILD PHASE 0 ONLY, and the FIRST thing you build is analyzer/doctor.py — the dependency preflight
(`python -m analyzer.doctor` / `make doctor`) that checks every dependency per docs/SETUP.md and prints
a ✓/✗ report with the exact fix command for each miss. Run it and tell me, in plain language, exactly
what is missing and what I must do. The rest of Phase 0: the Vite/TS/React skeleton with audio playback
driven by the latency-compensated audioContext.currentTime clock, a trivial animated GLSL shader on a
fullscreen quad (Three.js + postprocessing) with an FPS counter; the FastAPI skeleton with GET /health;
the synthetic fixture generator (click-120bpm, silence, tone-440, noise-burst); a headless Playwright
screenshot script (with the WebGL flags in SETUP); and a Makefile (doctor / analyzer / dev / analyze /
test). Generate requirements.txt only AFTER doctor confirms the platform-correct torch + NATTEN
versions — don't guess pins. Phase 0 is done when: make doctor prints a full report, GET /health is ok,
an audio file plays while the canvas animates on the audio clock, npm test is green on a stub, and a
headless screenshot is captured.

NON-NEGOTIABLES, every phase (full list in CLAUDE.md):
- Timing comes ONLY from audioContext.currentTime, latency-compensated. Never rAF timestamps or
  Date.now() for musical timing.
- The analyzer is out-of-process; the frontend awaits it. The render loop and audio live OUTSIDE React
  (refs, imperative) — zero per-frame re-renders.
- Smooth every continuous channel; beats/kicks are impulses with instant attack and exponential decay.
  Never strobe a continuous channel to fake a hit.
- 60 fps floor; heavy work on the GPU in shaders.
- contracts.ts is law; the Python Score mirrors it exactly.
- End every phase with passing synthetic-signal tests and a captured screenshot. We are deaf —
  correctness must be objective (120 BPM click → beats at 0.5s; silence → ~zero energy; 440 Hz tone →
  only its band). Aesthetic judgment is mine, via the tuning panel + screenshots.

WHEN YOU'RE BLOCKED ON ME, STOP AND SAY SO. You can't install system packages, download model weights,
grant tool access, or supply audio. Tell me the exact action and why — don't guess install commands,
stub past a missing model, or fake analysis output. Verify library APIs and the torch/NATTEN/allin1
install matrix against live docs (use the Context7 MCP), not memory. Use the Playwright MCP to launch
the app and screenshot your own visual output so you can see what you built.

Start with steps 1–3. No code until we agree on the plan.
```
