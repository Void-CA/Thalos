# ESP32 Execution Protocol

> Text-based host↔firmware protocol for uploading, executing, and
> collecting robot trajectories on ESP32 hardware.

## Overview

The protocol uses a **text-line format** over a byte-stream transport
(serial or TCP). Every command or response is a single line terminated
by `\n`. The host drives all exchanges; the firmware responds to each
command before the host sends the next one.

## Protocol Version

The current protocol version is **1**. The handshake (`HELLO`) verifies
that host and firmware agree on the version before any other commands
are processed.

## Command / Response Reference

### HELLO — Version handshake

```
HOST → ESP: HELLO <version>
ESP → HOST: HELLO <version> OK
```

Establishes the protocol version. The host sends its expected version;
the firmware echoes it back with `OK`. A version mismatch causes the
host to abort with a `VersionMismatch` error.

**Example:**
```
HELLO 1
HELLO 1 OK
```

### MANIFEST — Begin manifest upload

```
HOST → ESP: MANIFEST <dof_count> <total_samples> <duration_us>
ESP → HOST: OK
```

Opens a manifest upload session. Parameters:

| Field | Type | Description |
|-------|------|-------------|
| `dof_count` | u32 | Number of joints (degrees of freedom) |
| `total_samples` | u32 | Total number of waypoints across all segments |
| `duration_us` | u64 | Total execution time in microseconds |

**Example:**
```
MANIFEST 6 250 5000000
OK
```

### SEGMENT — Define a segment

```
HOST → ESP: SEGMENT <index> <instruction> <sample_start> <sample_count>
ESP → HOST: OK
```

Defines a segment within the manifest. Segments map back to the
compiled plan's motion segments (`CompiledPlan.segments`, IR-3) for
later analysis.

| Field | Type | Description |
|-------|------|-------------|
| `index` | u32 | Segment index (ascending, matches `CompiledPlan`) |
| `instruction` | string | `movej` (joint move) or `movel` (linear move) |
| `sample_start` | u32 | Index of first sample in the flat `samples` array |
| `sample_count` | u32 | Number of samples in this segment |

**Example:**
```
SEGMENT 0 movej 0 50
OK
SEGMENT 1 movel 50 200
OK
```

### SAMPLE — Upload or collect a waypoint

**Upload direction (HOST → ESP):**

```
HOST → ESP: SAMPLE <j0> <j1> ... <jN> <dt_us>
ESP → HOST: OK
         or: ERROR <reason>
```

Uploads a single timed waypoint. The host sends all samples during
the manifest upload phase, between `MANIFEST` and `END_UPLOAD`.

| Field | Type | Description |
|-------|------|-------------|
| `j0..jN` | f64 | Joint positions (N = `dof_count` values) |
| `dt_us` | u32 | Microseconds since previous waypoint (0 for first sample) |

