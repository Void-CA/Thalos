// Thalos firmware — protocol/state-machine invariants tests (host, no hardware).
//
// Runs the REAL src/protocol.cpp, src/validator.cpp and src/executor.cpp
// against minimal Arduino stubs (test/test_protocol/stubs/Arduino.h) and
// asserts the wire responses and resulting states for the whole command
// lifecycle: HELLO -> MANIFEST -> SEGMENT -> SAMPLE -> END_UPLOAD -> EXECUTE
// -> STATUS -> SAMPLES.

#include <Arduino.h>
#include "protocol.h"
#include "executor.h"
#include "validator.h"
#include "unity.h"

// ── Helpers ────────────────────────────────────────────────────────────────

static std::string rtrim(const std::string& s) {
    std::size_t b = s.find_last_not_of(" \t\r\n");
    if (b == std::string::npos) {
        return "";
    }
    return s.substr(0, b + 1);
}

static std::size_t count_lines_with_prefix(const std::string& s, const char* prefix) {
    std::size_t n = 0, pos = 0;
    while (pos < s.size()) {
        std::size_t e = s.find('\n', pos);
        if (e == std::string::npos) e = s.size();
        if (s.substr(pos, e - pos).rfind(prefix, 0) == 0) {
            ++n;
        }
        pos = e + 1;
    }
    return n;
}

// Each test gets a fresh protocol/executor/validator and a clean Serial.
struct Fixture {
    Executor executor;
    Validator validator;
    Protocol protocol;

    Fixture() : protocol(executor, validator) {
        g_millis = 0;
        g_micros = 0;
        Serial.clearInput();
        Serial.clearOutput();
    }
};

// Feed one line (adds '\n'), poll once, assert the captured response.
static void send_and_expect(Fixture& f, const char* line, const char* expected) {
    Serial.clearOutput();
    Serial.feedLine(line);
    f.protocol.poll();
    TEST_ASSERT_EQUAL_STRING(expected, rtrim(Serial.output()).c_str());
}

static TimedWaypoint make_waypoint(const float joints[6], uint32_t dt_us) {
    TimedWaypoint w;
    w.joints.assign(joints, joints + 6);
    w.dt_us = dt_us;
    return w;
}

static Manifest make_valid_manifest() {
    Manifest m;
    m.metadata = ManifestMetadata{6, 3, 200000};
    ManifestSegment seg;
    seg.index = 0;
    seg.instruction = InstructionType::MOVEJ;
    seg.sample_start = 0;
    seg.sample_count = 3;
    m.segments.push_back(seg);
    const float zero[6] = {0, 0, 0, 0, 0, 0};
    const float mid[6] = {10, 20, 30, 40, 50, 60};
    const float end[6] = {20, 40, 60, 80, 100, 120};
    m.samples.push_back(make_waypoint(zero, 0));
    m.samples.push_back(make_waypoint(mid, 100000));
    m.samples.push_back(make_waypoint(end, 100000));
    return m;
}

// Drive the full upload to EXECUTING state (used by EXECUTING-scoped tests).
static void reach_executing(Fixture& f) {
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 3", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
    send_and_expect(f, "SAMPLE 1.0 1.0 1.0 0.03 0.0 0.0 100000", "OK");
    send_and_expect(f, "SAMPLE 1.5 2.0 2.0 0.05 0.0 0.0 100000", "OK");
    send_and_expect(f, "END_UPLOAD", "READY");
    send_and_expect(f, "EXECUTE", "OK");
}

// ── Tests ──────────────────────────────────────────────────────────────────

void test_hello_echoes_version_ok() {
    Fixture f;
    send_and_expect(f, "HELLO 2", "HELLO 2 OK");
    send_and_expect(f, "HELLO 42", "HELLO 42 OK");
}

void test_hello_malformed_rejected() {
    Fixture f;
    send_and_expect(f, "HELLO abc", "ERROR MALFORMED_HELLO");
}

void test_unknown_command_rejected() {
    Fixture f;
    send_and_expect(f, "FOOBAR", "ERROR UNKNOWN_COMMAND");
    // Bare keyword without the trailing space expected by startsWith().
    send_and_expect(f, "HELLO", "ERROR UNKNOWN_COMMAND");
    send_and_expect(f, "EXECUTE extra", "ERROR UNKNOWN_COMMAND");
}

