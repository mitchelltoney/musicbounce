"""
analyzer.doctor — dependency preflight for Synesthete's SOTA analyzer.

    python -m analyzer.doctor      (or: make doctor)

Prints a ✓/⚠/✗ report for every dependency the analyzer needs, with the exact
fix command for each miss, and exits non-zero if any REQUIRED item is missing.

This is the source of truth for "what's missing right now." It does not guess
install commands for the fragile torch/NATTEN step — it reports state and points
at SETUP.md, which is verified against live docs at install time.
"""
from __future__ import annotations

import importlib
import os
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# tiny result model
# ──────────────────────────────────────────────────────────────────────────────
OK, WARN, FAIL = "OK", "WARN", "FAIL"
SYMBOL = {OK: "\033[32m✓\033[0m", WARN: "\033[33m⚠\033[0m", FAIL: "\033[31m✗\033[0m"}
PLAIN = {OK: "OK", WARN: "WARN", FAIL: "FAIL"}


@dataclass
class Result:
    name: str
    status: str
    detail: str = ""
    fix: str = ""
    required: bool = True


@dataclass
class Section:
    title: str
    results: list[Result] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────────────
def _import(modname: str):
    """Import a module, returning (module, version, error)."""
    try:
        m = importlib.import_module(modname)
        ver = getattr(m, "__version__", "") or getattr(m, "version", "") or ""
        return m, str(ver), None
    except BaseException as e:  # noqa: BLE001 - some libs raise non-Exception on bad ABI
        return None, "", e


def check_import(modname: str, pip: str | None = None, *, required=True, label=None) -> Result:
    label = label or modname
    m, ver, err = _import(modname)
    if m is not None:
        return Result(label, OK, ver, required=required)
    return Result(
        label,
        FAIL if required else WARN,
        f"import failed: {type(err).__name__}: {str(err)[:80]}",
        fix=f"pip install {pip or modname}",
        required=required,
    )


def _run(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return (out.stdout or out.stderr).strip()
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────────────
# individual checks
# ──────────────────────────────────────────────────────────────────────────────
def check_python() -> Result:
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) in {(3, 10), (3, 11)}:
        return Result("python", OK, f"{ver} ({sys.executable})", required=False)
    return Result(
        "python",
        WARN,
        f"{ver} — torch/NATTEN wheels target 3.10/3.11; {ver} may lack wheels",
        fix="create the venv with python3.11:  python3.11 -m venv .venv && source .venv/bin/activate",
        required=False,
    )


def check_ffmpeg() -> Result:
    path = shutil.which("ffmpeg")
    if path:
        ver = (_run(["ffmpeg", "-version"]) or "").splitlines()
        return Result("ffmpeg", OK, ver[0] if ver else path)
    return Result("ffmpeg", FAIL, "not on PATH", fix="brew install ffmpeg  (macOS) / apt install ffmpeg (Linux)")


def check_torch() -> list[Result]:
    torch, ver, err = _import("torch")
    if torch is None:
        return [Result(
            "torch", FAIL, f"import failed: {type(err).__name__}",
            fix="install per pytorch.org for your platform (macOS arm64: pip install torch torchaudio)",
        )]
    # device selection: cuda > mps > cpu
    try:
        if torch.cuda.is_available():
            dev = f"cuda ({torch.cuda.get_device_name(0)})"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            dev = "mps (Apple GPU)"
        else:
            dev = "cpu"
    except Exception as e:  # noqa: BLE001
        dev = f"cpu (device probe error: {type(e).__name__})"
    res = [Result("torch", OK, f"{ver} — device: {dev}")]
    res.append(check_import("torchaudio", "torchaudio"))
    return res


# NOTE: allin1 / NATTEN were evaluated and dropped on macOS — NATTEN's old C++ won't
# compile under clang 21 (see analyzer/README.md). The analyzer uses beat_this + Demucs
# + librosa instead; NATTEN is no longer a required dependency.


