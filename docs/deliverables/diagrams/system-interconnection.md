# System Interconnection Diagram

Physical interconnection between the ESP32 controller and the ICEBOT actuators.

## Block Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        THALOS HOST                              │
│  (Rust backend — planning, verification, safety envelope)       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TCP / Serial (460800 baud)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ESP32-S3 CONTROLLER                         │
│                                                                 │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌───────────┐  │
│  │ Protocol │──▶│ Validator │──▶│ Executor │──▶│ Servo     │  │
│  │ (poll)   │   │ (safety)  │   │ (state)  │   │ Driver    │  │
│  └──────────┘   └───────────┘   └──────────┘   └─────┬─────┘  │
│                                                       │        │
└───────────────────────────────────────────────────────┼────────┘
                                                        │
                                          I²C Bus (SDA→GPIO4, SCL→GPIO5)
                                          Address: 0x40
                                                        │
                                                        ▼
                                           ┌────────────────────┐
                                           │     PCA9685        │
                                           │  16-ch PWM Driver  │
                                           │  50 Hz (prescale   │
                                           │  = 0x79)           │
                                           └──┬──┬──┬──┬───────┘
                                              │  │  │  │
                               Ch15    Ch14    Ch12   Ch11
                                 │       │       │      │
                                 ▼       ▼       ▼      ▼
┌───────────────────────────────────────────────────────────────────┐
│                    ACTUATOR ARRAY                                 │
│                                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────────┐   │
│  │  Base   │  │  Elbow  │  │  Wrist  │  │  Prismatic (Lin) │   │
│  │ Servo   │  │ Servo   │  │ Servo   │  │  Servo + Screw   │   │
│  │ DS3240  │  │ DS3240  │  │ DS3240  │  │  Mechanism        │   │
│  └─────────┘  └─────────┘  └─────────┘  └──────────────────┘   │
│                                                                   │
│  Joint 0 (base): ±1.5708 rad  │  Pulse: 350–2150 µs            │
│  Joint 1 (elbow): 0–2.0944 rad │  Pulse: 350–2050 µs           │
│  Joint 2 (wrist): ±3.1416 rad  │  Pulse: 300–2600 µs           │
│  Joint 3 (prismatic): 0–0.06 m │  Pulse: 500–2500 µs           │
└───────────────────────────────────────────────────────────────────┘
```

## Power Distribution

```
┌──────────────┐
│  5V / 6V PSU │ (external, dedicated to servos)
└──────┬───────┘
       │
       ├──▶ PCA9685 V+ (servo power rail)
       │         │
       │         ├──▶ Channel 15 → Base servo
       │         ├──▶ Channel 14 → Elbow servo
        │         ├──▶ Channel 12 → Wrist servo
        │         └──▶ Channel 11 → Prismatic servo
       │
       └──▶ ESP32 VIN (logic supply, if shared)
```

## Key Electrical Facts

| Parameter | Value | Source |
|-----------|-------|--------|
| I²C SDA | GPIO4 | servo_hw_config.h |
| I²C SCL | GPIO5 | servo_hw_config.h |
| PCA9685 Address | 0x40 | servo_hw_config.h |
| PCA9685 Prescale | 0x79 (50 Hz) | servo_hw_config.h |
| Steps/µs | 0.2048 (nominal) | servo_hw_config.h |
| Serial Baud | 460800 | main.cpp |
| RX Buffer | 4096 bytes | main.cpp |

## Notes

- **No optical isolation** is implemented between the PCA9685 and the servos. The I²C bus operates at logic level (3.3V).
- **No external encoders** are present on the joints. Position feedback is internal to each servo (potentiometer-based closed loop at the actuator level).
- **Graceful degradation**: if PCA9685 is not detected at startup, servo writes become no-ops and the rest of the firmware (execution, protocol, samples) continues working.