void test_empty_line_ignored() {
    Fixture f;
    Serial.clearOutput();
    Serial.feedLine("");
    f.protocol.poll();
    TEST_ASSERT_TRUE(Serial.output().empty());
    send_and_expect(f, "STATUS", "STATUS IDLE");
}

void test_manifest_valid_transitions_to_receiving() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "STATUS", "STATUS RECEIVING");
}

void test_manifest_rejects_bad_arguments() {
    { Fixture f; send_and_expect(f, "MANIFEST 6 3", "ERROR MALFORMED_MANIFEST"); }
    { Fixture f; send_and_expect(f, "MANIFEST 0 3 200000", "ERROR INVALID_MANIFEST"); }
    { Fixture f; send_and_expect(f, "MANIFEST 6 3 0", "ERROR INVALID_MANIFEST"); }
}

void test_segment_outside_receiving_rejected() {
    Fixture f;
    send_and_expect(f, "SEGMENT 0 movej 0 3", "ERROR NOT_RECEIVING");
}

void test_segment_malformed_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej", "ERROR MALFORMED_SEGMENT");
}

void test_sample_outside_receiving_rejected() {
    Fixture f;
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "ERROR NOT_RECEIVING");
}

void test_sample_too_short_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SAMPLE 1", "ERROR MALFORMED_SAMPLE");
}

void test_sample_dof_mismatch_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SAMPLE 1 2 3 4 5 6", "ERROR DOF_MISMATCH");
}

void test_sample_valid_ok() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
}

void test_end_upload_without_receiving_rejected() {
    Fixture f;
    send_and_expect(f, "END_UPLOAD", "ERROR NOT_RECEIVING");
}

void test_end_upload_empty_manifest_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "END_UPLOAD", "ERROR EMPTY_MANIFEST");
}

void test_end_upload_waypoint_count_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 4 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 4", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
    send_and_expect(f, "SAMPLE 1.0 1.0 1.0 0.03 0.0 0.0 100000", "OK");
    send_and_expect(f, "SAMPLE 1.5 2.0 2.0 0.05 0.0 0.0 100000", "OK");
    send_and_expect(f, "END_UPLOAD", "ERROR WAYPOINT_COUNT");
}

void test_end_upload_segment_order_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SEGMENT 1 movej 0 3", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 3", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
    send_and_expect(f, "SAMPLE 1.0 1.0 1.0 0.03 0.0 0.0 100000", "OK");
    send_and_expect(f, "SAMPLE 1.5 2.0 2.0 0.05 0.0 0.0 100000", "OK");
    send_and_expect(f, "END_UPLOAD", "ERROR SEGMENT_ORDER");
}

void test_end_upload_segment_coverage_rejected() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    // Segment covers only [0, 2) of 3 samples -> coverage gap.
    send_and_expect(f, "SEGMENT 0 movej 0 2", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
    send_and_expect(f, "SAMPLE 1.0 1.0 1.0 0.03 0.0 0.0 100000", "OK");
    send_and_expect(f, "SAMPLE 1.5 2.0 2.0 0.05 0.0 0.0 100000", "OK");
    send_and_expect(f, "END_UPLOAD", "ERROR SEGMENT_COVERAGE");
}

