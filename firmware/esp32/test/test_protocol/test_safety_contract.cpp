// Thalos firmware — REAL usability safety-contract tests (host, no hardware).
//
// These tests exercise the SAFE contract the firmware MUST enforce: no command
// may move an actuator beyond its declared safe envelope, rejected commands
// produce no actuator movement plus an identifiable diagnostic, and the
// firmware is the LAST BARRIER — it never silently transforms an invalid
// command into a valid one (design ADR-2, spec firmware-safety-envelope).
//
// They run the REAL src/protocol.cpp, src/validator.cpp, src/executor.cpp,
// src/servo_driver.cpp and src/pca9685_driver.cpp against the Arduino stubs
// and the Wire transaction-capture stub. The suite is written against the
// CORRECT behavior; on the pre-fix firmware (measurement mode) 10 of 12
// tests FAIL — that failure IS the evidence that the safety contract is
// violated:
//
//   - E1: widened measurement-mode clamp silently accepts beyond-mechanism
//     commands (tests 3, 4, 10, 11)
//   - E2: NaN/±Inf accepted at protocol parse (tests 5, 6)
//   - E3: negative dt_us silently wraps via toInt→uint32 (test 7)
//   - E4: dt_us==0 consumes all waypoints in one update() (test 8)
//   - E5: catch-up jump unbounded, no velocity concept (test 9)
//   - E6: silent clamp with no diagnostic; rejected commands still move the
//     actuator (tests 3, 4, 10, 12)
//   - E7: validator has no position/pulse check (test 11)
//
// Tests 1, 2 stay PASS. Test 2 was harness-corrected (M1): its sample moved
// from the measurement-mode 3.14 rad to the mechanism-safe envelope boundary
// 1.5708 rad (reject-not-clamp, ADR-2). Test 12 was harness-corrected to
// assert REJECTION (not clamp) — on pre-fix firmware it fails because 4.0 rad
// is silently clamped with an OK response.

#include <Arduino.h>
#include <cmath>
#include "protocol.h"
#include "executor.h"
#include "validator.h"
#include "servo_driver.h"
#include "pca9685_driver.h"
#include "servo_config.h"
#include "unity.h"

// ── Helpers (mirror test_main.cpp conventions) ─────────────────────────────

static std::string rtrim(const std::string& s) {
    std::size_t b = s.find_last_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    return s.substr(0, b + 1);
}

struct Fixture {
    Executor executor;
    Validator validator;
    Protocol protocol;
    PCA9685Driver pca9685;
    ServoDriver servo;

    Fixture() : protocol(executor, validator) {
        g_millis = 0;
        g_micros = 0;
        Serial.clearInput();
        Serial.clearOutput();
        Wire.clear();
        pca9685.begin();
        servo.init(pca9685);
        servo.set_enabled(true);
    }
};

static void send_and_expect(Fixture& f, const char* line, const char* expected) {
    Serial.clearOutput();
    Serial.feedLine(line);
    f.protocol.poll();
    TEST_ASSERT_EQUAL_STRING(expected, rtrim(Serial.output()).c_str());
}

// A 6-DOF manifest matching the wire protocol used by the harness (MANIFEST 6).
// The firmware hardware has 4 servo channels; channels beyond NUM_SERVO_CHANNELS are ignored by ServoDriver.
static void begin_upload_6dof(Fixture& f) {
    send_and_expect(f, "MANIFEST 6 1 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 1", "OK");
}

static float steps_for_pulse_us(float pulse_us) {
    float steps = pulse_us * PCA9685_STEPS_PER_US + 0.5f;
    if (steps < 0.0f) steps = 0.0f;
    if (steps > static_cast<float>(PCA9685_MAX_STEPS)) steps = static_cast<float>(PCA9685_MAX_STEPS);
    return steps;
}

