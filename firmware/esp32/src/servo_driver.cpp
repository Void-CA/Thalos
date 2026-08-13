#include "servo_driver.h"

// ── Constructor ──────────────────────────────────────────────────────────

ServoDriver::ServoDriver()
    : pca9685_(nullptr)
    , enabled_(false)
{
}

// ── Lifecycle ────────────────────────────────────────────────────────────

void ServoDriver::init(PCA9685Driver& pca9685) {
    pca9685_ = &pca9685;
    enabled_ = true;
}

bool ServoDriver::enabled() const {
    return enabled_;
}

void ServoDriver::set_enabled(bool enabled) {
    enabled_ = enabled;
}

// ── Actuation ────────────────────────────────────────────────────────────

bool ServoDriver::write(const std::vector<float>& joints) {
    // Whole-waypoint validation FIRST — reject before any physical write so
    // a bad waypoint never leaves the robot in a partially-commanded state.
    if (joints.size() < NUM_SERVO_CHANNELS) {
        return false;
    }
    for (size_t i = 0; i < NUM_SERVO_CHANNELS; ++i) {
        if (!std::isfinite(joints[i])) {
            return false;   // NaN or ±Inf → reject the entire waypoint
        }
    }

    // SAFETY_ENVELOPE enforcement (ADR-2, defensive last barrier): any joint
    // outside the envelope rejects the ENTIRE waypoint. There is NO clamp to
    // the enforcement envelope — an invalid command must never be silently
    // transformed into a valid one. (JOINT_MIN/MAX_RAD is the calibration map
    // only; it is NOT checked here and NOT used for clamping.)
    for (size_t i = 0; i < NUM_SERVO_CHANNELS; ++i) {
        const SafetyEnvelope& env = SAFETY_ENVELOPE[i];
        if (joints[i] < env.position_min_rad || joints[i] > env.position_max_rad) {
            return false;
        }
    }

    if (pca9685_ == nullptr || !enabled_) {
        return false;
    }

    for (uint8_t ch = 0; ch < NUM_SERVO_CHANNELS; ++ch) {
        float rad = joints[ch];
        float    pulse_us = radToPulseUS(ch, rad);
        uint16_t steps    = pulseUSToSteps(pulse_us);
        pca9685_->setPWM(SERVO_CHANNELS[ch], 0, steps);
    }
    return true;
}

// ── Conversion helpers ────────────────────────────────────────────────────

float ServoDriver::radToPulseUS(uint8_t channel, float radians) const {
    const float min_rad = JOINT_MIN_RAD[channel];
    const float max_rad = JOINT_MAX_RAD[channel];
    const float min_us  = static_cast<float>(SERVO_PULSE_MIN_US[channel]);
    const float max_us  = static_cast<float>(SERVO_PULSE_MAX_US[channel]);

    float range = max_rad - min_rad;
    if (range <= 0.0f) {
        return min_us;   // degenerate range — pin to the minimum pulse
    }

    float t = (radians - min_rad) / range;
    return min_us + t * (max_us - min_us);
}

uint16_t ServoDriver::pulseUSToSteps(float pulse_us) const {
    // steps = pulse_us × 0.2048 (NOMINAL at 50 Hz), rounded to nearest step.
    float steps = pulse_us * PCA9685_STEPS_PER_US + 0.5f;

    // Saturate to the 12-bit range (spec: step saturation/underflow).
    if (steps < 0.0f) steps = 0.0f;
    if (steps > static_cast<float>(PCA9685_MAX_STEPS)) {
        steps = static_cast<float>(PCA9685_MAX_STEPS);
    }
    return static_cast<uint16_t>(steps);
}