void test_end_upload_timing_invalid_rejected() {
    Fixture f;
    // Declared 500000us but sample dt sums to 200000us -> 1% tolerance exceeded.
    send_and_expect(f, "MANIFEST 6 3 500000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 3", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
    send_and_expect(f, "SAMPLE 1.0 1.0 1.0 0.03 0.0 0.0 100000", "OK");
    send_and_expect(f, "SAMPLE 1.5 2.0 2.0 0.05 0.0 0.0 100000", "OK");
    send_and_expect(f, "END_UPLOAD", "ERROR TIMING_INVALID");
}

void test_validator_dof_mismatch_detected() {
    // DOF_MISMATCH is unreachable via the protocol: handle_sample() enforces
    // the exact token count (dof_count + 2), so every accepted SAMPLE has
    // exactly dof_count joints. Exercise the validator directly.
    Manifest m = make_valid_manifest();
    m.samples[0].joints.pop_back();  // 5 joints instead of 6
    Validator v;
    Validator::ValidationResult r = v.validate_manifest(m);
    TEST_ASSERT_FALSE(r.valid);
    TEST_ASSERT_EQUAL_STRING("DOF_MISMATCH", r.error_reason.c_str());
}

void test_execute_without_ready_rejected() {
    { Fixture f; send_and_expect(f, "EXECUTE", "ERROR NOT_READY"); }
    // After the error the machine sits in ERROR; a fresh MANIFEST is rejected
    // until the host recovers via STOP.
    Fixture f;
    send_and_expect(f, "EXECUTE", "ERROR NOT_READY");
    send_and_expect(f, "MANIFEST 6 3 200000", "ERROR NOT_IDLE");
    send_and_expect(f, "STOP", "OK");
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
}

void test_error_state_recovers_via_stop() {
    Fixture f;
    send_and_expect(f, "BOGUS", "ERROR UNKNOWN_COMMAND");
    send_and_expect(f, "STATUS", "STATUS ERROR UNKNOWN_COMMAND");
    send_and_expect(f, "STOP", "OK");
    send_and_expect(f, "STATUS", "STATUS IDLE");
}

void test_stop_inactive_states_rejected() {
    { Fixture f; send_and_expect(f, "STOP", "ERROR NOT_ACTIVE"); }
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "STOP", "ERROR NOT_ACTIVE");
}

void test_stop_during_executing_ok() {
    Fixture f;
    reach_executing(f);
    send_and_expect(f, "STOP", "OK");
    // reset_state() returns the protocol to IDLE after STOP.
    send_and_expect(f, "STATUS", "STATUS IDLE");
}

void test_status_running_during_execution() {
    Fixture f;
    reach_executing(f);
    // progress 0/3, first waypoint joints all 0.
    send_and_expect(f, "STATUS",
        "STATUS RUNNING 0.0000 0.000000 0.000000 0.000000 0.000000 0.000000 0.000000");
}

void test_samples_not_available_while_receiving() {
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SAMPLES 1", "ERROR NOT_AVAILABLE");
}

void test_full_happy_path_execute_complete_collect() {
    Fixture f;
    send_and_expect(f, "HELLO 2", "HELLO 2 OK");
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 3", "OK");
    send_and_expect(f, "SAMPLE 0 0 0 0 0 0 0", "OK");
    send_and_expect(f, "SAMPLE 1.0 1.0 1.0 0.03 0.0 0.0 100000", "OK");
    send_and_expect(f, "SAMPLE 1.5 2.0 2.0 0.05 0.0 0.0 100000", "OK");
    send_and_expect(f, "END_UPLOAD", "READY");
    send_and_expect(f, "STATUS", "STATUS READY");
    send_and_expect(f, "EXECUTE", "OK");

    // Fast-forward execution past all waypoints: g_micros was 0 at EXECUTE.
    f.executor.update(200000 + 1000);
    send_and_expect(f, "STATUS", "STATUS COMPLETED 3");

    // Collect the three recorded samples; responses are then cleared.
    Serial.clearOutput();
    Serial.feedLine("SAMPLES 3");
    f.protocol.poll();
    TEST_ASSERT_EQUAL(3, (int)count_lines_with_prefix(Serial.output(), "SAMPLE "));
    TEST_ASSERT_TRUE(Serial.output().rfind("OK\n", 0) == 0);
    TEST_ASSERT_EQUAL(0, (int)f.executor.samples().size());
}

void test_probe_sample_invalid_joint_token_rejected() {
    // PROBE: Arduino String::toFloat() is silent — strtod("abc") == 0.0.
    // Pre-fix, handle_sample() accepted "abc" as joint value 0.0 and replied
    // OK, silently corrupting the manifest. Fixed by validating every joint
    // token with strtof()'s end-pointer before converting.
    Fixture f;
    send_and_expect(f, "MANIFEST 6 3 200000", "OK");
    send_and_expect(f, "SEGMENT 0 movej 0 3", "OK");
    send_and_expect(f, "SAMPLE abc 0 0 0 0 0 100000", "ERROR MALFORMED_SAMPLE");
}

