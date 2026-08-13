#!/usr/bin/env python3
"""T9 — codegen determinism (spec: determinism_two_runs_byte_identical).

Run with:  python3 tools/test_safety_determinism.py   (exit 0 = pass)

Runs the generator twice into separate temp output dirs (via ``--out-dir``,
which writes both artifacts flat into the given dir — the committed files are
never touched) and asserts the two trees are byte-identical under ``diff -r``
semantics (filecmp.dircmp plus a raw byte comparison of every file).
"""

from __future__ import annotations

import filecmp
import pathlib
import sys
import tempfile

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))

import generate_safety_config as gen  # noqa: E402

EXPECTED_FILES = ["safety_envelope_generated.rs", "servo_safety.h"]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="thalos-determinism-") as td:
        run1 = pathlib.Path(td) / "run1"
        run2 = pathlib.Path(td) / "run2"

        rc1 = gen.main(["--out-dir", str(run1)])
        assert rc1 == 0, f"first generator run exited {rc1}"
        rc2 = gen.main(["--out-dir", str(run2)])
        assert rc2 == 0, f"second generator run exited {rc2}"

        files1 = sorted(p.name for p in run1.iterdir())
        files2 = sorted(p.name for p in run2.iterdir())
        assert files1 == files2 == EXPECTED_FILES, (files1, files2)

        cmp = filecmp.dircmp(run1, run2)
        assert not (cmp.left_only or cmp.right_only or cmp.diff_files or cmp.funny_files), (
            f"diff -r mismatch: left_only={cmp.left_only} right_only={cmp.right_only} "
            f"diff_files={cmp.diff_files}"
        )
        for name in EXPECTED_FILES:
            assert (run1 / name).read_bytes() == (run2 / name).read_bytes(), name

    print("PASS determinism: two generator runs byte-identical (diff -r clean)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"FAIL determinism: {exc}")
        sys.exit(1)
