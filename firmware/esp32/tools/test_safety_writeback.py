#!/usr/bin/env python3
"""T15 — calibration write-back tests (design ADR-4; M3 gate: write-back tests).

Run with:  python3 firmware/esp32/tools/test_safety_writeback.py   (exit 0 = pass)
Also pytest-compatible:  pytest firmware/esp32/tools/test_safety_writeback.py

Proves the M3 write-back contract on a TEMP COPY of the canonical TOML —
the committed ``config/safety-envelope.toml`` and both committed generated
artifacts are never modified (byte-compare before/after in main()):

  1. ``safety_config.update_channel_field`` changes EXACTLY ONE line (the
     target field) and preserves every comment / byte of formatting around
     it — no tomli_w, no full rewrite (ADR-4).
  2. The helper reads via ``load()``, writes pulse and calibration fields,
     prints old/new (7-step flow step 3), and fails LOUDLY on invalid TOML
     without corrupting the file.
  3. ``calibrate.py`` / ``limit_finder.py`` write back through the SAME
     helper via pure write functions that INJECT the measured candidate
     values (no serial / no hardware — CI-safe).
  4. After a write, regenerating the derived artifacts and running the
     parity gate still yields exit 0: both representations keep matching the
     edited TOML (7-step flow steps 6-7).
"""

from __future__ import annotations

import contextlib
import difflib
import io
import pathlib
import shutil
import sys
import tempfile
import tomllib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tools"))
sys.path.insert(0, str(REPO_ROOT / "firmware" / "esp32" / "tools"))

import safety_config  # noqa: E402
import generate_safety_config as gen  # noqa: E402
import check_safety_parity  # noqa: E402
import calibrate  # noqa: E402
import limit_finder  # noqa: E402

TOML = REPO_ROOT / "config" / "safety-envelope.toml"
CXX = REPO_ROOT / "firmware" / "esp32" / "src" / "servo_safety.h"
RUST = (
    REPO_ROOT
    / "backend"
    / "crates"
    / "thalos-runtime"
    / "src"
    / "execution_boundary"
    / "safety_envelope_generated.rs"
)


def _temp_copy() -> pathlib.Path:
    """Copy of the canonical TOML in a fresh temp dir (committed file untouched)."""
    td = tempfile.mkdtemp(prefix="thalos-writeback-")
    t = pathlib.Path(td) / "safety-envelope.toml"
    shutil.copyfile(TOML, t)
    return t


def _changed_lines(before: str, after: str) -> list[str]:
    """The +/- lines of a unified diff (context lines excluded)."""
    return [
        ln
        for ln in difflib.unified_diff(
            before.splitlines(), after.splitlines(), lineterm=""
        )
        if ln.startswith(("+", "-")) and not ln.startswith(("+++", "---"))
    ]


# --- T12: load() ---------------------------------------------------------

def test_load_reads_canonical_toml():
    data = safety_config.load()
    assert data["metadata"]["dof_count"] == 4
    assert [c["index"] for c in data["channel"]] == [0, 1, 2, 3]
    assert data["channel"][2]["pulse"]["max_us"] == 2600


# --- T12: targeted line-edit write ---------------------------------------

def test_update_channel_field_changes_only_target_line():
    t = _temp_copy()
    try:
        before = t.read_text()
        old = safety_config.update_channel_field(
            2, "pulse", "max_us", 2700, toml_path=t, show=False
        )
        after = t.read_text()
        assert old == 2600
        assert _changed_lines(before, after) == ["-max_us = 2600", "+max_us = 2700"]
        data = safety_config.load(t)
        ch = data["channel"][2]
        assert ch["pulse"]["max_us"] == 2700      # target field written
        assert ch["pulse"]["min_us"] == 300       # sibling in same section untouched
        assert ch["pulse"]["source"] == "Temporary"  # comment/format preserved
        assert ch["envelope"]["position_min_rad"] == -3.1416  # other section untouched
        assert data["channel"][1]["pulse"]["max_us"] == 2050   # other channel untouched
    finally:
        shutil.rmtree(t.parent, ignore_errors=True)


def test_update_channel_field_writes_calibration_section():
    t = _temp_copy()
    try:
        old = safety_config.update_channel_field(
            0, "calibration", "joint_max_rad", 1.6, toml_path=t, show=False
        )
        assert old == 1.5708
        data = safety_config.load(t)
        cal = data["channel"][0]["calibration"]
        assert cal["joint_max_rad"] == 1.6
        assert cal["joint_min_rad"] == -1.5708   # untouched
        assert data["channel"][0]["envelope"]["position_max_rad"] == 1.5708
    finally:
        shutil.rmtree(t.parent, ignore_errors=True)


def test_update_channel_field_preserves_comment_lines():
    t = _temp_copy()
    try:
        # the TOML is full of comment lines (header, per-channel notes); a
        # byte-exact single-line diff proves they survive untouched
        before = t.read_text()
        safety_config.update_channel_field(3, "pulse", "min_us", 510, toml_path=t, show=False)
        after = t.read_text()
        assert _changed_lines(before, after) == ["-min_us = 500", "+min_us = 510"]
        assert before.count("\n#") == after.count("\n#")  # no comment line lost/added
    finally:
        shutil.rmtree(t.parent, ignore_errors=True)


def test_show_old_new_prints_previous_and_new():
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        safety_config.show_old_new(2, "pulse", "max_us", 2600, 2700)
    out = captured.getvalue()
    assert "channel[2].pulse.max_us" in out
    assert "2600" in out and "2700" in out


