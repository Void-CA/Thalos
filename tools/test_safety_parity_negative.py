#!/usr/bin/env python3
"""T10 — negative parity: a corrupted generated artifact MUST fail the gate
(spec: parity_detects_corruption).

Run with:  python3 tools/test_safety_parity_negative.py   (exit 0 = pass)

The COMMITTED artifacts are never modified. Each scenario builds a temp repo
skeleton (real TOML + real generated files copied in), corrupts ONE value in
the COPY, and runs ``tools/check_safety_parity.py --root <skeleton>`` as a
subprocess, asserting exit 1 AND an error naming the drifted
representation/field. The skeleton is deleted afterwards, and a byte-compare
of the committed files before/after proves they were untouched.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
PARITY = REPO_ROOT / "tools" / "check_safety_parity.py"

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


def build_skeleton(root: pathlib.Path) -> None:
    """Mirror the repo layout the parity script resolves under ``--root``."""
    cxx_dst = root / "firmware" / "esp32" / "src" / "servo_safety.h"
    rust_dst = (
        root
        / "backend"
        / "crates"
        / "thalos-runtime"
        / "src"
        / "execution_boundary"
        / "safety_envelope_generated.rs"
    )
    cxx_dst.parent.mkdir(parents=True, exist_ok=True)
    rust_dst.parent.mkdir(parents=True, exist_ok=True)
    (root / "config").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(TOML, root / "config" / "safety-envelope.toml")
    shutil.copyfile(CXX, cxx_dst)
    shutil.copyfile(RUST, rust_dst)


def run_parity(root: pathlib.Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(PARITY), "--root", str(root)],
        capture_output=True,
        text=True,
    )


def test_clean_skeleton_passes():
    with tempfile.TemporaryDirectory(prefix="thalos-parity-") as td:
        root = pathlib.Path(td)
        build_skeleton(root)
        proc = run_parity(root)
        assert proc.returncode == 0, (
            f"clean skeleton must pass parity:\n{proc.stdout}\n{proc.stderr}"
        )


def test_corrupt_cxx_fails_naming_field():
    with tempfile.TemporaryDirectory(prefix="thalos-parity-") as td:
        root = pathlib.Path(td)
        build_skeleton(root)
        cxx = root / "firmware" / "esp32" / "src" / "servo_safety.h"
        text = cxx.read_text()
        corrupted = text.replace(
            "{ -1.5708f, 1.5708f, SERVO_PULSE_MIN_US[0]",
            "{ -1.5000f, 1.5708f, SERVO_PULSE_MIN_US[0]",
        )
        assert corrupted != text, "corruption target not found in servo_safety.h"
        cxx.write_text(corrupted)
        proc = run_parity(root)
        assert proc.returncode == 1, (
            f"corrupted C++ must fail parity:\n{proc.stdout}\n{proc.stderr}"
        )
        assert "servo_safety.h" in proc.stderr and "channel[0]" in proc.stderr, proc.stderr


def test_corrupt_rust_fails_naming_field():
    with tempfile.TemporaryDirectory(prefix="thalos-parity-") as td:
        root = pathlib.Path(td)
        build_skeleton(root)
        rust = (
            root
            / "backend"
            / "crates"
            / "thalos-runtime"
            / "src"
            / "execution_boundary"
            / "safety_envelope_generated.rs"
        )
        text = rust.read_text()
        corrupted = text.replace(
            "pulse_min_us: 350, pulse_max_us: 1650,",
            "pulse_min_us: 999, pulse_max_us: 1650,",
            1,
        )
        assert corrupted != text, "corruption target not found in safety_envelope_generated.rs"
        rust.write_text(corrupted)
        proc = run_parity(root)
        assert proc.returncode == 1, (
            f"corrupted Rust must fail parity:\n{proc.stdout}\n{proc.stderr}"
        )
        assert "safety_envelope_generated.rs" in proc.stderr and "pulse_min_us" in proc.stderr, (
            proc.stderr
        )


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
    assert before == after, "committed artifacts were modified by the negative test!"
    print(
        f"\n{len(tests) - failed}/{len(tests)} negative-parity tests passed "
        "(committed files byte-identical before/after)"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
