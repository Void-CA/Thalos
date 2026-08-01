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
ESP → HOST: STATUS RUNNING
         or: STATUS COMPLETED
         or: STATUS ERROR <reason>
```

Returns the current state of execution. Used for polling-based
completion detection.

### SAMPLES — Collect execution trace

```
HOST → ESP: SAMPLES <count>
ESP → HOST: OK
         → SAMPLE <ts> <j0> <j1> ...
         → SAMPLE <ts> <j0> <j1> ...
         → ... (×count lines)
```

Requests the firmware to upload `count` recorded execution samples.

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
