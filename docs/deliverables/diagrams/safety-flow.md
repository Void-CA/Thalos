# Safety Flow

Multi-layer safety validation from task definition to actuator command.

## Safety Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: TRAJECTORY VERIFICATION                 │
│                    (thalos-core / thalos-planning)                   │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────┐  │
│  │ Joint Limits    │  │ Collision       │  │ Singularity       │  │
│  │ (per-articulation│  │ Detection       │  │ Analysis          │  │
│  │  min/max rad)   │  │ (SAT, OBB)      │  │ (manipulability)  │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────┬─────────┘  │
│           │                    │                      │            │
│           └────────────────────┼──────────────────────┘            │
│                                │                                   │
│                                ▼                                   │
│                    ┌───────────────────────┐                       │
│                    │  TRAJECTORY REJECTED  │ ──▶ No execution     │
│                    │  if ANY check fails   │                       │
│                    └───────────┬───────────┘                       │
│                                │ (all pass)                        │
│                                ▼                                   │
│                    ┌───────────────────────┐                       │
│                    │  TRAJECTORY APPROVED  │                       │
│                    └───────────┬───────────┘                       │
└────────────────────────────────┼────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 2: SAFETY ENVELOPE                         │
│                    (config/safety-envelope.toml → generated code)   │
│                                                                     │
│  For each joint channel:                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  position_min_rad ≤ commanded ≤ position_max_rad  ?        │   │
│  │  |velocity| ≤ max_velocity_rad_per_s              ?        │   │
│  │                                                             │   │
│  │  REJECT (not clamp) if outside bounds                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Channel values (source: URDF / Configured / Temporary):           │
│  ┌──────────┬──────────────────┬──────────────────┬───────────┐   │
│  │ Channel  │ Position (rad)   │ Velocity (rad/s) │ Source    │   │
│  ├──────────┼──────────────────┼──────────────────┼───────────┤   │
│  │ base (0) │ ±1.5708          │ 1.0              │ URDF      │   │
│  │ elbow(1) │ 0..2.0944        │ 1.0              │ URDF      │   │
│  │ wrist(2) │ ±3.1416          │ 2.0              │ Temporary │   │
│  │ prism(3) │ 0..0.06 m        │ 0.5              │ URDF      │   │
│  └──────────┴──────────────────┴──────────────────┴───────────┘   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 3: PROTOCOL VALIDATION                     │
│                    (firmware/esp32 — Validator)                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Command arrives via TCP/Serial                             │   │
│  │  ↓                                                          │   │
│  │  Parse: MANIFEST, SEGMENT, SAMPLE, EXECUTE, STOP, STATUS   │   │
│  │  ↓                                                          │   │
│  │  Validate: joint count, pulse range, segment structure      │   │
│  │  ↓                                                          │   │
│  │  REJECT with ERROR if invalid                               │   │
│  │  ACCEPT with OK if valid                                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  State machine:                                                    │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Idle ──▶ Handshaking ──▶ Receiving ──▶ Ready            │     │
│  │    ▲                                    │                │     │
│  │    │                                    ▼                │     │
│  │    └────── Idle (STOP) ◀── Executing ──┘                │     │
│  │              │                                           │     │
│  │              └──▶ ERROR (latched until STOP)             │     │
│  └──────────────────────────────────────────────────────────┘     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LAYER 4: EMERGENCY STOP                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  STOP command → Executor ceases all PWM writes              │   │
│  │  Servos hold last position (no power removal)               │   │
│  │  Protocol returns to Idle state                             │   │
│  │  Physical E-stop button: present on structure               │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Safety Properties

| Property | Mechanism | Layer |
|----------|-----------|-------|
| Joint position within limits | Envelope check (reject, not clamp) | 2 |
| Velocity within limits | Envelope check | 2 |
| No collision with environment | SAT/OBB intersection | 1 |
| No self-collision | Link volume intersection | 1 |
| Trajectory singularity-free | Manipulability analysis | 1 |
| Invalid protocol command | Firmware validator | 3 |
| Emergency stop | STOP command + hold-by-inaction | 4 |
| Graceful degradation | PCA9685 absent → servos disabled | Firmware |

## What is NOT a Safety Mechanism

| Item | Why it's NOT safety |
|------|-------------------|
| Servo internal feedback | Actuator-level only; no data returns to host |
| PWM pulse calibration | Converts rad→µs; does not verify actual position |
| Executor state machine | Controls execution sequence, not physical safety |
| Thalos "commanded state" | Reports what was ordered, not what happened |

## Honest Boundary

> The system validates every command before it reaches the actuator. If a command is invalid, it is rejected — never silently corrected. However, once a valid command is sent, the system has no means to verify that the actuator actually reached the commanded position. The absence of external encoders means the platform operates on **trust in the command**, not **verification of the outcome**.