Every sample is checked **at parse time** against the safety contract (see
[Safety Contract](#safety-contract-execution-safety-envelope)):
a syntactically malformed or non-finite value is rejected with
`ERROR MALFORMED_SAMPLE`, and a joint outside the per-channel safety envelope
is rejected with `ERROR INVALID_JOINT`. A rejected sample never enters the
manifest and no actuator write occurs. The protocol state machine latches into
`ERROR` until the host recovers via `STOP`.

**Example:**
```
SAMPLE 0.0 0.0 0.0 0.0 0.0 0.0 0
OK
SAMPLE 0.1 0.05 -0.02 0.3 0.0 0.0 20000
OK
SAMPLE 4.0 0.3 0.1 0.0 0.0 0.0 20000      (base beyond ±1.5708 rad)
ERROR INVALID_JOINT
```

**Collect direction (ESP → HOST):**

```
ESP → HOST: SAMPLE <ts_us> <j0> <j1> ... <jN>
```

Sent by the firmware during sample collection (after `SAMPLES <count>`).
The first field after `SAMPLE` is the **absolute timestamp** in
microseconds from execution start, followed by joint positions.

> **Semantics of execution samples (important):** execution samples represent
> the state **reported by the execution backend**, not an independent physical
> measurement. For the current ESP32 implementation, joint samples are the
> **commanded waypoint values** recorded by the executor at their target
> timestamps (`executor.cpp` replays the uploaded manifest; there are no
> encoders or position sensors). Thalos therefore cannot claim to know the
> physical joint position of the robot — only the execution state it
> commanded. UI and documentation must phrase this as *reported* / *commanded*
> joint state, never as measured position.

### END_UPLOAD — Finish manifest upload

```
HOST → ESP: END_UPLOAD
ESP → HOST: READY
         or: ERROR <reason>
```

Closes the manifest upload. The firmware validates the manifest and
transitions to the Ready state, or returns an error.

**Error reasons:**

| Error | Meaning |
|-------|---------|
| `DOF_MISMATCH` | Joint count differs from manifest metadata |
| `WAYPOINT_COUNT` | Sample count differs from metadata |
| `TIMING_INVALID` | Timing values malformed (accumulated `dt_us` vs declared duration, 1 % tolerance) |
| `EMPTY_MANIFEST` | No waypoints received |
| `INVALID_JOINT` | A joint lies outside its channel's `SAFETY_ENVELOPE` — reject-not-clamp (see [Safety Contract](#safety-contract-execution-safety-envelope)) |
| `MALFORMED_SAMPLE` | A `SAMPLE` line failed parse hardening — NaN/Inf/overflow/non-numeric/negative-`dt_us` (see [Safety Contract](#safety-contract-execution-safety-envelope)) |

**Example (success):**
```
END_UPLOAD
READY
```

**Example (error):**
```
END_UPLOAD
ERROR DOF_MISMATCH
```

### EXECUTE — Start execution

```
HOST → ESP: EXECUTE
ESP → HOST: OK
         or: ERROR <reason>
```

Starts execution of the uploaded manifest. The firmware transitions
from Ready to Executing. Execution runs autonomously on the ESP32's
internal clock.

### STOP — Stop execution

```
HOST → ESP: STOP
ESP → HOST: OK
```

Stops any current execution and returns the firmware to Idle state.

### STATUS — Query execution status

```
HOST → ESP: STATUS
ESP → HOST: STATUS IDLE
         or: STATUS RECEIVING
         or: STATUS READY
         or: STATUS RUNNING <progress> <j0> <j1> ... <jN>
         or: STATUS COMPLETED <count>
         or: STATUS ERROR <reason>
```

Returns the current state of execution. Used for polling-based
completion detection.

The `RUNNING` payload carries the progress fraction (0.0–1.0) followed
by the commanded joint positions (N = `dof_count` values). The host maps
`RUNNING` internally to its "Executing" state.

The `COMPLETED` payload carries the number of recorded execution samples
(`count`) the host can collect via `SAMPLES <count>`.

### SAMPLES — Collect execution trace

```
HOST → ESP: SAMPLES <count>
ESP → HOST: OK
         → SAMPLE <ts> <j0> <j1> ...
         → SAMPLE <ts> <j0> <j1> ...
         → ... (×count lines)
```

Requests the firmware to upload `count` recorded execution samples.
Each `SAMPLE` line is **timestamp-first**: the absolute timestamp in
microseconds from execution start, followed by the joint positions
(`SAMPLE <ts_us> <j0..jN>` — the same collect-direction format as above).
`count` must be ≥ 1; `SAMPLES 0` is rejected with `ERROR MALFORMED`.

## Physical Actuation (PCA9685 Servo Driver)

The firmware can drive physical servos through a PCA9685 16-channel PWM
driver over I2C (address 0x40, 50 Hz). Joint positions (radians) from
execution waypoints are converted to PWM pulses and written to the servo
channels (see `src/servo_config.h` for pins, channels, pulse ranges and
joint limits).

### Commanded vs. Reported Position

Servo writes are derived from the **commanded waypoint values** of the
manifest. There are no encoders or position sensors: the physical position
of the robot is *reported as commanded*, exactly like execution samples
(see the sample semantics note above). The firmware never claims to know
the measured joint position.

### Write Policy: Catch-up (last stale waypoint only, velocity-bounded)

`Executor::step_to()` records **every** waypoint in the sample log (wire
contract — samples are the values commanded by the plan, for
post-execution analysis). Physical actuation writes **only the last stale
waypoint** per `update()` cycle; intermediate waypoints skipped by a
delayed loop are not written (they were never physically reached). In
normal operation (dt ≈ 10 ms, loop ≈ 1 kHz) waypoints never accumulate.

Every physical write is additionally **velocity-bounded** (ADR-3): the
per-channel advance from the last written position is capped at
`max_velocity_rad_per_s × elapsed_since_last_write`, so a delayed
`update()` can never teleport the arm to a far waypoint — catch-up is
always velocity-bounded, never a full-trajectory jump.

### Hold-Last-Position on STOP / ERROR

STOP and protocol ERROR halt servo writes: the executor stops stepping and
no further `setPWM()` calls are issued. The PCA9685 retains the last
commanded PWM output while powered, so the servos hold their last position
— there is no release, homing, or re-write.

> This is a **hold-by-inaction** policy, not a universal safety guarantee.
> It does not cover power loss, disconnection, overheating, or mechanical
> failure.

### Physical Calibration (measured 2026-08-11/12, joint 0 — base)

Field calibration of the DS3240MG (40 kg digital servo) revealed several
non-obvious facts that drive `servo_config.h`:

1. **The servo's real pulse range is narrower than nominal.** The DS3240MG
   responds to roughly **350–1725 µs**, not the standard 500–2500 µs. Its
   "180°" datasheet rating is not reachable in practice (manufacturing
   variance on low-cost high-torque servos). The firmware must map the joint
   range over the *measured* pulse range or the servo saturates early.

2. **Pulses outside the accepted range cause a "reset sweep".** Commanding a
   pulse beyond ~1725 µs makes the servo lose its reference and sweep its
   full range once (an initialization-like movement). This is how the range
   limit was confirmed by behavior. The firmware must never emit such pulses
   — the safety contract rejects the commanding joint value instead (there
   is no clamp; see the [Safety Contract](#safety-contract-execution-safety-envelope)).

3. **The calibration tool measures the mapping, not the servo, when the
   clamp cuts.** `calibrate.py` converts pulse→radians using the current
   `servo_config.h` mapping, and the firmware clamps back — so if
   `SERVO_PULSE_MIN/MAX_US` is narrower than the servo's real range, the
   tool reports the *mapping* limits, not the servo's. Measure with a wide
   temporary mapping (e.g. 300–2600 µs), then fix the real range with
   margin.

4. **Servo frequency (50 Hz vs 333 Hz) does not change the reachable
   range.** A 333 Hz experiment (prescale 0x11) produced the identical
   useful range. 50 Hz remains the correct production value because the
   MG90S analog servos cannot survive 333 Hz and the PCA9685 has a single
   global frequency for all 16 channels.

5. **An asymmetric mechanical range (e.g. +0.40 rad / -1.5 rad) can be a
   horn mounting offset, not the mechanism.** Re-centering the servo horn
   restored a balanced, full-range motion. Before trusting measured joint
   limits, verify the horn is mounted centered (servo at mid-pulse, arm at
   its visual center).

Final joint 0 configuration: `SERVO_PULSE_MIN/MAX_US = 350/1650`
(margin below the 1725 µs reset threshold), `JOINT_MIN/MAX_RAD = ±1.5708`
(mechanism-safe calibration map, restored in M1 — the enforcement boundary
is the SAFETY_ENVELOPE, which spans the same mechanism-safe travel; see the
[Safety Contract](#safety-contract-execution-safety-envelope)). The same
calibration procedure applies to joints 1–3.

### Probe Degradation (PCA9685 absent)

At boot the firmware probes address 0x40 (`endTransmission() == 0` → ACK,
device present). If the PCA9685 is not found it logs
`PCA9685 NOT found — servos disabled` and every servo write becomes a
no-op. Execution, protocol handling and sample recording continue to work
normally (simulation-only mode).

## Safety Contract (Execution Safety Envelope)

The firmware is the **last barrier** between a wire command and a physical
actuator write. It NEVER silently transforms an invalid command into a valid
one (design ADR-2): every layer that can stop a command — protocol parse,
validator, executor, ServoDriver — rejects it with an identifiable
diagnostic. A rejected command produces **no actuator movement**.

### Error Codes

| Error | Layer | Triggers |
|-------|-------|----------|
| `MALFORMED_SAMPLE` | Protocol parse (`handle_sample`) | NaN joint token; `+Inf` / `-Inf` joint token; numeric overflow (`strtof` sets `ERANGE`, e.g. `1e39` → +Inf); non-numeric joint token (full-token consumption check — `abc` is rejected, never silently parsed as 0.0); negative `dt_us` (parsed as signed and rejected before the uint32 cast — a negative value must never wrap to a huge positive duration) |
| `INVALID_JOINT` | Validator (`check_physical_envelope`) | A joint outside its channel's `SAFETY_ENVELOPE` position range. Enforced **per-sample at `SAMPLE` time** (the waypoint never enters the manifest) and **whole-manifest at `END_UPLOAD`** (defense-in-depth for direct API use). |

### Safety Envelope (per channel)

`src/servo_config.h` declares a `SafetyEnvelope` per actuated channel — the
**execution enforcement authority** (ADR-1):

| Channel | Position (rad) | Pulse (µs) | Max velocity (rad/s) | Pos source | Pulse source | Vel source |
|---------|---------------|------------|----------------------|------------|--------------|------------|
| base (0) | [-1.5708, +1.5708] | [350, 1650] | 1.0 | URDF | Configured | URDF |
| elbow (1) | [0.0, +2.0944] | [350, 2050] | 1.0 | URDF | Configured | URDF |
| wrist (2) | [-3.1416, +3.1416] | [300, 2600] | 2.0 | **Temporary** | **Temporary** | **Temporary** |
| prismatic (3) | [0.0, +0.06] | [500, 2500] | 0.5 | URDF | Configured | URDF |

> The prismatic joint's "rad" fields hold **metres** (linear actuator); its
> position range is URDF-declared mechanism travel.

### LimitSource Provenance Semantics

Every limit declares its provenance via
`enum class LimitSource { URDF, Measured, Configured, Temporary }`. This is
not decorative: a `Temporary` limit carries different epistemological weight
than a `URDF` or `Measured` limit, and the contract treats it accordingly.

- **URDF** — declared by the mechanism's URDF model (mechanism-safe travel).
  The ±1.57 rad base / ±2.09 rad elbow discrepancy vs full servo travel is
  resolved by explicit authority: the URDF mechanism-safe limit wins.
- **Measured** — found by physical measurement/calibration.
- **Configured** — operator/tuning configuration. Pulse ranges are Configured
  because the URDF cannot express pulse widths (see the calibration notes
  below).
- **Temporary** — provisional, **NOT physically validated yet**. The wrist
  (2) envelope is Temporary: ±3.1416 rad / 2.0 rad/s spans full servo travel
  and is deliberately NOT tightened to an invented "safer" number. It carries
  no enforcement weight until real measurement replaces it (see
  [Gate B](#gate-b-honesty-software-contract-vs-physical-envelope)).

### Calibration Map vs Enforcement Authority

Two per-channel tables coexist and MUST NOT be conflated:

| Table | Role |
|-------|------|
| `JOINT_MIN/MAX_RAD` + `SERVO_PULSE_MIN/MAX_US` | **Calibration map only** — the rad→pulse linear-interpolation endpoints used by `ServoDriver::radToPulseUS()`. Describes HOW a commanded radian maps to a pulse width. |
| `SAFETY_ENVELOPE` | **Enforcement authority** — what may PHYSICALLY execute. Enforced by protocol (per-sample), validator (whole-manifest), and ServoDriver (defensive write). |

A value inside the calibration map but outside the envelope is **rejected,
never clamped**. Recalibrating the mapping never changes enforcement, and
vice versa.

### No-Movement Property

For every command C outside the envelope: `validate(C) == Reject` AND
`actuator_state_after(C) == actuator_state_before(C)`. An out-of-envelope
command → rejected → **actuator writes == 0** (the Wire bus sees no new
transaction) → diagnostic emitted (`ERROR INVALID_JOINT` /
`ERROR MALFORMED_SAMPLE`). The executor never starts on a rejected manifest,
and the state machine latches in `ERROR` until the host recovers via `STOP`.

### Velocity-Bounding (catch-up)

`Executor::step_to()` caps the per-update physical advance:

```
max_advance[ch] = SAFETY_ENVELOPE[ch].max_velocity_rad_per_s × elapsed_since_last_write
```

where `elapsed_since_last_write` is real time since the last **successful**
write, clamped to 1 h as a defensive bound against 32-bit `micros()` wrap or
a stale timestamp. A delayed `update()` (loop stall) NEVER teleports the arm
to a far waypoint: catch-up writes only the last stale waypoint, and even
that is velocity-bounded. A write is committed only if
`ServoDriver::write()` accepts it; a rejected write leaves the position and
the write clock untouched (defensive backstop — never a clamp).

### dt_us==0 Protocol Semantics

When a waypoint carries `dt_us == 0`, physical velocity v = Δq/Δt is
**UNDEFINED** (Δt = 0). This is a **protocol contract**, not an implementation
detail (design ADR-3):

- The firmware MUST NOT infer host velocity from the commanded delta
  (`Δq/0` is not a velocity).
- The firmware **controls advancement**: at most ONE zero-dt waypoint is
  consumed per `update()` call — a degenerate all-zero-dt manifest is stepped
  one waypoint per update, never consumed in a single jump — and the physical
  write advances by at most `max_velocity × elapsed_real_time`.
- Telemetry is preserved: every commanded waypoint is recorded in the sample
  log (recorded BEFORE the write); only the bounded physical write is
  limited.

### Position → Pulse Transformation (rad → pulse)

The transformation from planner domain (rad) to firmware domain (µs, PCA9685
steps) is an explicit linear map (ADR-6):

```
pulse_us = pulse_min + ((rad - pos_min) / (pos_max - pos_min)) × (pulse_max - pulse_min)
steps    = round(pulse_us × PCA9685_STEPS_PER_US)          // 0.2048 steps/µs at 50 Hz
```

`pos_min/pos_max` are the channel's `JOINT_MIN/MAX_RAD` calibration endpoints;
`pulse_min/pulse_max` are `SERVO_PULSE_MIN/MAX_US`. `steps` saturates to the
12-bit `[0, 4095]` range. Because the map is linear and documented, "planner
says valid → pulse conversion → firmware rejects" is **intentional
(conservative defense)**, never an accidental bug.

### Planner→Firmware Consistency (PlannerAccepted ⇒ FirmwareAcceptable)

Two authorities exist with an explicit relationship (spec
`planner-firmware-consistency`): the planner's `PhysicalEnvelope`
(velocity/acceleration ceilings per robot, rad/s, rad/s²) and the firmware's
`SafetyEnvelope` (position rad, pulse µs per actuator). **Every plan the
planner accepts MUST be acceptable to the firmware** — the planner envelope
MUST produce commands within the firmware's envelope:

| Property | Planner | Firmware |
|----------|---------|----------|
| position (rad) | planning | enforcement |
| velocity (rad/s) | planning | enforcement |
| acceleration (rad/s²) | planning | enforcement (via `dt_us` + velocity-bounding) |
| pulse width (µs) | derived (rad→pulse linear map) | enforcement |
| actuator-specific limits | model | final authority |

The domain transformation is explicit: planner velocity/acceleration
(rad/s, rad/s²) map to firmware position (rad) and pulse (µs) through the
documented linear rad→pulse map above. Planner velocity is enforced by the
executor's velocity-bounding (`max_velocity_rad_per_s`); planner acceleration
is enforced indirectly through `dt_us` timing plus velocity-bounding. The
converse is NOT required: the firmware MAY be more conservative than the
planner, and "planner says valid → firmware rejects" is **intentional**
(conservative defense — the firmware is the last barrier).

### Gate B Honesty: Software Contract vs Physical Envelope

Verification distinguishes two very different claims:

- **PASS — software safety contract**: parsing (NaN/Inf/overflow/
  negative-`dt_us` rejection), validation (envelope rejection,
  `INVALID_JOINT`), state machine (`ERROR` latch, `STOP` recovery),
  no-write-on-reject (Wire tx_count unchanged), velocity-bounding and
  dt_us==0 semantics, protocol behavior. Proven by the host test suite
  (`pio test -e native`, 54 pre-existing + 17 safety-contract tests,
  including the Safety Golden Path chain tests).
- **NOT VERIFIED — physical actuator envelope** until real
  calibration/measurement: PWM↔pulse correspondence (PCA9685 step register ↔
  actual µs), the servo actually respecting its declared limits, mechanical
  overtravel, the PCA9685/servo producing the expected motion, and the
  correctness of the derived (rad→pulse) limits. The wrist (2) channel is
  explicitly **Temporary**: its ±3.1416 rad / 2.0 rad/s envelope is NOT
  physically validated and requires measurement before it carries enforcement
  weight.

## State Machine

```
         ┌─────────────────────────────────────┐
         │                                     │
         ▼       HELLO                         │
   ┌──────────┐      ┌──────────┐              │
   │   Idle   │──────►│Handshaking             │
   └──────────┘      └──────────┘              │
         ▲                                      │
         │   MANIFEST                           │
         │      ┌──────────┐                    │
         ├──────┤Receiving ├──── SAMPLE/SEGMENT►│
         │      └─────┬────┘                    │
         │            │ END_UPLOAD              │
         │            ▼                         │
         │      ┌──────────┐                    │
         │      │  Ready   │                    │
         │      └─────┬────┘                    │
         │            │ EXECUTE                 │
         │            ▼                         │
         │      ┌──────────┐                    │
         ├──────┤Executing │                    │
         │      └──────────┘                    │
         │                                      │
         └── STOP / COMPLETED ──────────────────┘
```

## Reserved Commands

### WAIT (post-MVP)

```
HOST → ESP: WAIT
ESP → HOST: COMPLETED | ERROR | ABORTED
```

Reserved for future non-polling completion detection. Not implemented
in the MVP.

## Error Handling

All commands that can fail return:

```
ERROR <reason>
```

The `<reason>` is a human-readable string describing the problem
(e.g., `NOT_READY`, `DOF_MISMATCH`, `INVALID_JOINT`, `MALFORMED_SAMPLE`,
`EXECUTION_FAILED`). The full set of safety-related reasons and their
triggers is documented in the
[Safety Contract](#safety-contract-execution-safety-envelope).

The host treats any `ERROR` response as a protocol error and aborts
the current operation. Unexpected responses (e.g., `READY` when
expecting `OK`) also trigger a protocol error.

## Host-Side Validation

Before uploading any manifest, the host backend validates:

1. **Non-empty**: At least one waypoint must be provided
2. **Consistent DOF**: All waypoints must have the same joint count
3. **Positive duration**: Total execution time must be > 0
4. **Non-empty joints**: Each waypoint must have at least one joint value

These checks happen before any wire traffic, ensuring invalid
manifests are rejected locally.

## Example Exchange

### Full upload→execute→collect cycle

```
HOST                          ESP
────                          ───
HELLO 1
                              HELLO 1 OK
MANIFEST 6 5 2000000
                              OK
SEGMENT 0 movej 0 2
                              OK
SEGMENT 1 movel 2 3
                              OK
SAMPLE 0.0 0.0 0.0 0.0 0.0 0.0 0
                              OK
SAMPLE 0.5 0.3 0.1 -0.1 0.0 0.0 1000000
                              OK
SAMPLE 0.5 0.3 0.1 -0.1 0.0 0.0 0
                              OK
SAMPLE 0.8 0.6 0.2 -0.2 0.1 0.0 500000
                              OK
SAMPLE 1.0 0.8 0.3 -0.3 0.1 0.0 500000
                              OK
END_UPLOAD
                              READY
EXECUTE
                              OK
STATUS
                              STATUS RUNNING
... (polling)
STATUS
                              STATUS COMPLETED
SAMPLES 5
                              OK
SAMPLE 0 0.0 0.0 0.0 0.0 0.0 0.0
SAMPLE 1000000 0.5 0.3 0.1 -0.1 0.0 0.0
SAMPLE 1000000 0.5 0.3 0.1 -0.1 0.0 0.0
SAMPLE 1500000 0.8 0.6 0.2 -0.2 0.1 0.0
SAMPLE 2000000 1.0 0.8 0.3 -0.3 0.1 0.0
```