// Expected PCA9685 steps for a commanded joint (rad) on a channel, using the
// same linear rad→pulse→steps conversion the firmware applies.
static float expected_steps(uint8_t ch, float rad) {
    float range = JOINT_MAX_RAD[ch] - JOINT_MIN_RAD[ch];
    float t = (range <= 0.0f) ? 0.0f : (rad - JOINT_MIN_RAD[ch]) / range;
    float pulse_us = SERVO_PULSE_MIN_US[ch] + t * (SERVO_PULSE_MAX_US[ch] - SERVO_PULSE_MIN_US[ch]);
    return steps_for_pulse_us(pulse_us);
}


static Manifest make_4dof_manifest(size_t count, const float wps[][4],
                                   const uint32_t dt[], uint32_t duration_us) {
    Manifest m;
    m.metadata = ManifestMetadata{4, static_cast<uint8_t>(count), duration_us};
    ManifestSegment seg;
    seg.index = 0;
    seg.instruction = InstructionType::MOVEJ;
    seg.sample_start = 0;
    seg.sample_count = count;
    m.segments.push_back(seg);
    for (size_t i = 0; i < count; ++i) {
        TimedWaypoint w;
        w.joints.assign(wps[i], wps[i] + 4);
        w.dt_us = dt[i];
        m.samples.push_back(w);
    }
    return m;
}


// Decode the last setPWM write for `channel` from the Wire stub log.
// setPWM writes [reg, onL, onH, offL, offH]; off (the steps) is bytes 3-4.
// FIXTURE FIX (M2): ServoDriver writes PHYSICAL channels (SERVO_CHANNELS[ch]
// = 15/14/13/12), so the register must be derived from the physical channel:
// reg = LED0_ON_L + SERVO_CHANNELS[channel] * 4. Decoding with the raw
// logical index (LED0_ON_L + channel * 4) misses every write — the helper
// must mirror the real driver's channel mapping or `wrote` is always false.
static bool last_pwm_steps_for(uint8_t channel, uint16_t& steps_out) {
    const auto& log = Wire.tx_log();
    for (auto it = log.rbegin(); it != log.rend(); ++it) {
        if (it->data.size() == 5) {
            uint8_t reg = it->data[0];
            uint8_t expected_reg = PCA9685_LED0_ON_L + SERVO_CHANNELS[channel] * 4;
            if (reg == expected_reg) {
                steps_out = static_cast<uint16_t>(it->data[3]) |
                            (static_cast<uint16_t>(it->data[4]) << 8);
                return true;
            }
        }
    }
    return false;
}

// ── Baseline (safe behavior the pre-fix firmware already satisfies) ─────────

void test_safety_valid_measurement_command_accepts_and_executes() {
    // A command inside the envelope parses, validates, executes; the PCA9685
    // receives the config-derived pulse for each channel.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 0.5 0.3 0.1 0.0 0.0 0.0 200000", "OK");
    send_and_expect(f, "END_UPLOAD", "READY");
    send_and_expect(f, "EXECUTE", "OK");
    f.executor.update(200000 + 1000);
    send_and_expect(f, "STATUS", "STATUS COMPLETED 1");
}

void test_safety_command_at_envelope_boundary_accepts() {
    // A command exactly at the mechanism-safe boundary (base 1.5708 rad, the
    // SAFETY_ENVELOPE max) is accepted. HARNESS CORRECTION (M1, ADR-2): the
    // pre-fix test used 3.14 rad — that was only accepted because the
    // measurement-mode clamp widened the limit to full servo travel, which is
    // BEYOND the mechanism-safe ±1.5708 rad. Under reject-not-clamp the
    // enforcement boundary is the envelope's 1.5708 rad; 3.14 rad is now
    // rejected (see test 3/4). The hazard flag below documents the mechanism
    // vs full-travel discrepancy.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 1.5708 0.3 0.1 0.0 0.0 0.0 200000", "OK");
    send_and_expect(f, "END_UPLOAD", "READY");
    send_and_expect(f, "EXECUTE", "OK");
    f.executor.update(200000 + 1000);
    send_and_expect(f, "STATUS", "STATUS COMPLETED 1");
}

