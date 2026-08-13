#ifndef THALOS_SERVO_DRIVER_H
#define THALOS_SERVO_DRIVER_H

#include <Arduino.h>
#include <cmath>
#include <vector>
#include "pca9685_driver.h"
#include "servo_config.h"

/// Per-channel servo abstraction: joint positions (radians) → PWM pulses.
///
/// Owns validation and physical constraints: whole-waypoint validation
/// (size >= NUM_SERVO_CHANNELS, all joints finite), SAFETY_ENVELOPE
/// enforcement (reject — NEVER silent clamp; ADR-2), radian→pulse→steps
/// conversion and the enabled() availability state (probe result + init
/// success). Physical I2C writes delegate to PCA9685Driver.
class ServoDriver {
public:
    ServoDriver();

    /// Initialize with PCA9685 driver instance (enables the driver).
    void init(PCA9685Driver& pca9685);

    /// Write joint positions (radians) to servo channels.
    /// Validates: size >= NUM_SERVO_CHANNELS, all joints finite, every joint
    /// inside SAFETY_ENVELOPE. Returns false and performs NO PCA9685 write
    /// when validation fails (rejects the ENTIRE waypoint — no partial
    /// writes, no clamping). Returns true when the write was issued.
    /// @param joints joint values, one per channel
    /// @return true if the write was performed, false if rejected
    bool write(const std::vector<float>& joints);

    /// Whether the driver is enabled (probe succeeded + init called).
    bool enabled() const;

    /// Set enabled state (called by main.cpp after the boot probe).
    void set_enabled(bool enabled);

private:
    PCA9685Driver* pca9685_;
    bool enabled_;

    /// Convert radians to pulse width (microseconds) for a channel.
    float radToPulseUS(uint8_t channel, float radians) const;

    /// Convert pulse width (microseconds) to PCA9685 steps (0-4095).
    uint16_t pulseUSToSteps(float pulse_us) const;
};

#endif // THALOS_SERVO_DRIVER_H
