"""Phase-0 smoke tests — confirm the scaffold imports and basic plumbing works.
Phase 1 adds the real synthetic-signal tests (beats @ 0.5 s, silence ~ 0, etc.)."""
from __future__ import annotations


def test_doctor_module_imports():
    from analyzer import doctor
    assert hasattr(doctor, "main")
    assert hasattr(doctor, "build_report")


def test_api_has_health_route():
    from analyzer.api import app
    paths = {r.path for r in app.routes}  # type: ignore[attr-defined]
    assert "/health" in paths


def test_fixture_generator_writes_wav(tmp_path):
    from analyzer import make_fixtures as mf
    out = tmp_path / "tone.wav"
    mf.make_tone(out, dur=0.2)
    assert out.exists() and out.stat().st_size > 0
