// Thalos firmware — Executor + ServoDriver integration tests (host, no HW).
//
// Exercises the real src/executor.cpp against the real ServoDriver and Wire
// stub. Covers: servo writes while RUNNING, no writes in IDLE / after STOP /
// after protocol ERROR, null and disabled driver degradation, and the
// catch-up policy (ALL waypoints recorded, only the last stale one written).

#include <Arduino.h>
#include <Wire.h>
#include <cmath>
#include <string>
#include <vector>
#include "unity.h"
#include "protocol.h"
#include "executor.h"
#include "validator.h"
#include "pca9685_driver.h"
#include "servo_driver.h"

// ── Helpers ────────────────────────────────────────────────────────────────

static std::string rtrim(const std::string& s) {
    std::size_t b = s.find_last_not_of(" \t\r\n");
    if (b == std::string::npos) {
        return "";
    }
    return s.substr(0, b + 1);
}

static uint16_t off_steps_of(const WireTransaction& tx) {
    // setPWM writes: [reg, onL, onH, offL, offH]
    return static_cast<uint16_t>(tx.data[3] | (tx.data[4] << 8));
}

/// Expected PCA9685 steps for a joint value, derived from servo_config.h
/// (recalibration-proof conversion expectation).
static uint16_t expected_steps(uint8_t ch, float rad) {
    float frac = (rad - JOINT_MIN_RAD[ch]) / (JOINT_MAX_RAD[ch] - JOINT_MIN_RAD[ch]);
    float pulse_us = SERVO_PULSE_MIN_US[ch] + frac * (SERVO_PULSE_MAX_US[ch] - SERVO_PULSE_MIN_US[ch]);
    return static_cast<uint16_t>(pulse_us * PCA9685_STEPS_PER_US + 0.5f);
}

static TimedWaypoint make_wp(const float joints[4], uint32_t dt_us) {
    TimedWaypoint w;
    w.joints.assign(joints, joints + 4);
    w.dt_us = dt_us;
    return w;
}

static Manifest make_4dof_manifest(size_t count, const float wps[][4],
                                   const uint32_t dt_us[], uint32_t duration_us) {
    Manifest m;
    m.metadata = ManifestMetadata{4, count, duration_us};
    ManifestSegment seg;
    seg.index = 0;
    seg.instruction = InstructionType::MOVEJ;
    seg.sample_start = 0;
    seg.sample_count = count;
    m.segments.push_back(seg);
    for (size_t i = 0; i < count; ++i) {
        m.samples.push_back(make_wp(wps[i], dt_us[i]));
    }
    return m;
}

// Single waypoint at t=0: all mid-range joints ({0,0,0,0.03} → 307 steps).
static Manifest mid_manifest() {
    const float wps[1][4] = {{0.0f, 0.0f, 0.0f, 0.03f}};
    const uint32_t dt[1] = {0};
    return make_4dof_manifest(1, wps, dt, 0);
}

static void send_and_expect(Protocol& protocol, const char* line, const char* expected) {
    Serial.clearOutput();
    Serial.feedLine(line);
    protocol.poll();
    TEST_ASSERT_EQUAL_STRING(expected, rtrim(Serial.output()).c_str());
}

// ── RUNNING: servos are written ───────────────────────────────────────────

void test_executor_RUNNING_writes_servo() {
    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    Manifest m = mid_manifest();
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    exec.update(1000);   // RUNNING: wp0 at t=0 is reached

    TEST_ASSERT_EQUAL(1, (int)exec.samples().size());
    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    // wp0 joints {0, 0, 0, 0.03} → per-channel steps derived from config.
    TEST_ASSERT_EQUAL(expected_steps(0, 0.0f), off_steps_of(Wire.tx_log()[0]));
    TEST_ASSERT_EQUAL(expected_steps(1, 0.0f), off_steps_of(Wire.tx_log()[1]));
    TEST_ASSERT_EQUAL(expected_steps(2, 0.0f), off_steps_of(Wire.tx_log()[2]));
    TEST_ASSERT_EQUAL(expected_steps(3, 0.03f), off_steps_of(Wire.tx_log()[3]));
}

// ── No energization outside RUNNING ───────────────────────────────────────