// ── Safety contract (the 9 violations; pre-fix firmware FAILs these) ────────

void test_safety_beyond_physical_safe_range_must_not_move_actuator() {
    // A command beyond the mechanism's safe range must NOT move the actuator
    // to the clamped value. SAFE: base 2.5 rad must be rejected, not clamped
    // to the ±3.14 measurement-mode endpoint.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 2.5 0.3 0.1 0.0 0.0 0.0 200000", "ERROR INVALID_JOINT");
    send_and_expect(f, "STATUS", "STATUS ERROR INVALID_JOINT");
}

void test_safety_command_beyond_envelope_rejected_with_diagnostic() {
    // A command beyond the configured envelope (base 4.0 rad) is REJECTED with
    // an identifiable diagnostic — never silently clamped.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 4.0 0.3 0.1 0.0 0.0 0.0 200000", "ERROR INVALID_JOINT");
    send_and_expect(f, "STATUS", "STATUS ERROR INVALID_JOINT");
}

void test_safety_nan_command_rejected_at_protocol() {
    // NaN joint token is rejected at parse time — before the validator and
    // executor. The pre-fix strtof-only-token-consumption check accepts it.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE nan 0.3 0.1 0.0 0.0 0.0 200000", "ERROR MALFORMED_SAMPLE");
    send_and_expect(f, "STATUS", "STATUS ERROR MALFORMED_SAMPLE");
}

void test_safety_inf_command_rejected_at_protocol() {
    // ±Inf joint token (and 1e39-style overflow to Inf) rejected at parse.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE inf 0.3 0.1 0.0 0.0 0.0 200000", "ERROR MALFORMED_SAMPLE");
    send_and_expect(f, "STATUS", "STATUS ERROR MALFORMED_SAMPLE");
}

void test_safety_negative_dt_rejected() {
    // Negative dt_us must be rejected at parse (the pre-fix silent uint32 wrap
    // turns -500 into 4294966796 us and can pass the timing validator).
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 0.5 0.3 0.1 0.0 0.0 0.0 -500", "ERROR MALFORMED_SAMPLE");
    send_and_expect(f, "STATUS", "STATUS ERROR MALFORMED_SAMPLE");
}

void test_safety_zero_dt_manifest_must_not_jump_trajectory() {
    // A multi-waypoint manifest with dt_us==0 (producible by the backend's
    // degenerate manifest branch) must NOT consume all waypoints in one
    // update() — that would be an infinite-velocity jump from start to end.
    const float wps[3][4] = {
        {0.0f, 0.0f, 0.0f, 0.0f},
        {1.0f, 0.0f, 0.0f, 0.0f},
        {2.0f, 0.0f, 0.0f, 0.0f},
    };
    const uint32_t dt[3] = {0, 0, 0};   // all zero → undefined host velocity
    Manifest m = make_4dof_manifest(3, wps, dt, 0);

    // FIXTURE FIX (M2): the driver was never initialized here, so
    // ServoDriver::enabled() stayed false and NO write ever reached the Wire
    // stub — last_pwm_steps_for() found nothing and `wrote` was false. Init
    // the driver like the Fixture struct does so the write is captured.
    Executor exec;
    PCA9685Driver pca;
    pca.begin();
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    // After one update the commanded joint must be velocity-bounded (the
    // firmware controls advancement for dt_us==0), NOT the full trajectory
    // end (2.0 rad). Pre-fix this consumes every waypoint in one call.
    exec.update(1000);
    // Pre-fix: every waypoint is consumed in one update and the last stale
    // waypoint (2.0 rad) is written — the servo jumps the full trajectory.
    // Safe: the write must be velocity-bounded (well below the 2.0 rad end).
    uint16_t steps = 0;
    bool wrote = last_pwm_steps_for(0, steps);
    TEST_ASSERT_TRUE(wrote);
    TEST_ASSERT_TRUE(steps < expected_steps(0, 1.0f));
}

