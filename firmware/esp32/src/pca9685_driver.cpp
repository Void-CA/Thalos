#include "pca9685_driver.h"

// ── Constructor ──────────────────────────────────────────────────────────

PCA9685Driver::PCA9685Driver()
    : address_(PCA9685_ADDR)
{
}

// ── Device configuration ─────────────────────────────────────────────────

void PCA9685Driver::begin() {
    // 1. Read current MODE1 (preserve any existing configuration bits).
    uint8_t mode1 = readRegister(PCA9685_MODE1_REG);

    // 2. Enter SLEEP — oscillator stopped; PRESCALE is only writable in SLEEP.
    writeRegister(PCA9685_MODE1_REG, mode1 | PCA9685_MODE1_SLEEP);

    // 3. Set prescale for 50 Hz (nominal 0x79; oscillator tolerance ±1%).
    writeRegister(PCA9685_PRESCALE_REG, PCA9685_PRESCALE);

    // 4. Restore MODE1: leave SLEEP, restart the oscillator, enable
    //    auto-increment (AI) for consecutive multi-register writes.
    writeRegister(PCA9685_MODE1_REG,
                  (mode1 & ~PCA9685_MODE1_SLEEP) | PCA9685_MODE1_RESTART | PCA9685_MODE1_AI);

    // 5. MODE2 = 0x04: OUTDRV=1 — totem-pole output, recommended for servos.
    writeRegister(PCA9685_MODE2_REG, PCA9685_MODE2_OUTDRV);

    // 6. Clear every output channel (on=0, off=0 → output LOW).
    //    Physical-safety: the PCA9685 retains its registers while VCC is
    //    applied, even across ESP32 resets. A leftover pulse on any channel
    //    (e.g. from a previous sketch) would move that servo the moment it is
    //    connected. Clear all 16 so no servo receives a stale signal before
    //    the first EXECUTE.
    for (uint8_t ch = 0; ch < PCA9685_MAX_CHANNELS; ++ch) {
        setPWM(ch, 0, 0);
    }
}

// ── PWM output ───────────────────────────────────────────────────────────

void PCA9685Driver::setPWM(uint8_t channel, uint16_t on, uint16_t off) {
    if (channel >= PCA9685_MAX_CHANNELS) {
        return;   // bounds check: invalid channel is a no-op
    }
    // 12-bit saturation (spec: step saturation/underflow → 0..4095).
    if (on  > PCA9685_MAX_STEPS) on  = PCA9685_MAX_STEPS;
    if (off > PCA9685_MAX_STEPS) off = PCA9685_MAX_STEPS;

    uint8_t base = PCA9685_LED0_ON_L + channel * 4;

    // Single I2C transaction per channel: [reg, onL, onH, offL, offH].
    Wire.beginTransmission(address_);
    Wire.write(base);
    Wire.write(static_cast<uint8_t>(on & 0xFF));
    Wire.write(static_cast<uint8_t>(on >> 8));
    Wire.write(static_cast<uint8_t>(off & 0xFF));
    Wire.write(static_cast<uint8_t>(off >> 8));
    Wire.endTransmission();
}

// ── Register access ──────────────────────────────────────────────────────

void PCA9685Driver::writeRegister(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(address_);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}

uint8_t PCA9685Driver::readRegister(uint8_t reg) {
    Wire.beginTransmission(address_);
    Wire.write(reg);
    Wire.endTransmission();

    Wire.requestFrom(address_, static_cast<uint8_t>(1));
    if (Wire.available() >= 1) {
        return static_cast<uint8_t>(Wire.read());
    }
    return 0x00;   // device absent/unresponsive — treat as zero
}