void test_executor_IDLE_no_write() {
    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    Manifest m = mid_manifest();
    exec.load(m);          // never started → IDLE
    Wire.clear();

    exec.update(5000);

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

void test_executor_STOP_no_new_writes() {
    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    Manifest m = mid_manifest();
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    exec.update(1000);     // writes happen while RUNNING
    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());

    exec.stop();           // STOP → hold-last-position (no release, no writes)
    Wire.clear();
    exec.update(5000);     // would write again if still RUNNING

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

void test_executor_ERROR_no_new_writes() {
    // Protocol-level ERROR during EXECUTING must halt servo writes
    // (spec: "Error during execution" → servos hold last commanded position).
    Executor exec;
    Validator validator;
    Protocol protocol(exec, validator);
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    g_micros = 0;
    Wire.clear();
    Serial.clearInput();
    Serial.clearOutput();

    send_and_expect(protocol, "MANIFEST 4 3 200000", "OK");
    send_and_expect(protocol, "SEGMENT 0 movej 0 3", "OK");
    send_and_expect(protocol, "SAMPLE 0 0 0 0.03 0", "OK");
    // HARNESS CORRECTION (M1, ADR-2): the samples were literals written for
    // the pre-fix measurement mode. The old elbow value (-2.09 rad) is
    // outside the URDF SAFETY_ENVELOPE [0, 2.0944] and would now be rejected
    // at the SAMPLE line (per-sample enforcement), before the test could
    // exercise its real subject: protocol ERROR during EXECUTING halting
    // writes. These in-envelope values keep that intent unchanged.
    send_and_expect(protocol, "SAMPLE -1.57 0.5 -3.14 0.03 100000", "OK");
    send_and_expect(protocol, "SAMPLE 1.57 2.0 3.14 0.05 100000", "OK");
    send_and_expect(protocol, "END_UPLOAD", "READY");
    send_and_expect(protocol, "EXECUTE", "OK");

    // First update writes wp0 while RUNNING.
    exec.update(1000);
    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    size_t writes_before_error = Wire.tx_count();

    // Unknown command during EXECUTING → protocol ERROR → executor must stop.
    Serial.clearOutput();
    Serial.feedLine("BOGUS");
    protocol.poll();
    TEST_ASSERT_EQUAL_STRING("ERROR UNKNOWN_COMMAND", rtrim(Serial.output()).c_str());

    // More time passes — an executor still RUNNING would write wp1/wp2.
    exec.update(300000);
    TEST_ASSERT_EQUAL(writes_before_error, (int)Wire.tx_count());
}

// ── Degradation: null / disabled driver ───────────────────────────────────

void test_executor_null_driver_no_crash() {
    Executor exec;
    // servo_driver_ stays nullptr (never injected) — graceful degradation.
    Manifest m = mid_manifest();
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    exec.update(1000);

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
    TEST_ASSERT_EQUAL(1, (int)exec.samples().size());   // recording still works
}

void test_executor_disabled_driver_no_write() {
    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;      // never init/set_enabled → enabled() == false
    exec.set_servo_driver(&servo);

    Manifest m = mid_manifest();
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    exec.update(1000);

    TEST_ASSERT_EQUAL(0, (int)Wire.tx_count());
}

// ── Catch-up policy ───────────────────────────────────────────────────────

void test_executor_multiple_stale_waypoints_writes_only_last() {
    // wp0: mid joints, wp1: all mins, wp2: all maxes (limits from config).
    const float wps[3][4] = {
        {0.0f, 0.0f, 0.0f, 0.03f},
        {JOINT_MIN_RAD[0], JOINT_MIN_RAD[1], JOINT_MIN_RAD[2], JOINT_MIN_RAD[3]},
        {JOINT_MAX_RAD[0], JOINT_MAX_RAD[1], JOINT_MAX_RAD[2], JOINT_MAX_RAD[3]},
    };
    const uint32_t dt[3] = {0, 100000, 100000};
    Manifest m = make_4dof_manifest(3, wps, dt, 200000);

    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    // Single big delay: all three waypoints are stale at once.
    exec.update(250000);

    // (a) LOGICAL — ALL waypoints are recorded (wire contract: samples =
    //     the values commanded by the plan, for post-execution analysis).
    TEST_ASSERT_EQUAL(3, (int)exec.samples().size());
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, exec.samples()[0].joints[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, JOINT_MIN_RAD[0], exec.samples()[1].joints[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, JOINT_MAX_RAD[0], exec.samples()[2].joints[0]);

    // (b) PHYSICAL — CONTRACT CORRECTION (M2, ADR-3): the write TARGET is
    //     still the last stale waypoint (wp2 — catch-up policy preserved),
    //     but the physical write is VELOCITY-BOUNDED. Pre-fix this asserted
    //     the full wp2 jump (JOINT_MAX_RAD) after the 250 ms stall — exactly
    //     the unbounded catch-up the safety contract forbids. Now each
    //     channel advances at most max_velocity × elapsed (250 ms → base
    //     0.25 rad at 1 rad/s) from the last-written pose (wp0), never the
    //     full 1.5708 rad teleport to wp2.
    TEST_ASSERT_EQUAL(4, (int)Wire.tx_count());
    const float elapsed_s = 250000.0f * 1e-6f;   // same math as the executor
    for (size_t i = 0; i < 4; ++i) {
        const float last_written = wps[0][i];   // wp0 pose was physically written at t=0
        const float target      = JOINT_MAX_RAD[i];   // wp2 = last stale waypoint
        const float max_advance = SAFETY_ENVELOPE[i].max_velocity_rad_per_s * elapsed_s;
        float delta = target - last_written;
        if (std::fabs(delta) > max_advance) {
            delta = (delta > 0.0f) ? max_advance : -max_advance;
        }
        TEST_ASSERT_EQUAL(expected_steps(i, last_written + delta),
                          off_steps_of(Wire.tx_log()[i]));
    }
}

// NOTE: no main() here — PlatformIO links all test_*.cpp files of the
// test_protocol group into ONE binary; the Unity main() lives in test_main.cpp
// and registers every test case (including these) via RUN_TEST.