// ── Tests from test_pca9685.cpp (PCA9685Driver unit tests) ────────────────
void test_pca9685_begin_configures_MODE1();
void test_pca9685_begin_configures_MODE2();
void test_pca9685_begin_configures_PRESCALE();
void test_pca9685_begin_sequence_order();
void test_pca9685_begin_clears_all_channels();
void test_pca9685_setPWM_channel_0();
void test_pca9685_setPWM_channel_3();
void test_pca9685_setPWM_channel_15();
void test_pca9685_setPWM_off_greater_than_4095_constrained();
void test_pca9685_setPWM_invalid_channel_no_crash();

// ── Tests from test_servo_driver.cpp (ServoDriver unit tests) ─────────────
void test_servo_driver_min_joint_to_min_pulse();
void test_servo_driver_max_joint_to_max_pulse();
void test_servo_driver_midpoint_to_midpoint();
void test_servo_driver_below_min_rejected();
void test_servo_driver_above_max_rejected();
void test_servo_driver_per_channel_calibration();
void test_servo_driver_insufficient_joints_rejected();
void test_servo_driver_NaN_rejected();
void test_servo_driver_positive_Infinity_rejected();
void test_servo_driver_negative_Infinity_rejected();

// ── Tests from test_executor_servo.cpp (Executor+ServoDriver integration) ─
void test_executor_RUNNING_writes_servo();
void test_executor_IDLE_no_write();
void test_executor_STOP_no_new_writes();
void test_executor_ERROR_no_new_writes();
void test_executor_null_driver_no_crash();
void test_executor_disabled_driver_no_write();
void test_executor_multiple_stale_waypoints_writes_only_last();

// ── Tests from test_safety_contract.cpp (wire→actuator safety contract) ───
void test_safety_valid_measurement_command_accepts_and_executes();
void test_safety_command_at_envelope_boundary_accepts();
void test_safety_beyond_physical_safe_range_must_not_move_actuator();
void test_safety_command_beyond_envelope_rejected_with_diagnostic();
void test_safety_nan_command_rejected_at_protocol();
void test_safety_inf_command_rejected_at_protocol();
void test_safety_negative_dt_rejected();
void test_safety_zero_dt_manifest_must_not_jump_trajectory();
void test_safety_catch_up_jump_bounded_by_velocity();
void test_safety_rejected_command_leaves_actuator_unmoved_and_reported();
void test_safety_backend_manifest_out_of_envelope_must_be_rejected();
void test_safety_samples_report_commanded_not_executed_is_documented();
void test_safety_monotonic_rejection_farther_out_also_rejected();
void test_safety_accepted_command_write_bounded_within_envelope();
void test_safety_golden_path_invalid_command_rejected_end_to_end();
void test_safety_golden_path_nan_command_rejected_end_to_end();
void test_safety_golden_path_valid_command_reaches_servo_end_to_end();

