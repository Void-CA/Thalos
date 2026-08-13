# Calibration — the reproducible 7-step flow

How to measure real servo pulse ranges (`calibrate.py`) and safe mechanical
joint limits (`limit_finder.py`) on hardware and land them in the codebase
**without ever hand-editing a generated file**.

## Authority model

`config/safety-envelope.toml` is the **single canonical source** for the
safety envelope (spec `safety-envelope-canonical-source`). Every safety
value — position, pulse, velocity, provenance — lives there and nowhere
else:

```
config/safety-envelope.toml          ←  CANONICAL (hand-edited ONLY by
   │                                    calibration tools or careful review)
   │ python3 tools/generate_safety_config.py
   ├──► firmware/esp32/src/servo_safety.h          (C++, generated — DO NOT EDIT)
   └──► backend/.../safety_envelope_generated.rs   (Rust, generated — DO NOT EDIT)
```

The C++ and Rust artifacts are **derived** — regenerated from the TOML, never
touched by hand. `firmware/esp32/src/servo_hw_config.h` (I2C/PCA9685 wiring)
is the only hand-authored hardware file and is deliberately *not* generated.

The calibration tools therefore **write back to the TOML** — they no longer
print "edit the header" instructions. That is the whole point of the write-back
design (ADR-4): the measurement lands in the canonical source, and codegen
propagates it to both languages.

## The 7-step flow

1. **Run the calibration tool**

   - Pulse range of a decoupled servo:
     `python3 firmware/esp32/tools/calibrate.py --joint <n>`
   - Safe limits of a mounted joint:
     `python3 firmware/esp32/tools/limit_finder.py --joint <n> --step 0.02`

2. **The tool obtains the candidate value** — the measured pulse
   (`calibrate.py`) or joint limit (`limit_finder.py`), from the sweep on
   hardware.

3. **The tool shows the previous and the new value** — e.g.
   `channel[2].pulse.max_us: 2600 -> 2700`, so you see the delta before
   anything changes.

4. **The tool writes ONLY the corresponding TOML field** — one targeted
   line-edit via `tools/safety_config.py` (`update_channel_field`). It never
   rewrites the file, never touches comments, never writes unrelated fields,
   and never touches the envelope. If the write would leave the envelope
   outside the calibration range, the tool prints a warning (spec R10).

5. **You review `git diff config/safety-envelope.toml`** — the diff must be
   exactly the measured fields. This is the human gate.

6. **You run codegen**: `python3 tools/generate_safety_config.py` — emits
   both derived files from the updated TOML.

7. **Tests verify both sides represent the same contract**:
   `python3 tools/check_safety_parity.py` (exit 0 = C++, Rust and TOML agree)
   plus the test suites:
   `pio test -e native` (firmware, 71) and
   `cargo test -p thalos_runtime` (runtime, 290).

Steps 5–7 are mandatory after every measurement. A measurement that is never
regenerated is invisible to the firmware and the backend.

## CI safety gate

Every push/PR to `main` runs the **safety gate** (`.github/workflows/safety-gate.yml`),
four checks in order:

1. `cargo test --workspace` (backend)
2. `pio test -e native` (firmware)
3. **Stale-artifact check**: `python3 tools/generate_safety_config.py` then
   `git diff --exit-code` — if you changed `config/safety-envelope.toml` without
   regenerating the C++/Rust artifacts, this step FAILS. Regenerate before you push.
4. **Parity gate**: `python3 tools/check_safety_parity.py` — C++ and Rust must
   represent exactly the same contract as the TOML.

The parity test also runs inside `cargo test` (thalos-runtime). If `python3` is
missing from PATH there, the test now **hard-fails** instead of silently
skipping. The only escape is `THALOS_ALLOW_PARITY_SKIP=1`, and it is a
**local-development convenience ONLY — never set it in CI** (the CI workflow
never sets it; a missing python3 in CI is a hard failure by design). You
should not need it: CI runners always have python3, and any normal dev machine
does too.

## Calibration map vs enforcement authority

Two per-channel tables coexist and MUST NOT be conflated:

| Table | Role |
|-------|------|
| `[[channel]].calibration` (`joint_min/max_rad`) + `[[channel]].pulse` (`min/max_us`) | **Calibration map only** — the rad→pulse linear-interpolation endpoints. Describes HOW a commanded radian maps to a pulse width. |
| `[[channel]].envelope` (`position_min/max_rad`, `max_velocity_rad_per_s`, sources) | **Enforcement authority** — what may PHYSICALLY execute. Enforced per-sample at parse, whole-manifest at validation, and defensively by the ServoDriver. |

`calibrate.py` writes **pulse** fields; `limit_finder.py` writes
**calibration** fields. Neither writes the envelope — recalibrating the map
never changes enforcement, and vice versa. A value inside the calibration map
but outside the envelope is **rejected, never clamped**.

## LimitSource semantics

Every limit carries its provenance (`URDF | Measured | Configured |
Temporary`). Calibration tools write the measured numbers but the *source*
stays honest:

- **URDF** — declared by the mechanism's URDF model (mechanism-safe travel).
- **Measured** — found by physical measurement/calibration (what
  `calibrate.py`/`limit_finder.py` produce).
- **Configured** — operator/tuning configuration (pulse ranges, because URDF
  cannot express pulse widths).
- **Temporary** — provisional, NOT physically validated yet.

After a real measurement, the tool updates the numeric value; changing the
provenance field to `Measured` is a separate, deliberate edit (reviewed in
step 5) that says "this is now physically validated".

## Wrist (2) — Temporary note

The wrist channel is deliberately **Temporary**: ±3.1416 rad / 2.0 rad/s spans
full servo travel and is NOT tightened to an invented "safer" number until
real calibration replaces it (do not invent a number without measurement).
Its pulse range is `300–2600 µs` with `source = "Temporary"`. This is the
channel the write-back flow is most likely to touch first — after measuring,
widen or narrow its calibration/pulse fields and consider promoting the
sources to `Measured`.

## Tooling details

- The write-back helper is `tools/safety_config.py` (shared by both tools):
  `load()` reads the TOML, `update_channel_field()` does the targeted
  line-edit (preserves comments, no full rewrite, no tomli_w), and
  `show_old_new()` prints the step-3 delta. It fails loudly on an invalid
  TOML and never corrupts the file.
- The write functions `calibrate.write_pulse_range()` and
  `limit_finder.write_joint_limits()` are pure (candidate values injected) —
  unit-testable without hardware; see
  `firmware/esp32/tools/test_safety_writeback.py`.
- The write-back tests use a **temp copy** of the TOML — the committed file
  is never mutated by tests.
