// Thalos firmware — ServoDriver unit tests (host, no hardware).
//
// Exercises the real src/servo_driver.cpp against the real PCA9685Driver
// and the Wire stub. Covers radian→pulse→steps conversion, per-channel
// clamping, per-channel calibration and whole-waypoint validation
// (size < 4, NaN, ±Inf).

#include <Arduino.h>
#include <Wire.h>
#include <cmath>
#include <vector>
#include "unity.h"
#include "pca9685_driver.h"
#include "servo_driver.h"

// ── Helpers ────────────────────────────────────────────────────────────────

static uint16_t off_steps_of(const WireTransaction& tx) {
    // setPWM writes: [reg, onL, onH, offL, offH]
    return static_cast<uint16_t>(tx.data[3] | (tx.data[4] << 8));
}

/// Expected PCA9685 steps for a joint value, derived from servo_config.h.
/// Tests derive expectations from the config so recalibration (physical
/// limit finding) never breaks the conversion tests.
static uint16_t expected_steps(uint8_t ch, float rad) {
    float frac = (rad - JOINT_MIN_RAD[ch]) / (JOINT_MAX_RAD[ch] - JOINT_MIN_RAD[ch]);
    float pulse_us = SERVO_PULSE_MIN_US[ch] + frac * (SERVO_PULSE_MAX_US[ch] - SERVO_PULSE_MIN_US[ch]);
    return static_cast<uint16_t>(pulse_us * PCA9685_STEPS_PER_US + 0.5f);
}

static std::vector<float> joints4(float a, float b, float c, float d) {
    std::vector<float> j;
    j.push_back(a);
    j.push_back(b);
    j.push_back(c);
    j.push_back(d);
    return j;
}

// A fresh, enabled driver pair with a clean Wire log.
static void fresh_driver(PCA9685Driver& pca, ServoDriver& servo) {
    Wire.clear();
    servo.init(pca);
    servo.set_enabled(true);
}

// ── Conversion: min / max / midpoint ──────────────────────────────────────

void test_servo_driver_min_joint_to_min_pulse() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // All channels at JOINT_MIN_RAD → their SERVO_PULSE_MIN_US (config-derived).
    servo.write(joints4(JOINT_MIN_RAD[0], JOINT_MIN_RAD[1], JOINT_MIN_RAD[2], JOINT_MIN_RAD[3]));

    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    for (size_t i = 0; i < 4; ++i) {
        TEST_ASSERT_EQUAL(expected_steps(i, JOINT_MIN_RAD[i]), off_steps_of(Wire.tx_log()[i]));
    }
}

void test_servo_driver_max_joint_to_max_pulse() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // All channels at JOINT_MAX_RAD → their SERVO_PULSE_MAX_US (config-derived).
    servo.write(joints4(JOINT_MAX_RAD[0], JOINT_MAX_RAD[1], JOINT_MAX_RAD[2], JOINT_MAX_RAD[3]));

    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    for (size_t i = 0; i < 4; ++i) {
        TEST_ASSERT_EQUAL(expected_steps(i, JOINT_MAX_RAD[i]), off_steps_of(Wire.tx_log()[i]));
    }
}

void test_servo_driver_midpoint_to_midpoint() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // Zero/mid joints map per-channel — expected values derived from config.
    servo.write(joints4(0.0f, 0.0f, 0.0f, 0.03f));

    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    TEST_ASSERT_EQUAL(expected_steps(0, 0.0f), off_steps_of(Wire.tx_log()[0]));
    TEST_ASSERT_EQUAL(expected_steps(1, 0.0f), off_steps_of(Wire.tx_log()[1]));
    TEST_ASSERT_EQUAL(expected_steps(2, 0.0f), off_steps_of(Wire.tx_log()[2]));
    TEST_ASSERT_EQUAL(expected_steps(3, 0.03f), off_steps_of(Wire.tx_log()[3]));
}

// ── Clamping ──────────────────────────────────────────────────────────────

void test_servo_driver_below_min_clamped() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // Values below JOINT_MIN_RAD are clamped to the minimum (config-derived).
    servo.write(joints4(-10.0f, -10.0f, -10.0f, -0.5f));

    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    for (size_t i = 0; i < 4; ++i) {
        TEST_ASSERT_EQUAL(expected_steps(i, JOINT_MIN_RAD[i]), off_steps_of(Wire.tx_log()[i]));
    }
}

void test_servo_driver_above_max_clamped() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // Values above JOINT_MAX_RAD are clamped to the maximum (config-derived).
    servo.write(joints4(10.0f, 10.0f, 10.0f, 0.5f));

    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    for (size_t i = 0; i < 4; ++i) {
        TEST_ASSERT_EQUAL(expected_steps(i, JOINT_MAX_RAD[i]), off_steps_of(Wire.tx_log()[i]));
    }
}

// ── Per-channel calibration ───────────────────────────────────────────────

void test_servo_driver_per_channel_calibration() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // The same joint value maps differently per channel (different ranges) —
    // expected values derived from config.
    servo.write(joints4(0.03f, 0.0f, 0.0f, 0.03f));

    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    TEST_ASSERT_EQUAL(expected_steps(0, 0.03f), off_steps_of(Wire.tx_log()[0]));
    TEST_ASSERT_EQUAL(expected_steps(3, 0.03f), off_steps_of(Wire.tx_log()[3]));
}

// ── Whole-waypoint validation ─────────────────────────────────────────────

void test_servo_driver_insufficient_joints_rejected() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // size < NUM_SERVO_CHANNELS → reject the entire waypoint (no writes).
    std::vector<float> joints = joints4(0.0f, 0.0f, 0.0f, 0.0f);
    joints.pop_back();
    joints.pop_back();
    servo.write(joints);

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

void test_servo_driver_NaN_rejected() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    // NaN anywhere → reject the entire waypoint (no writes).
    servo.write(joints4(0.0f, NAN, 0.0f, 0.0f));

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

void test_servo_driver_positive_Infinity_rejected() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    servo.write(joints4(0.0f, 0.0f, INFINITY, 0.0f));

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

void test_servo_driver_negative_Infinity_rejected() {
    PCA9685Driver pca;
    ServoDriver servo;
    fresh_driver(pca, servo);

    servo.write(joints4(0.0f, 0.0f, 0.0f, -INFINITY));

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

// NOTE: no main() here — PlatformIO links all test_*.cpp files of the
// test_protocol group into ONE binary; the Unity main() lives in test_main.cpp
// and registers every test case (including these) via RUN_TEST.
