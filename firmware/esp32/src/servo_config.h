#ifndef THALOS_SERVO_CONFIG_H
#define THALOS_SERVO_CONFIG_H

#include <cstdint>

// ── I2C Configuration ──────────────────────────────────────────────────────
// Physical wiring (confirmed by user): PCA9685 SDA → D4 (GPIO4), SCL → D5 (GPIO5)
// Note: Physical PCA9685 wiring may use different GPIOs — adjust to match real wiring.
constexpr uint8_t I2C_SDA = 4;
constexpr uint8_t I2C_SCL = 5;
constexpr uint8_t PCA9685_ADDR = 0x40;

// ── Servo Channels (4 DOF: RRPR icebot) ────────────────────────────────────
// Maps joint index → PCA9685 channel.
// HIGH channels chosen on purpose: the low-numbered header pins sit too close
// to the low-quality wiring run, so the servos live on the far side of the
// connector. Joint 0 (base) → 15 (physically connected), 1 → 14, 2 → 13,
// 3 (prismatic) → 12.
constexpr uint8_t NUM_SERVO_CHANNELS = 4;
constexpr uint8_t SERVO_CHANNELS[NUM_SERVO_CHANNELS] = {15, 14, 13, 12};

// ── Pulse Width Range (microseconds) ───────────────────────────────────────
// Per-channel calibration: adjust based on physical servo specs
// canal 0 (base): rango util REAL del servo DS3240MG ~[350, 1725] us —
//   confirmado por comportamiento: pulsos >1725us causan "recorrido de
//   reinicio" (el servo pierde la referencia con pulsos fuera de rango).
//   Con margen de seguridad: 350-1650 (nunca mandar mas alla).
// canal 1 (codo, MEDIDO 2026-08-12): rango real ~[350, 2150] us — este servo
//   da mas que el de la base (varianza por unidad del DS3240MG). Con margen:
//   350-2050 (~100us bajo el tope).
// canal 2 (muneca): ⚠️ TEMPORAL mapeo amplio 300-2600 para calibrar el MG90S
//   SIN capado. DESPUES de medir, fijar el rango real con margen.
constexpr uint16_t SERVO_PULSE_MIN_US[NUM_SERVO_CHANNELS] = {350, 350, 300, 500};
constexpr uint16_t SERVO_PULSE_MAX_US[NUM_SERVO_CHANNELS] = {1650, 2050, 2600, 2500};

// ── Joint Limits (radians) — CALIBRATION MAP ONLY ──────────────────────────
// Per-channel rad→pulse linear-interpolation endpoints (the calibration /
// reference map used by ServoDriver::radToPulseUS()). They describe HOW a
// commanded radian maps to a pulse width; they are NOT the execution
// enforcement authority (design ADR-1 authority split, M1).
//
// Enforcement lives EXCLUSIVELY in SAFETY_ENVELOPE below: a value inside this
// map but outside the envelope is rejected, never clamped. M1 restores the
// mechanism-safe calibration endpoints (the measurement-mode ±3.14 expansion
// is gone): the map spans the same mechanism-safe travel as the envelope, so
// the full calibrated pulse range is reachable for every ACCEPTED joint value.
constexpr float JOINT_MIN_RAD[NUM_SERVO_CHANNELS] = {-1.5708f, 0.0f,   -3.1416f, 0.0f};
constexpr float JOINT_MAX_RAD[NUM_SERVO_CHANNELS] = { 1.5708f, 2.0944f, 3.1416f, 0.06f};

// ── SafetyEnvelope — EXECUTION ENFORCEMENT AUTHORITY (ADR-1) ───────────────
// What may PHYSICALLY execute. Every layer that can stop a command enforces
// this envelope: protocol per-sample, validator whole-manifest, ServoDriver
// defensive write. Distinct from JOINT_MIN/MAX_RAD — recalibrating the
// mapping never changes enforcement, and vice versa.
enum class LimitSource : uint8_t {
    URDF,        // declared by the mechanism's URDF model
    Measured,    // found by physical measurement/calibration
    Configured,  // operator/tuning configuration
    Temporary    // provisional — NOT physically validated yet
};

struct SafetyEnvelope {
    float position_min_rad, position_max_rad;
    uint16_t pulse_min_us, pulse_max_us;
    float max_velocity_rad_per_s;
    LimitSource position_source, pulse_source, velocity_source;
};

constexpr SafetyEnvelope SAFETY_ENVELOPE[NUM_SERVO_CHANNELS] = {
    // base (0): URDF mechanism-safe ±1.5708 rad; pulse Configured; velocity URDF.
    { -1.5708f,  1.5708f, SERVO_PULSE_MIN_US[0], SERVO_PULSE_MAX_US[0], 1.0f,
      LimitSource::URDF, LimitSource::Configured, LimitSource::URDF },
    // elbow (1): URDF 0..2.0944 rad.
    {  0.0f,     2.0944f, SERVO_PULSE_MIN_US[1], SERVO_PULSE_MAX_US[1], 1.0f,
      LimitSource::URDF, LimitSource::Configured, LimitSource::URDF },
    // wrist (2): ⚠️ TEMPORARY — full servo travel ±3.1416 rad. NOT physically
    // validated; deliberately NOT tightened (do not invent a safer number
    // without measurement) until real calibration replaces it.
    { -3.1416f,  3.1416f, SERVO_PULSE_MIN_US[2], SERVO_PULSE_MAX_US[2], 2.0f,
      LimitSource::Temporary, LimitSource::Temporary, LimitSource::Temporary },
    // prismatic (3): URDF 0..0.06 m (linear actuator; the rad fields hold
    // metres).
    {  0.0f,     0.06f,   SERVO_PULSE_MIN_US[3], SERVO_PULSE_MAX_US[3], 0.5f,
      LimitSource::URDF, LimitSource::Configured, LimitSource::URDF },
};

// ── PCA9685 Constants (NOMINAL) ────────────────────────────────────────────
// 50 Hz PWM → prescale value 0x79 (see PCA9685 datasheet)
// Formula: prescale = round(osc_clock / (4096 * update_rate)) - 1
//        = round(25MHz / (4096 * 50Hz)) - 1 = 121 = 0x79
// NOTE: Internal oscillator has ~±1% tolerance — real frequency varies.
constexpr uint8_t PCA9685_PRESCALE = 0x79;

// Step conversion: 50 Hz → 20ms period → 4096 steps
// steps_per_us = 4096 / 20000 = 0.2048 (NOMINAL)
// Example: 500µs → 102 steps, 2500µs → 512 steps
// NOTE: This is a nominal conversion; actual timing depends on oscillator tolerance.
constexpr float PCA9685_STEPS_PER_US = 0.2048f;

#endif // THALOS_SERVO_CONFIG_H