def check_models() -> Result:
    """beat_this + Demucs weights download on first analysis. Warn if absent."""
    home = Path.home()
    demucs_ckpts = home / ".cache" / "torch" / "hub" / "checkpoints"
    beatthis_dir = home / ".cache" / "beat_this"
    has_demucs = demucs_ckpts.exists() and any(demucs_ckpts.glob("*.th"))
    has_beatthis = beatthis_dir.exists() and any(beatthis_dir.iterdir()) if beatthis_dir.exists() else False
    if has_demucs and has_beatthis:
        return Result("model weights", OK, "beat_this + demucs caches present", required=False)
    missing = []
    if not has_beatthis:
        missing.append("beat_this")
    if not has_demucs:
        missing.append("demucs(htdemucs)")
    return Result(
        "model weights",
        WARN,
        f"not cached: {', '.join(missing)} — downloads on first analysis (needs network)",
        fix="run one analysis with network access; weights cache afterward",
        required=False,
    )


def check_disk() -> Result:
    free_gb = shutil.disk_usage(".").free / 1e9
    if free_gb >= 8:
        return Result("disk space", OK, f"{free_gb:.0f} GB free", required=False)
    if free_gb >= 4:
        return Result("disk space", WARN, f"{free_gb:.0f} GB free — tight for torch + model weights (~5-8 GB)",
                      fix="free some disk before installing the stack / downloading weights", required=False)
    return Result("disk space", FAIL, f"{free_gb:.1f} GB free — too low for the stack",
                  fix="free disk; torch + weights need several GB", required=False)


def check_node() -> Result:
    out = _run(["node", "-v"])
    if not out:
        return Result("node", WARN, "not found", fix="install Node ≥ 18 (frontend)", required=False)
    try:
        major = int(out.lstrip("v").split(".")[0])
    except Exception:
        major = 0
    if major >= 18:
        return Result("node", OK, out, required=False)
    return Result("node", WARN, f"{out} (<18)", fix="upgrade Node to ≥ 18", required=False)


# ──────────────────────────────────────────────────────────────────────────────
# assemble + render
# ──────────────────────────────────────────────────────────────────────────────
def build_report() -> list[Section]:
    return [
        Section("System", [check_python(), check_ffmpeg(), check_node(), check_disk()]),
        Section("PyTorch (acceleration core)", check_torch()),
        Section("Analyzer engine (beats / stems / features)", [
            check_import("beat_this", "beat-this"),
            check_import("demucs"),
            check_import("librosa"),
            check_import("soundfile"),
            check_import("numpy"),
            check_import("scipy"),
        ]),
        Section("Service libraries (FastAPI)", [
            check_import("fastapi"),
            check_import("uvicorn"),
            check_import("multipart", "python-multipart", label="python-multipart"),
        ]),
        Section("Models / resources", [check_models()]),
    ]


def main() -> int:
    use_color = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
    sym = SYMBOL if use_color else PLAIN

    print()
    print("  Synesthete — analyzer doctor")
    print(f"  {platform.platform()}  |  {platform.machine()}  |  python {sys.version.split()[0]}")
    print(f"  interpreter: {sys.executable}")
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    print(f"  virtualenv:  {'yes' if in_venv else 'NO — you are using a system interpreter'}")
    print("  " + "─" * 68)

    sections = build_report()
    fails: list[Result] = []
    warns: list[Result] = []
    n_ok = 0

    for sec in sections:
        print(f"\n  {sec.title}")
        for r in sec.results:
            mark = sym[r.status]
            print(f"    {mark}  {r.name:<16} {r.detail}")
            if r.status == FAIL:
                fails.append(r)
            elif r.status == WARN:
                warns.append(r)
            else:
                n_ok += 1

    print("\n  " + "─" * 68)
    required_fails = [r for r in fails if r.required]
    print(f"  {n_ok} ok · {len(warns)} warning(s) · {len(fails)} failure(s) "
          f"({len(required_fails)} required)")

    if fails or warns:
        print("\n  Fix commands:")
        for r in fails + warns:
            if r.fix:
                tag = "REQUIRED" if (r.required and r.status == FAIL) else "optional"
                print(f"    • [{tag}] {r.name}: {r.fix}")

    if required_fails:
        print("\n  ✗ Required dependencies are missing. See docs/SETUP.md §3 (install order matters).")
        print("    Tell Mitchell exactly which, and do not stub past them.\n")
        return 1
    print("\n  ✓ All required dependencies satisfied.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