def test_load_fails_loudly_on_invalid_toml():
    td = tempfile.mkdtemp(prefix="thalos-writeback-")
    try:
        t = pathlib.Path(td) / "broken.toml"
        t.write_text("max_us = [unclosed\n", encoding="utf-8")
        before = t.read_bytes()
        try:
            safety_config.load(t)
        except tomllib.TOMLDecodeError:
            pass
        else:
            raise AssertionError("load() must fail loudly on invalid TOML")
        try:
            safety_config.update_channel_field(0, "pulse", "min_us", 400, toml_path=t)
        except tomllib.TOMLDecodeError:
            pass
        else:
            raise AssertionError("update_channel_field must fail loudly on invalid TOML")
        assert t.read_bytes() == before  # a failed write never corrupts the file
    finally:
        shutil.rmtree(td, ignore_errors=True)


# --- T12: envelope ⊆ calibration invariant warning -------------------------

def test_write_warns_when_envelope_exceeds_calibration():
    t = _temp_copy()
    try:
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured):
            safety_config.update_channel_field(
                0, "calibration", "joint_max_rad", 1.0, toml_path=t
            )
        # base envelope max 1.5708 now exceeds calibration max 1.0 -> warn
        assert "channel[0]" in captured.getvalue()
        assert "calibration" in captured.getvalue()
    finally:
        shutil.rmtree(t.parent, ignore_errors=True)


# --- T13: calibrate.py write-back (pure, no hardware) ----------------------

def test_calibrate_write_pulse_range_updates_toml():
    t = _temp_copy()
    try:
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            calibrate.write_pulse_range(1, 400, 2100, toml_path=t)
        data = safety_config.load(t)
        pulse = data["channel"][1]["pulse"]
        assert pulse["min_us"] == 400
        assert pulse["max_us"] == 2100
        assert pulse["source"] == "Configured"  # untouched
        out = captured.getvalue()
        assert "generate_safety_config" in out
        assert "check_safety_parity" in out
    finally:
        shutil.rmtree(t.parent, ignore_errors=True)


def test_limit_finder_write_joint_limits_updates_toml():
    t = _temp_copy()
    try:
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            limit_finder.write_joint_limits(3, 0.01, 0.08, toml_path=t)
        data = safety_config.load(t)
        cal = data["channel"][3]["calibration"]
        assert cal["joint_min_rad"] == 0.01
        assert cal["joint_max_rad"] == 0.08
        out = captured.getvalue()
        assert "generate_safety_config" in out
        assert "check_safety_parity" in out
    finally:
        shutil.rmtree(t.parent, ignore_errors=True)


def test_calibrate_pulse_to_rad_uses_toml_mapping():
    # approval: pulse_to_rad now maps via the canonical TOML (was servo_config.h)
    assert calibrate.pulse_to_rad(0, 350) == -1.5708   # min pulse -> min joint
    assert calibrate.pulse_to_rad(0, 1650) == 1.5708   # max pulse -> max joint
    assert abs(calibrate.pulse_to_rad(0, 1000) - 0.0) < 1e-9  # mid pulse -> mid joint


# --- T15: regen + parity stay green after a write --------------------------

def test_regen_and_parity_pass_with_new_value():
    td = tempfile.mkdtemp(prefix="thalos-writeback-")
    try:
        root = pathlib.Path(td)
        t = root / "config" / "safety-envelope.toml"
        t.parent.mkdir(parents=True)
        shutil.copyfile(TOML, t)
        cxx = root / "firmware" / "esp32" / "src" / "servo_safety.h"
        cxx.parent.mkdir(parents=True)
        shutil.copyfile(CXX, cxx)
        rust = (
            root / "backend" / "crates" / "thalos-runtime"
            / "src" / "execution_boundary" / "safety_envelope_generated.rs"
        )
        rust.parent.mkdir(parents=True)
        shutil.copyfile(RUST, rust)

        # simulate a calibration write (e.g. wrist pulse max found by calibrate.py)
        safety_config.update_channel_field(2, "pulse", "max_us", 2700, toml_path=t, show=False)

        # steps 6-7 of the flow: regenerate both artifacts, then parity
        with t.open("rb") as f:
            data = tomllib.load(f)
        meta = data["metadata"]
        channels = sorted(data["channel"], key=lambda c: c["index"])
        cxx.write_text(gen.emit_cxx(meta, channels), encoding="utf-8")
        rust.write_text(gen.emit_rust(meta, channels), encoding="utf-8")

        # the new value flowed through codegen into BOTH representations
        assert "2700" in cxx.read_text(encoding="utf-8")
        assert "2700" in rust.read_text(encoding="utf-8")

        failures = check_safety_parity.check_parity(t, cxx, rust)
        assert failures == [], failures
    finally:
        shutil.rmtree(td, ignore_errors=True)


# --- runner (plain python3; pytest ignores main()) -------------------------

def main() -> int:
    before = {p: p.read_bytes() for p in (TOML, CXX, RUST)}
    tests = [
        (name, fn)
        for name, fn in sorted(globals().items())
        if name.startswith("test_") and callable(fn)
    ]
    failed = 0
    for name, fn in tests:
        try:
            fn()
        except BaseException as exc:  # runner reports, does not crash
            failed += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
        else:
            print(f"PASS {name}")
    after = {p: p.read_bytes() for p in (TOML, CXX, RUST)}
    assert before == after, "committed artifacts were modified by the write-back test!"
    print(
        f"\n{len(tests) - failed}/{len(tests)} write-back tests passed "
        "(committed files byte-identical before/after)"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
