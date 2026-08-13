#!/usr/bin/env python3
"""Safety-envelope parity gate (ADR-3; spec: "Parity Test (Positive/Negative)").

THE PROPERTY: if the C++ and Rust representations stop representing EXACTLY
the same canonical contract as ``config/safety-envelope.toml``, this gate
FAILS (exit 1). Two independent mechanisms, so every drift mode is caught:

  1. REGENERATE + DIFF — regenerates both files from the TOML in-memory and
     diffs them byte-for-byte against the COMMITTED files. Catches hand-edits
     of a generated file and stale codegen (TOML changed without
     regeneration). The regeneration uses the same ``emit_cxx``/``emit_rust``
     the generator uses, so any byte drift is detected — comments included.

  2. PARSE + COMPARE — parses the COMMITTED C++ (``constexpr`` regexes) and
     the COMMITTED Rust (``const`` regexes) and compares every value
     field-by-field against the TOML, naming the drifted field. Catches drift
     BETWEEN the two representations and drift FROM the TOML.

Both mechanisms always run; every problem is reported. Float literals are
compared as decimal text parsed to Python float — the same literal the TOML
stores — NOT the f32 cast (spec: ~1 ULP divergence is benign).

Exit 0 = parity holds. Exit 1 = any drift (or an ungradeable invalid TOML).

Usage: python3 tools/check_safety_parity.py [--root REPO_ROOT]
"""

from __future__ import annotations

import argparse
import difflib
import pathlib
import re
import sys
import tomllib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import generate_safety_config as gen  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

_CXX_ARRAY_RE = re.compile(
    r"constexpr (float|uint16_t) (\w+)\[NUM_SERVO_CHANNELS\] = \{(.*?)\};",
    re.DOTALL,
)
_CXX_ENV_ENTRY_RE = re.compile(
    r"\{\s*(-?[\d.]+)f,\s*(-?[\d.]+)f,\s*SERVO_PULSE_MIN_US\[(\d+)\],\s*"
    r"SERVO_PULSE_MAX_US\[(\d+)\],\s*(-?[\d.]+)f,\s*LimitSource::(\w+),\s*"
    r"LimitSource::(\w+),\s*LimitSource::(\w+)\s*\}"
)
_RUST_ENTRY_RE = re.compile(
    r"ChannelEnvelope \{\s*"
    r"position_min_rad: (-?[\d.]+), position_max_rad: (-?[\d.]+),\s*"
    r"pulse_min_us: (\d+), pulse_max_us: (\d+),\s*"
    r"max_velocity_rad_per_s: (-?[\d.]+),\s*"
    r"position_source: LimitSource::(\w+),\s*pulse_source: LimitSource::(\w+),\s*"
    r"velocity_source: LimitSource::(\w+),\s*\}"
)
_RUST_SOURCE_TO_TOML = {
    "Urdf": "URDF",
    "Measured": "Measured",
    "Configured": "Configured",
    "Temporary": "Temporary",
}


def _parse_cxx_arrays(text: str) -> dict[str, list]:
    """{array_name: [values]} for the constexpr JOINT_*/SERVO_PULSE_* arrays.

    Float arrays keep decimal floats; uint16_t arrays keep ints (the literal
    text is compared, not any cast — ADR-3).
    """
    arrays: dict[str, list] = {}
    for ctype, name, body in _CXX_ARRAY_RE.findall(text):
        vals = [v.strip().rstrip("f") for v in body.split(",") if v.strip()]
        arrays[name] = [float(v) if ctype == "float" else int(v) for v in vals]
    return arrays


def _diff_summary(committed: str, regenerated: str, limit: int = 5) -> str:
    diff = difflib.unified_diff(
        committed.splitlines(),
        regenerated.splitlines(),
        fromfile="committed",
        tofile="regenerated",
        lineterm="",
        n=1,
    )
    return "\n".join(
        [ln for ln in diff if not ln.startswith(("---", "+++", "@@"))][:limit]
    ) or "(empty diff — whitespace/encoding drift)"


def compare_cxx(text: str, channels: list[dict]) -> list[str]:
    """Field-by-field: committed servo_safety.h vs TOML."""
    failures: list[str] = []
    arrays = _parse_cxx_arrays(text)
    expected_arrays = {
        "JOINT_MIN_RAD": ("calibration", "joint_min_rad"),
        "JOINT_MAX_RAD": ("calibration", "joint_max_rad"),
        "SERVO_PULSE_MIN_US": ("pulse", "min_us"),
        "SERVO_PULSE_MAX_US": ("pulse", "max_us"),
    }
    for i, ch in enumerate(channels):
        for arr_name, (section, field) in expected_arrays.items():
            vals = arrays.get(arr_name, [])
            if i >= len(vals):
                failures.append(f"servo_safety.h: {arr_name} missing entry {i}")
                continue
            if vals[i] != ch[section][field]:
                failures.append(
                    f"servo_safety.h channel[{i}] {section}.{field} = {vals[i]!r} "
                    f"but TOML = {ch[section][field]!r}"
                )

    entries = _CXX_ENV_ENTRY_RE.findall(text)
    for i, ch in enumerate(channels):
        if i >= len(entries):
            failures.append(f"servo_safety.h: SAFETY_ENVELOPE missing entry {i}")
            continue
        pmin, pmax, pmin_ref, pmax_ref, vel, psrc, ppulse, vsrc = entries[i]
        env, pulse = ch["envelope"], ch["pulse"]
        for got, want, field in (
            (float(pmin), env["position_min_rad"], "envelope.position_min_rad"),
            (float(pmax), env["position_max_rad"], "envelope.position_max_rad"),
            (float(vel), env["max_velocity_rad_per_s"], "envelope.max_velocity_rad_per_s"),
            (int(pmin_ref), i, "envelope pulse ref index (SERVO_PULSE_MIN_US)"),
            (int(pmax_ref), i, "envelope pulse ref index (SERVO_PULSE_MAX_US)"),
            (psrc, env["position_source"], "envelope.position_source"),
            (ppulse, pulse["source"], "envelope.pulse_source"),
            (vsrc, env["velocity_source"], "envelope.velocity_source"),
        ):
            if got != want:
                failures.append(
                    f"servo_safety.h channel[{i}] {field} = {got!r} but TOML = {want!r}"
                )
    return failures