void test_safety_catch_up_jump_bounded_by_velocity() {
    // A delayed update() (loop stall) must NOT jump the whole remaining
    // trajectory in one write; the jump magnitude is velocity-bounded.
    const float wps[3][4] = {
        {0.0f, 0.0f, 0.0f, 0.0f},
        {0.5f, 0.0f, 0.0f, 0.0f},
        {2.0f, 0.0f, 0.0f, 0.0f},
    };
    const uint32_t dt[3] = {0, 100000, 100000};
    Manifest m = make_4dof_manifest(3, wps, dt, 200000);

    // FIXTURE FIX (M2): same as test 8 — the driver was never init/enabled,
    // so the executor never wrote and `wrote` was false.
    Executor exec;
    PCA9685Driver pca;
    pca.begin();
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    // Advance to the first waypoint, then simulate a long stall (249 ms)
    // before the next update.
    exec.update(100000);
    g_micros = 249000;
    exec.update(249000);
    // Joint 0 must be velocity-bounded (max ~0.249 rad at 1 rad/s), NOT the
    // trajectory end (2.0 rad). Pre-fix the catch-up writes the last stale
    // waypoint in one unbounded jump.
    uint16_t steps = 0;
    bool wrote = last_pwm_steps_for(0, steps);
    TEST_ASSERT_TRUE(wrote);
    // Safe: after a 249 ms stall the joint 0 advance must be velocity-bounded
    // (max ~0.249 rad at 1 rad/s → ~249/4095 steps), NOT the trajectory end
    // (2.0 rad). Pre-fix the catch-up writes the last stale waypoint (2.0).
    TEST_ASSERT_TRUE(steps < expected_steps(0, 1.0f));
}

void test_safety_rejected_command_leaves_actuator_unmoved_and_reported() {
    // A rejected command must (a) produce NO new pulse on the Wire bus and
    // (b) emit a protocol diagnostic (error state, not OK/READY).
    Fixture f;
    size_t before = Wire.tx_count();
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 4.0 0.3 0.1 0.0 0.0 0.0 200000", "ERROR INVALID_JOINT");
    send_and_expect(f, "STATUS", "STATUS ERROR INVALID_JOINT");
    TEST_ASSERT_EQUAL(before, Wire.tx_count());  // no new actuator write
}

void test_safety_backend_manifest_out_of_envelope_must_be_rejected() {
    // The validator must reject a manifest with joints outside the configured
    // envelope (whole-manifest check at END_UPLOAD).
    Fixture f;
    send_and_expect(f, "MANIFEST 6 1 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 1", "OK");
    // Drive the check through the wire: an out-of-envelope sample is rejected
    // at SAMPLE time (per-sample check) before END_UPLOAD can be reached.
    send_and_expect(f, "SAMPLE 5.0 0.3 0.1 0.0 0.0 0.0 200000", "ERROR INVALID_JOINT");
    send_and_expect(f, "STATUS", "STATUS ERROR INVALID_JOINT");
}

// ── Baseline documentation (the "what actually executed" gap) ───────────────

void test_safety_samples_report_commanded_not_executed_is_documented() {
    // HARNESS CORRECTION (M1, ADR-2): asserts REJECTION — not clamp. On the
    // pre-fix firmware a 4.0 rad command is clamped to the config endpoint
    // but the telemetry still reports 4.0: that commanded-vs-executed gap is
    // exactly WHY silent clamp is dangerous. Under the safe contract the
    // out-of-envelope command is rejected before it reaches a write, so there
    // is no "commanded-but-clamped" state to report.
    Fixture f;
    begin_upload_6dof(f);
    send_and_expect(f, "SAMPLE 4.0 0.3 0.1 0.0 0.0 0.0 200000", "ERROR INVALID_JOINT");
    send_and_expect(f, "STATUS", "STATUS ERROR INVALID_JOINT");
}

