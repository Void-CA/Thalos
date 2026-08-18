// DO NOT EDIT — generated from config/safety-envelope.toml
// Regenerate: python3 tools/generate_safety_config.py

// metadata: schema_version 1, robot icebot, dof_count 4

#ifndef THALOS_SERVO_SAFETY_H
#define THALOS_SERVO_SAFETY_H

#include "servo_hw_config.h"

// ── Limit provenance — mirrors the firmware contract ──────────────
enum class LimitSource : uint8_t { URDF, Measured, Configured, Temporary };

struct SafetyEnvelope {
    float position_min_rad, position_max_rad;
    uint16_t pulse_min_us, pulse_max_us;
    float max_velocity_rad_per_s;
    LimitSource position_source, pulse_source, velocity_source;
};

// ── Joint Limits (rad) — CALIBRATION MAP ONLY (ADR-1 authority split) ────
// Per-channel rad→pulse linear-interpolation endpoints; NOT the execution enforcement authority.
constexpr float JOINT_MIN_RAD[NUM_SERVO_CHANNELS] = {
    -1.5708f, -1.5708f, -3.1416f, 0.0f,
};
constexpr float JOINT_MAX_RAD[NUM_SERVO_CHANNELS] = {
    1.5708f, 1.5708f, 3.1416f, 0.06f,
};

// ── Pulse Width Range (µs) — SERVO_PULSE_MIN/MAX_US ───────────────
constexpr uint16_t SERVO_PULSE_MIN_US[NUM_SERVO_CHANNELS] = {
    350, 375, 300, 1500,
};
constexpr uint16_t SERVO_PULSE_MAX_US[NUM_SERVO_CHANNELS] = {
    2150, 2175, 2600, 1550,
};

// ── SafetyEnvelope — EXECUTION ENFORCEMENT AUTHORITY (ADR-1) ─────────
// What may PHYSICALLY execute. Every layer that can stop a command enforces this envelope.
constexpr SafetyEnvelope SAFETY_ENVELOPE[NUM_SERVO_CHANNELS] = {
    // base (0)
    { -1.5708f, 1.5708f, SERVO_PULSE_MIN_US[0], SERVO_PULSE_MAX_US[0], 1.0f, LimitSource::URDF, LimitSource::Configured, LimitSource::URDF },
    // elbow (1)
    { -1.5708f, 1.5708f, SERVO_PULSE_MIN_US[1], SERVO_PULSE_MAX_US[1], 1.0f, LimitSource::URDF, LimitSource::Configured, LimitSource::URDF },
    // wrist (2)
    { -3.1416f, 3.1416f, SERVO_PULSE_MIN_US[2], SERVO_PULSE_MAX_US[2], 2.0f, LimitSource::Temporary, LimitSource::Temporary, LimitSource::Temporary },
    // prismatic (3)
    { 0.0f, 0.06f, SERVO_PULSE_MIN_US[3], SERVO_PULSE_MAX_US[3], 0.5f, LimitSource::URDF, LimitSource::Configured, LimitSource::URDF },
};

#endif // THALOS_SERVO_SAFETY_H
