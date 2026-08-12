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
```

Uploads a single timed waypoint. The host sends all samples during
the manifest upload phase, between `MANIFEST` and `END_UPLOAD`.

| Field | Type | Description |
|-------|------|-------------|
| `j0..jN` | f64 | Joint positions (N = `dof_count` values) |
| `dt_us` | u32 | Microseconds since previous waypoint (0 for first sample) |

**Example:**
```
SAMPLE 0.0 0.0 0.0 0.0 0.0 0.0 0
OK
SAMPLE 0.1 0.05 -0.02 0.3 0.0 0.0 20000
OK
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
| `TIMING_COUNT` | Timing values malformed |
| `EMPTY_MANIFEST` | No waypoints received |

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

### Write Policy: Catch-up (last stale waypoint only)

`Executor::step_to()` records **every** waypoint in the sample log (wire
contract — samples are the values commanded by the plan, for
post-execution analysis). Physical actuation writes **only the last stale
waypoint** per `update()` cycle; intermediate waypoints skipped by a
delayed loop are not written (they were never physically reached). In
normal operation (dt ≈ 10 ms, loop ≈ 1 kHz) waypoints never accumulate.

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
   limit was confirmed by behavior. The firmware clamp must never emit such
   pulses.

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
(margin below the 1725 µs reset threshold), `JOINT_MIN/MAX_RAD = ±3.14`
(maps the full usable servo range). The same calibration procedure applies
to joints 1–3.

### Probe Degradation (PCA9685 absent)

At boot the firmware probes address 0x40 (`endTransmission() == 0` → ACK,
device present). If the PCA9685 is not found it logs
`PCA9685 NOT found — servos disabled` and every servo write becomes a
no-op. Execution, protocol handling and sample recording continue to work
normally (simulation-only mode).

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
(e.g., `NOT_READY`, `DOF_MISMATCH`, `EXECUTION_FAILED`).

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
