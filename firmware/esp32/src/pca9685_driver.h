#ifndef THALOS_PCA9685_DRIVER_H
#define THALOS_PCA9685_DRIVER_H

#include <Arduino.h>
#include <Wire.h>
#include <cstdint>
#include "servo_hw_config.h"

// ── PCA9685 register map (datasheet) ─────────────────────────────────────

constexpr uint8_t PCA9685_MODE1_REG     = 0x00;
constexpr uint8_t PCA9685_MODE2_REG     = 0x01;
constexpr uint8_t PCA9685_LED0_ON_L     = 0x06;    // LED0_ON_L; channel stride = 4
constexpr uint8_t PCA9685_PRESCALE_REG  = 0xFE;

// MODE1 bits
constexpr uint8_t PCA9685_MODE1_SLEEP   = 0x10;
constexpr uint8_t PCA9685_MODE1_AI      = 0x20;    // auto-increment
constexpr uint8_t PCA9685_MODE1_RESTART = 0x80;    // restart oscillator

// MODE2 value: 0x04 → OUTDRV=1 (totem-pole output, recommended for servos)
constexpr uint8_t PCA9685_MODE2_OUTDRV  = 0x04;

constexpr uint8_t  PCA9685_MAX_CHANNELS = 16;
constexpr uint16_t PCA9685_MAX_STEPS    = 4095;

/// Low-level I2C driver for the PCA9685 16-channel 12-bit PWM controller.
///
/// Knows nothing about joints, radians or trajectories — it writes raw
/// 12-bit PWM values to I2C registers. Does NOT own the I2C bus:
/// main.cpp calls Wire.begin() once and remains the single bus owner.
class PCA9685Driver {
public:
    PCA9685Driver();

    /// Configure the PCA9685 device for 50 Hz PWM.
    /// Assumes Wire.begin() was already called by main.cpp (bus owner).
    /// Sequence: read MODE1 → enter SLEEP → PRESCALE → restore MODE1
    /// (leave SLEEP, restart oscillator, auto-increment) → MODE2.
    void begin();

    /// Set PWM value for a channel.
    /// @param channel 0-15 (PCA9685 has 16 channels; others are a no-op)
    /// @param on 12-bit on-time (typically 0)
    /// @param off 12-bit off-time (0-4095, pulse width)
    void setPWM(uint8_t channel, uint16_t on, uint16_t off);

private:
    uint8_t address_;   // PCA9685 I2C address (default 0x40)

    void writeRegister(uint8_t reg, uint8_t value);
    uint8_t readRegister(uint8_t reg);
};

#endif // THALOS_PCA9685_DRIVER_H