def compare_rust(text: str, channels: list[dict]) -> list[str]:
    """Field-by-field: committed safety_envelope_generated.rs vs TOML."""
    failures: list[str] = []
    entries = _RUST_ENTRY_RE.findall(text)
    for i, ch in enumerate(channels):
        if i >= len(entries):
            failures.append(f"safety_envelope_generated.rs: missing entry {i}")
            continue
        pmin, pmax, pmin_us, pmax_us, vel, psrc, ppulse, vsrc = entries[i]
        env, pulse = ch["envelope"], ch["pulse"]
        for got, want, field in (
            (float(pmin), env["position_min_rad"], "envelope.position_min_rad"),
            (float(pmax), env["position_max_rad"], "envelope.position_max_rad"),
            (int(pmin_us), pulse["min_us"], "pulse.min_us"),
            (int(pmax_us), pulse["max_us"], "pulse.max_us"),
            (float(vel), env["max_velocity_rad_per_s"], "envelope.max_velocity_rad_per_s"),
            (_RUST_SOURCE_TO_TOML.get(psrc, f"??{psrc}"), env["position_source"], "envelope.position_source"),
            (_RUST_SOURCE_TO_TOML.get(ppulse, f"??{ppulse}"), pulse["source"], "pulse.source"),
            (_RUST_SOURCE_TO_TOML.get(vsrc, f"??{vsrc}"), env["velocity_source"], "envelope.velocity_source"),
        ):
            if got != want:
                failures.append(
                    f"safety_envelope_generated.rs channel[{i}] {field} = {got!r} "
                    f"but TOML = {want!r}"
                )
    return failures


def check_parity(
    toml_path: pathlib.Path, cxx_path: pathlib.Path, rust_path: pathlib.Path
) -> list[str]:
    """All parity failures ([] = the canonical contract is represented exactly)."""
    try:
        with toml_path.open("rb") as f:
            data = tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        return [f"cannot read canonical TOML {toml_path}: {exc}"]

    errors = gen.validate_toml(data)
    if errors:
        return ["TOML invalid — parity cannot be graded:"] + [f"  {e}" for e in errors]

    meta = data["metadata"]
    channels = sorted(data["channel"], key=lambda ch: ch["index"])
    regenerated = {
        "servo_safety.h": gen.emit_cxx(meta, channels),
        "safety_envelope_generated.rs": gen.emit_rust(meta, channels),
    }

    failures: list[str] = []
    reads: dict[str, str] = {}
    for name, path in (
        ("servo_safety.h", cxx_path),
        ("safety_envelope_generated.rs", rust_path),
    ):
        try:
            reads[name] = path.read_text(encoding="utf-8")
        except OSError as exc:
            failures.append(f"{name}: cannot read committed artifact {path}: {exc}")
            continue
        if reads[name] != regenerated[name]:
            failures.append(
                f"{name} differs from the TOML-derived regeneration "
                f"(hand-edit or stale codegen? run python3 tools/generate_safety_config.py):\n"
                f"{_diff_summary(reads[name], regenerated[name])}"
            )

    if "servo_safety.h" in reads:
        failures.extend(compare_cxx(reads["servo_safety.h"], channels))
    if "safety_envelope_generated.rs" in reads:
        failures.extend(compare_rust(reads["safety_envelope_generated.rs"], channels))
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=str(REPO_ROOT),
        help="repo root to grade (default: this repo; the negative-parity test "
        "uses a temp skeleton root)",
    )
    args = parser.parse_args(argv)

    root = pathlib.Path(args.root)
    toml = root / "config" / "safety-envelope.toml"
    cxx = root / "firmware" / "esp32" / "src" / "servo_safety.h"
    rust = (
        root
        / "backend"
        / "crates"
        / "thalos-runtime"
        / "src"
        / "execution_boundary"
        / "safety_envelope_generated.rs"
    )

    failures = check_parity(toml, cxx, rust)
    if failures:
        print("SAFETY-ENVELOPE PARITY FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        print(
            "C++ and Rust do NOT represent the same canonical contract. "
            "Fix the drift, then regenerate: python3 tools/generate_safety_config.py",
            file=sys.stderr,
        )
        return 1
    print(
        "PARITY OK — servo_safety.h and safety_envelope_generated.rs match "
        "config/safety-envelope.toml"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
