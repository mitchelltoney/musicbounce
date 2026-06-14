# Synesthete — Setup & Dependencies

This is what must exist on the machine for the SOTA analyzer to run, and how Claude detects what's
missing. The fragile parts are called out explicitly. **Verify exact versions live at install time
(Context7 / project docs)** — the torch / NATTEN / allin1 compatibility matrix shifts, and a wrong
pin wastes hours. The **doctor** (below) is the source of truth for "what's missing right now."

Primary target: **macOS, Apple Silicon** (this machine). Linux + NVIDIA/CUDA notes included for a GPU
box or future deployment.

---

## 0. The doctor (build this FIRST — it tells me what I'm missing)

`analyzer/doctor.py`, run via `python -m analyzer.doctor` or `make doctor`. It prints a ✓/✗ table and
the exact fix command per miss, and exits non-zero if any **required** item fails. It checks:

| Check | How | Required |
|---|---|---|
| Python version is 3.10 or 3.11 | `sys.version_info` (warn on 3.12+, torch/NATTEN wheels lag) | warn |
| `ffmpeg` on PATH | `shutil.which("ffmpeg")` | **yes** (librosa/Demucs decode) |
| torch imports + device | `import torch`; report `cuda.is_available()`, `mps.is_available()`, else CPU | **yes** |
| `natten` imports + matches torch | `import natten`; report version; flag torch/NATTEN mismatch | **yes** (allin1 dep) |
| `allin1` imports | `import allin1` | **yes** |
| `demucs` imports | `import demucs` | **yes** (stems) |
| `librosa`, `soundfile`, `numpy`, `scipy` import | imports | **yes** |
| `fastapi`, `uvicorn`, `python-multipart` import | imports | **yes** |
| allin1 + Demucs model weights present | check the model cache dir; else note "downloads on first run (~GBs, needs network)" | warn |
| free disk space | `shutil.disk_usage` ≥ a few GB | warn |
| Node ≥ 18 (frontend) | `node -v` via subprocess | warn |

Claude runs the doctor, then reports to me in plain language: what's missing, the one command to fix
each, and anything I must do (download models, free disk, install a system tool). Claude does **not**
guess install commands or stub past a missing model.

---

## 1. System prerequisites

- **Python 3.10 or 3.11** (recommended; do **not** assume the newest Python works with torch+NATTEN).
  Use `pyenv`/`conda`/`uv` to get a clean interpreter.
- **ffmpeg** — required for audio decoding.
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt-get install ffmpeg`
- **Node ≥ 18** for the Vite frontend.

---

## 2. Frontend setup (`src/`)

```bash
npm install
npm run dev        # Vite dev server
```

Core deps Claude will add: `three`, `postprocessing`, `meyda`, `zustand`, `tweakpane` (or `leva`),
plus dev: `typescript`, `vite`, `@playwright/test`.

---

## 3. Analyzer setup (`analyzer/`) — the SOTA, install-order matters

Create an isolated env on **Python 3.10/3.11**, then install in this order. Order matters because
NATTEN must be built/selected against the installed torch.

```bash
# 1) clean env (pick one)
conda create -n synesthete python=3.11 -y && conda activate synesthete
#   or: pyenv + python -m venv .venv && source .venv/bin/activate
#   or: uv venv --python 3.11 && source .venv/bin/activate

# 2) PyTorch — PLATFORM SPECIFIC. Verify the current command at pytorch.org.
#    macOS (Apple Silicon, MPS/CPU):
pip install torch torchaudio
#    Linux + NVIDIA (match your CUDA), e.g.:
# pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# 3) NATTEN — MUST match the torch + platform you just installed. THE fragile step.
#    Check https://github.com/SHI-Labs/NATTEN for the correct wheel/build for your torch/CUDA/macOS.
#    A wrong NATTEN is the #1 cause of allin1 import failures.
pip install natten   # may require a specific wheel index or building from source

# 4) the analyzer stack
pip install allin1 demucs librosa soundfile numpy scipy

# 5) the service
pip install fastapi uvicorn python-multipart
```

Then:

```bash
make doctor        # confirm everything resolved BEFORE running the service
make analyzer      # uvicorn analyzer.api:app --reload --port 8000
```

**Generate `requirements.txt`/`pyproject` only after `doctor` is green** — pin the versions that
actually work on this machine, not guessed ones.

### First-run model downloads
allin1 and Demucs (htdemucs) download model weights on first analysis (~GBs, needs network, cached
afterward). The first `POST /analyze` will be slow and require internet; later ones are fast. The
doctor warns if weights aren't cached yet.

### Device & speed expectations
- Apple Silicon: runs on **MPS** where supported, CPU otherwise. A full song analyzes in roughly tens
  of seconds to a couple of minutes (one-time, cached). That's fine — analysis is offline.
- Linux + CUDA: much faster; preferred for batch analysis.
- The pipeline should auto-select device: `cuda` > `mps` > `cpu`.

---

## 4. Headless WebGL (for Playwright screenshots)

So Claude's screenshot loop actually renders GPU content headlessly, launch Chromium with:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist
```

SwiftShader gives software WebGL in CI. Screenshots verify **correctness** (is the picture right), not
true GPU **performance** — profile perf on the real machine.

---

## 5. Test fixtures (`fixtures/`)

Generated by the Phase-0 harness (deterministic, for objective tests):
- `click-120bpm.wav` — beat ground truth (beats at 0.5 s, downbeats every 4).
- `silence.wav` — energy ≈ 0, no onsets.
- `tone-440.wav` — single band lights.
- `noise-burst.wav` — onset timing in the right band/stem.

Provided by me (real audio, varied — Claude can't source these):
- One EDM track with an **obvious build + drop** (tests structure + anticipation).
- 2–3 tracks of different genres/tempos (robustness).
Drop these in `fixtures/real/`. **Tell me if you need them and what characteristics** (genre, tempo,
a clear drop) and I'll add them.

---

## 6. Known failure modes → fixes

| Symptom | Cause | Fix |
|---|---|---|
| `allin1` import error mentioning natten | NATTEN/torch mismatch | reinstall NATTEN for the exact torch/platform (step 3) |
| librosa/Demucs "audio backend"/decode error | ffmpeg missing | `brew install ffmpeg` (macOS) |
| First `/analyze` hangs / fails offline | model weights not downloaded | ensure network on first run; weights cache after |
| torch installs but no acceleration | wrong wheel / OS limits | macOS uses MPS/CPU (no CUDA); verify torch build at pytorch.org |
| Demucs OOM or very slow | big model / CPU | use a smaller `--segment`, ensure enough RAM, or run on a CUDA box |
| Newest Python, nothing installs | wheel availability lags | use Python 3.10/3.11 |

---

## 7. What I (Mitchell) must provide — Claude, ask explicitly when blocked

- Installing **system tools** (ffmpeg, a specific Python) — Claude can't.
- Letting **model weights download** (network + disk) — Claude can't authorize the wait.
- Supplying **real test audio** — Claude can't source it.
- Granting **tool access** (Playwright MCP, Context7 MCP, GitHub MCP) — see the kickoff prompt.
- Final **aesthetic judgment** — that's mine, via the tuning panel + screenshots.

For each, Claude should stop and tell me the exact action and why, rather than guessing or faking it.