// ── Entry point (native: no Arduino main, provide our own) ────────────────
//
// PlatformIO links every test_*.cpp file of the test_protocol group into ONE
// binary, so the Unity main() lives here and registers ALL test cases (the
// 27 protocol/executor tests below, the 27 driver/integration tests declared
// above — 10 PCA9685Driver + 10 ServoDriver + 7 Executor — and the 17
// safety-contract tests from test_safety_contract.cpp).

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_hello_echoes_version_ok);
    RUN_TEST(test_hello_malformed_rejected);
    RUN_TEST(test_unknown_command_rejected);
    RUN_TEST(test_empty_line_ignored);
    RUN_TEST(test_manifest_valid_transitions_to_receiving);
    RUN_TEST(test_manifest_rejects_bad_arguments);
    RUN_TEST(test_segment_outside_receiving_rejected);
    RUN_TEST(test_segment_malformed_rejected);
    RUN_TEST(test_sample_outside_receiving_rejected);
    RUN_TEST(test_sample_too_short_rejected);
    RUN_TEST(test_sample_dof_mismatch_rejected);
    RUN_TEST(test_sample_valid_ok);
    RUN_TEST(test_end_upload_without_receiving_rejected);
    RUN_TEST(test_end_upload_empty_manifest_rejected);
    RUN_TEST(test_end_upload_waypoint_count_rejected);
    RUN_TEST(test_end_upload_segment_order_rejected);
    RUN_TEST(test_end_upload_segment_coverage_rejected);
    RUN_TEST(test_end_upload_timing_invalid_rejected);
    RUN_TEST(test_validator_dof_mismatch_detected);
    RUN_TEST(test_execute_without_ready_rejected);
    RUN_TEST(test_error_state_recovers_via_stop);
    RUN_TEST(test_stop_inactive_states_rejected);
    RUN_TEST(test_stop_during_executing_ok);
    RUN_TEST(test_status_running_during_execution);
    RUN_TEST(test_samples_not_available_while_receiving);
    RUN_TEST(test_full_happy_path_execute_complete_collect);
    RUN_TEST(test_probe_sample_invalid_joint_token_rejected);
    RUN_TEST(test_pca9685_begin_configures_MODE1);
    RUN_TEST(test_pca9685_begin_configures_MODE2);
    RUN_TEST(test_pca9685_begin_configures_PRESCALE);
    RUN_TEST(test_pca9685_begin_sequence_order);
    RUN_TEST(test_pca9685_begin_clears_all_channels);
    RUN_TEST(test_pca9685_setPWM_channel_0);
    RUN_TEST(test_pca9685_setPWM_channel_3);
    RUN_TEST(test_pca9685_setPWM_channel_15);
    RUN_TEST(test_pca9685_setPWM_off_greater_than_4095_constrained);
    RUN_TEST(test_pca9685_setPWM_invalid_channel_no_crash);
    RUN_TEST(test_servo_driver_min_joint_to_min_pulse);
    RUN_TEST(test_servo_driver_max_joint_to_max_pulse);
    RUN_TEST(test_servo_driver_midpoint_to_midpoint);
    RUN_TEST(test_servo_driver_below_min_rejected);
    RUN_TEST(test_servo_driver_above_max_rejected);
    RUN_TEST(test_servo_driver_per_channel_calibration);
    RUN_TEST(test_servo_driver_insufficient_joints_rejected);
    RUN_TEST(test_servo_driver_NaN_rejected);
    RUN_TEST(test_servo_driver_positive_Infinity_rejected);
    RUN_TEST(test_servo_driver_negative_Infinity_rejected);
    RUN_TEST(test_executor_RUNNING_writes_servo);
    RUN_TEST(test_executor_IDLE_no_write);
    RUN_TEST(test_executor_STOP_no_new_writes);
    RUN_TEST(test_executor_ERROR_no_new_writes);
    RUN_TEST(test_executor_null_driver_no_crash);
    RUN_TEST(test_executor_disabled_driver_no_write);
    RUN_TEST(test_executor_multiple_stale_waypoints_writes_only_last);
    RUN_TEST(test_safety_valid_measurement_command_accepts_and_executes);
    RUN_TEST(test_safety_command_at_envelope_boundary_accepts);
    RUN_TEST(test_safety_beyond_physical_safe_range_must_not_move_actuator);
    RUN_TEST(test_safety_command_beyond_envelope_rejected_with_diagnostic);
    RUN_TEST(test_safety_nan_command_rejected_at_protocol);
    RUN_TEST(test_safety_inf_command_rejected_at_protocol);
    RUN_TEST(test_safety_negative_dt_rejected);
    RUN_TEST(test_safety_zero_dt_manifest_must_not_jump_trajectory);
    RUN_TEST(test_safety_catch_up_jump_bounded_by_velocity);
    RUN_TEST(test_safety_rejected_command_leaves_actuator_unmoved_and_reported);
    RUN_TEST(test_safety_backend_manifest_out_of_envelope_must_be_rejected);
    RUN_TEST(test_safety_samples_report_commanded_not_executed_is_documented);
    RUN_TEST(test_safety_monotonic_rejection_farther_out_also_rejected);
    RUN_TEST(test_safety_accepted_command_write_bounded_within_envelope);
    RUN_TEST(test_safety_golden_path_invalid_command_rejected_end_to_end);
    RUN_TEST(test_safety_golden_path_nan_command_rejected_end_to_end);
    RUN_TEST(test_safety_golden_path_valid_command_reaches_servo_end_to_end);
    return UNITY_END();
}