void test_safety_monotonic_rejection_farther_out_also_rejected() {
    // Property (task 2.4): Safety Is Monotonic. If a command is rejected for
    // being outside the envelope, a command FARTHER outside is rejected too.
    // Protects against limit-off-by-one and broken comparison branches —
    // safety MUST NOT become less restrictive as the violation grows.
    // Base envelope is ±1.5708 rad: the boundary value is accepted (edge of
    // acceptance, cf. test 2), 2.5 rad is rejected, and 4.0 rad (farther out)
    // is also rejected with the same diagnostic.
    Validator v;
    const std::vector<float> at_boundary = {1.5708f, 0.3f, 0.1f, 0.03f};
    const std::vector<float> beyond      = {2.5f,    0.3f, 0.1f, 0.03f};
    const std::vector<float> farther     = {4.0f,    0.3f, 0.1f, 0.03f};

    TEST_ASSERT_TRUE(v.check_physical_envelope(at_boundary).valid);
    TEST_ASSERT_FALSE(v.check_physical_envelope(beyond).valid);
    TEST_ASSERT_FALSE(v.check_physical_envelope(farther).valid);
    TEST_ASSERT_EQUAL_STRING(
        "INVALID_JOINT",
        v.check_physical_envelope(farther).error_reason.c_str());
}

void test_safety_accepted_command_write_bounded_within_envelope() {
    // Property (task 2.3, spec scenario accepted_command_stays_within_envelope):
    // Accepted Means Bounded. An ACCEPTED command must produce physical output
    // within the envelope:
    //   (a) every written pulse is within [pulse_min_us, pulse_max_us] per
    //       channel (position ∈ envelope);
    //   (b) the implied velocity (advance / elapsed) is within
    //       max_velocity_rad_per_s.
    // Distinct from tests 8/9 (which bound the DELAYED/dt==0 writes): this
    // pins the accepted-path write — the executor bounded-advance logic must
    // keep a valid command's output inside the envelope, never beyond it.
    const float wps[2][4] = {
        {0.0f, 0.0f, 0.0f, 0.03f},   // start pose (in envelope)
        {1.0f, 1.0f, 2.0f, 0.05f},   // accepted target (in envelope)
    };
    const uint32_t dt[2] = {0, 100000};
    Manifest m = make_4dof_manifest(2, wps, dt, 100000);

    Executor exec;
    PCA9685Driver pca;
    pca.begin();
    ServoDriver servo;
    servo.init(pca);
    servo.set_enabled(true);
    exec.set_servo_driver(&servo);
    exec.load(m);
    g_micros = 0;
    exec.start();
    Wire.clear();

    // One update advances from the start pose toward the target; both
    // waypoints are stale, so the write is the bounded catch-up.
    exec.update(100000);

    const float elapsed_s = 100000.0f * 1e-6f;   // same math as the executor
    for (size_t ch = 0; ch < 4; ++ch) {
        uint16_t steps = 0;
        TEST_ASSERT_TRUE(last_pwm_steps_for(static_cast<uint8_t>(ch), steps));

        // (a) position ∈ envelope: pulse within the channel's calibrated range
        //     (position_min/max_rad map linearly to pulse_min/max_us).
        TEST_ASSERT_TRUE(steps >= expected_steps(ch, SAFETY_ENVELOPE[ch].position_min_rad));
        TEST_ASSERT_TRUE(steps <= expected_steps(ch, SAFETY_ENVELOPE[ch].position_max_rad));

        // (b) velocity ≤ envelope: advance from the last-written pose is at
        //     most max_velocity × elapsed_s (bounded catch-up, ADR-3).
        const float last_written = wps[0][ch];
        const float target       = wps[1][ch];
        const float max_advance  = SAFETY_ENVELOPE[ch].max_velocity_rad_per_s * elapsed_s;
        float delta = target - last_written;
        if (std::fabs(delta) > max_advance) {
            delta = (delta > 0.0f) ? max_advance : -max_advance;
        }
        const float bounded = last_written + delta;
        TEST_ASSERT_EQUAL_UINT16(
            static_cast<uint16_t>(expected_steps(ch, bounded)), steps);
    }
}
