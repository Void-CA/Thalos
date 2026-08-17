# Control Architecture

End-to-end control flow from task definition to physical actuation.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         THALOS PLATFORM                             │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌───────────────┐  │
│  │   Task   │──▶│ Compiler │──▶│ Planner  │──▶│   Verifier    │  │
│  │ (Semantic│   │(lowering)│   │ (MoveJ/  │   │ (constraints, │  │
│  │ Program) │   │          │   │  MoveL)  │   │  collisions,  │  │
│  └──────────┘   └──────────┘   └──────────┘   │  singularities│  │
│                                                └───────┬───────┘  │
│                                                        │          │
│  ┌─────────────────────────────────────────────────────┘          │
│  │                                                                │
│  │  ┌─────────────────────────────────────────────────────────┐  │
│  │  │              SAFETY VALIDATION                          │  │
│  │  │  • Joint limits (position_min/max_rad)                  │  │
│  │  │  • Velocity limits (max_velocity_rad_per_s)             │  │
│  │  │  • Safety envelope (config/safety-envelope.toml)        │  │
│  │  │  • Rejection (not clamping) — invalid commands refused  │  │
│  │  └─────────────────────────┬───────────────────────────────┘  │
│  │                            │                                  │
│  │                            ▼                                  │
│  │  ┌─────────────────────────────────────────────────────────┐  │
│  │  │         COMMAND DISPATCH (TCP / Serial)                 │  │
│  │  │  HELLO → MANIFEST → SEGMENT → SAMPLE → EXECUTE         │  │
│  │  └─────────────────────────┬───────────────────────────────┘  │
│  └────────────────────────────┘                                  │
└───────────────────────────────────────────────────────────────────┘
                              │
                    TCP / Serial (460800 baud)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        ESP32 FIRMWARE                               │
│                                                                     │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌───────────────┐  │
│  │ Protocol │──▶│ Validator │──▶│ Executor │──▶│ Servo Driver  │  │
│  │ (parse)  │   │ (2nd pass)│   │ (state   │   │ (PWM compute) │  │
│  │          │   │           │   │  machine)│   │               │  │
│  └──────────┘   └───────────┘   └──────────┘   └───────┬───────┘  │
│                                                         │          │
│  State: Idle → Handshaking → Receiving → Ready          │          │
│         → Executing → (ERROR or Idle)                   │          │
└─────────────────────────────────────────────────────────┼──────────┘
                                                          │
                                                I²C (PCA9685)
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        ACTUATORS                                    │
│                                                                     │
│  PCA9685 → PWM signals (50 Hz) → Servos                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              SERVO INTERNAL CONTROL LOOP                    │   │
│  │                                                             │   │
│  │  PWM input → Internal potentiometer → Error → Motor drive   │   │
│  │                                                             │   │
│  │  This is the ONLY closed-loop component in the system.      │   │
│  │  Thalos has NO position feedback from the servo to the host.│   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Control Layers

| Layer | Component | Responsibility | Feedback |
|-------|-----------|---------------|----------|
| Task | Thalos SemanticProgram | High-level task description | — |
| Planning | Thalos Planner (MoveJ/MoveL) | Trajectory generation with profiles | — |
| Verification | Thalos Verifier | Constraint checking, collision detection | — |
| Safety | Thalos Safety Envelope | Position/velocity limits, command rejection | — |
| Transport | TCP/Serial protocol | Command upload, status query | — |
| Firmware | ESP32 Protocol + Executor | Parse, validate (2nd pass), execute | — |
| Actuation | PCA9685 → Servo | PWM generation → internal servo loop | Potentiometer (internal) |

## Important: What is NOT Implemented

| Capability | Status | Impact |
|------------|--------|--------|
| Closed-loop control (PID/state-space) at system level | NOT IMPLEMENTED | Position is commanded, not measured |
| External encoder feedback | NOT IMPLEMENTED | No robot→host position data |
| Real-time trajectory correction | NOT IMPLEMENTED | Open-loop execution |
| Optical isolation between logic and power | NOT IMPLEMENTED | Shared ground between ESP32 and PCA9685 |

The system operates in **open-loop at the platform level** with **closed-loop at the actuator level** (servo internal feedback). Commands are validated twice (Thalos + ESP32) before reaching the actuator, but no position measurement returns from the actuator to the host.
