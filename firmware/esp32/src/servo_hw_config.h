#ifndef THALOS_SERVO_HW_CONFIG_H
#define THALOS_SERVO_HW_CONFIG_H

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

#endif // THALOS_SERVO_HW_CONFIG_H
