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
    m.metadata = ManifestMetadata{4, count, duration_us, 1};
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

/// Manifest with a firmware-side repeat count (v3: MANIFEST 5th field).
static Manifest make_4dof_manifest_repeat(size_t count, const float wps[][4],
                                          const uint32_t dt_us[], uint32_t duration_us,
                                          unsigned long repeat) {
    Manifest m = make_4dof_manifest(count, wps, dt_us, duration_us);
    m.metadata.repeat_count = repeat;
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

// ── Firmware-side repeat (v3: `count` in MANIFEST) ────────────────────────

/// The executor loops the trajectory `repeat_count` times back-to-back with NO
/// host re-upload: completion only after the LAST pass, sample timestamps
/// monotonic (single NF3 trace), overall progress 1.0 only at the true end.
/// The pass boundary resets exactly like start() (model reset — the first
/// write of the next pass is a no-op move, never a jump).
void test_executor_repeat_loops_passes_back_to_back() {
    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    // 3 waypoints over 300000 µs; repeat 2 → total 600000 µs.
    const float wps[3][4] = {{0.0f, 0.0f, 0.0f, 0.03f},
                             {0.5f, 0.3f, 0.2f, 0.03f},
                             {1.0f, 0.6f, 0.4f, 0.03f}};
    const uint32_t dt[3] = {0, 150000, 150000};
    Manifest m = make_4dof_manifest_repeat(3, wps, dt, 300000, 2);

    exec.load(m);
    g_micros = 0;
    exec.start();

    // Mid-pass 1: running, overall progress ≈ (0 + 1/3)/2 = 1/6.
    exec.update(100000);
    TEST_ASSERT_FALSE(exec.is_complete());
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f / 6.0f, exec.progress());

    // End of pass 1 (t=300000): the executor LOOPS — not complete.
    exec.update(300000);
    TEST_ASSERT_FALSE(exec.is_complete());

    // Mid-pass 2: overall progress ≈ (1 + 1/3)/2 = 2/3.
    exec.update(400000);
    TEST_ASSERT_FALSE(exec.is_complete());
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 2.0f / 3.0f, exec.progress());

    // End of pass 2 (t=600000): complete, overall progress 1.0.
    exec.update(600000);
    TEST_ASSERT_TRUE(exec.is_complete());
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, exec.progress());

    // Single monotonic trace, BOUNDED to the LAST pass: the firmware retains
    // only the final iteration (trace_scope = last_iteration) so the buffer
    // never grows to repeat_count × waypoints (the 1228 × 5 = 6140 OOM).
    // Pass 2 timestamps are offset by the accumulated pass durations: the
    // retained samples are the LAST pass's, so slots [0,3) hold 300000,450000,
    // 600000. `samples()` (full fixed storage) is larger; `sample_count()` is
    // the authoritative valid length.
    const auto& samples = exec.samples();
    TEST_ASSERT_EQUAL(3, (int)exec.sample_count());
    TEST_ASSERT_EQUAL(300000UL, samples[0].timestamp_us);
    TEST_ASSERT_EQUAL(450000UL, samples[1].timestamp_us);
    TEST_ASSERT_EQUAL(600000UL, samples[2].timestamp_us);
}

// ── Regression: bounded trace across firmware-repeat (repeat × waypoints OOM) ─

/// Repeat(count=5, waypoints=1228): the recorded trace must be BOUNDED to one
/// pass (no count × waypoints accumulation in the ESP32 heap) while `count`
/// itself is fully executed. Proves:
///   - completion only after 5 passes,
///   - sample_count == one pass (<= capacity),
///   - no unbounded growth: the full storage stays at capacity (one pass),
///     never grows to 5 × waypoints.
void test_repeat_bounded_trace_no_heap_growth_across_passes() {
    Executor exec;
    PCA9685Driver pca;
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);

    const size_t WPS = 1228;
    // Build a 1228-waypoint manifest THE RIGHT WAY (sample i holds joints
    // derived from i): the manifest builder itself is not part of this test.
    Manifest m;
    m.metadata = ManifestMetadata{4, WPS, 10000, 1};
    m.metadata.repeat_count = 5;
    ManifestSegment seg;
    seg.index = 0;
    seg.instruction = InstructionType::MOVEJ;
    seg.sample_start = 0;
    seg.sample_count = WPS;
    m.segments.push_back(seg);
    for (size_t i = 0; i < WPS; ++i) {
        TimedWaypoint wp;
        wp.joints = {0.0f, 0.0f, 0.0f, 0.03f};
        wp.dt_us = (i == 0) ? 0 : 10;
        m.samples.push_back(wp);
    }

    exec.load(m);
    g_micros = 0;
    exec.start();

    // 1227 gaps × 10 µs = 12270 µs per pass. Advance a full pass duration per
    // iteration so the executor reaches the pass boundary each step.
    const uint32_t pass_us = (uint32_t)((WPS - 1) * 10u);
    for (unsigned pass = 0; pass < 5; ++pass) {
        exec.update((pass + 1) * pass_us);
        // Passes 1..4 loop (never complete); only pass 5 reaches DONE.
        // pass indexes 0..3 must report NOT complete; pass 4 must complete.
        TEST_ASSERT_EQUAL(pass >= 4, exec.is_complete());
    }
    TEST_ASSERT_TRUE(exec.is_complete());
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 1.0f, exec.progress());

    // Bounded retention: exactly ONE pass worth of samples (the last pass,
    // all 1228 of them), never count × waypoints (5 × 1228 = 6140). The
    // authoritative trace length is sample_count() and must be <= capacity.
    TEST_ASSERT_EQUAL((int)WPS, (int)exec.sample_count());
    // The full storage stays exactly at one pass — no growth across passes.
    TEST_ASSERT_EQUAL((int)WPS, (int)exec.samples().size());
    TEST_ASSERT_TRUE(exec.sample_count() <= exec.samples().size());
}

// NOTE: no main() here — PlatformIO links all test_*.cpp files of the
// test_protocol group into ONE binary; the Unity main() lives in test_main.cpp
// and registers every test case (including these) via RUN_TEST.
