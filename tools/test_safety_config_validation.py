#!/usr/bin/env python3
"""T8 — TOML validation rejection tests (spec: TOML Validation Before Generation).

Run with:  python3 tools/test_safety_config_validation.py   (exit 0 = all pass)
Also pytest-compatible:  pytest tools/test_safety_config_validation.py

Every test starts from the REAL committed ``config/safety-envelope.toml``
(valid baseline) and mutates ONE aspect, asserting ``validate_toml()`` reports
the corresponding rule. A positive control asserts the untouched TOML passes
all 11 rules, so the rejection assertions are not vacuous.

Rules under test (see ``generate_safety_config.validate_toml``):
    R1  metadata.schema_version present
    R2  metadata.schema_version supported (== 1)
    R3  metadata.dof_count == len(channel)
    R4  envelope position_min_rad < position_max_rad (per channel)
    R5  pulse min_us < max_us (per channel)
    R6  envelope.max_velocity_rad_per_s >= 0 (per channel)
    R7/R8/R9  provenance enums valid (URDF|Measured|Configured|Temporary)
    R10 envelope position range ⊆ calibration joint range (per channel)
    R11 hardware: servo channel indices within 0..15, num_servo_channels
        matches, channel indices contiguous 0-based
"""

from __future__ import annotations

import pathlib
import sys
import tomllib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))

import generate_safety_config as gen  # noqa: E402

TOML_PATH = REPO_ROOT / "config" / "safety-envelope.toml"


def load_valid() -> dict:
    with TOML_PATH.open("rb") as f:
        return tomllib.load(f)


def _set(obj: dict, key: str, value) -> None:
    obj[key] = value


def errors_after(mutate) -> list[str]:
    """validate_toml() on a deep-copied valid TOML after ``mutate`` runs."""
    import copy

    data = copy.deepcopy(load_valid())
    mutate(data)
    return gen.validate_toml(data)


# --- positive control ---------------------------------------------------

def test_valid_toml_passes_all_11_rules():
    assert gen.validate_toml(load_valid()) == []


def test_accepts_zero_velocity():
    # R6 is velocity >= 0 (task-specified): a locked joint with 0 velocity is
    # legal — only NEGATIVE velocity is rejected.
    errors = errors_after(
        lambda d: _set(d["channel"][0]["envelope"], "max_velocity_rad_per_s", 0.0)
    )
    assert all("R6" not in e for e in errors), errors


# --- R1/R2: schema_version ----------------------------------------------

def test_rejects_missing_schema_version():
    errors = errors_after(lambda d: d["metadata"].pop("schema_version"))
    assert any("R1" in e for e in errors), errors


def test_rejects_unsupported_schema_version():
    errors = errors_after(lambda d: _set(d["metadata"], "schema_version", 2))
    assert any("R2" in e for e in errors), errors


# --- R3: dof_count ------------------------------------------------------

def test_rejects_dof_count_mismatch():
    errors = errors_after(lambda d: _set(d["metadata"], "dof_count", 5))
    assert any("R3" in e and "dof_count" in e for e in errors), errors


# --- R4/R5: range ordering ----------------------------------------------

def test_rejects_inverted_position_range():
    def mutate(d):
        env = d["channel"][0]["envelope"]
        _set(env, "position_min_rad", 2.0)
        _set(env, "position_max_rad", 1.0)

    errors = errors_after(mutate)
    assert any("R4" in e and "base" in e for e in errors), errors


def test_rejects_inverted_pulse_range():
    def mutate(d):
        pulse = d["channel"][1]["pulse"]
        _set(pulse, "min_us", 3000)
        _set(pulse, "max_us", 1000)

    errors = errors_after(mutate)
    assert any("R5" in e and "elbow" in e for e in errors), errors


# --- R6: velocity -------------------------------------------------------

def test_rejects_negative_velocity():
    errors = errors_after(
        lambda d: _set(d["channel"][2]["envelope"], "max_velocity_rad_per_s", -1.0)
    )
    assert any("R6" in e and "wrist" in e for e in errors), errors


# --- R7/R8/R9: provenance enums ----------------------------------------

def test_rejects_invalid_position_source():
    errors = errors_after(
        lambda d: _set(d["channel"][0]["envelope"], "position_source", "InvalidEnum")
    )
    assert any("R7" in e and "InvalidEnum" in e for e in errors), errors


def test_rejects_invalid_pulse_source():
    errors = errors_after(
        lambda d: _set(d["channel"][0]["pulse"], "source", "InvalidEnum")
    )
    assert any("R8" in e and "InvalidEnum" in e for e in errors), errors


def test_rejects_invalid_velocity_source():
    errors = errors_after(
        lambda d: _set(d["channel"][0]["envelope"], "velocity_source", "Fabricated")
    )
    assert any("R9" in e and "Fabricated" in e for e in errors), errors


# --- R10: envelope ⊆ calibration ----------------------------------------

def test_rejects_envelope_wider_than_calibration():
    # base calibration max is 1.5708 — an envelope reaching 2.0 exceeds it.
    errors = errors_after(
        lambda d: _set(d["channel"][0]["envelope"], "position_max_rad", 2.0)
    )
    assert any("R10" in e and "base" in e for e in errors), errors


def test_rejects_envelope_below_calibration_min():
    errors = errors_after(
        lambda d: _set(d["channel"][0]["envelope"], "position_min_rad", -2.0)
    )
    assert any("R10" in e and "base" in e for e in errors), errors


# --- R11: hardware channels / contiguous indices ------------------------

def test_rejects_servo_channel_out_of_range():
    errors = errors_after(
        lambda d: _set(d["hardware"], "servo_channels", [15, 14, 13, 16])
    )
    assert any("R11" in e and "0..15" in e for e in errors), errors


def test_rejects_num_servo_channels_mismatch():
    errors = errors_after(lambda d: _set(d["hardware"], "num_servo_channels", 3))
    assert any("R11" in e and "num_servo_channels" in e for e in errors), errors


def test_rejects_non_contiguous_channel_indices():
    errors = errors_after(lambda d: _set(d["channel"][2], "index", 5))
    assert any("R11" in e and "contiguous" in e for e in errors), errors


# --- runner (plain python3; pytest ignores main()) ----------------------

def main() -> int:
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
    print(f"\n{len(tests) - failed}/{len(tests)} TOML-validation tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
