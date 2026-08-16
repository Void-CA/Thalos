#include "protocol.h"
#include "executor.h"
#include "validator.h"
#include "pca9685_driver.h"
#include "servo_hw_config.h"

#include <cstdlib>
#include <cerrno>
#include <cmath>

// ── Constructor ──────────────────────────────────────────────────────────

Protocol::Protocol(Executor& executor, Validator& validator)
    : state_(IDLE)
    , chunk_size_(1)
    , samples_since_ack_(0)
    , executor_(executor)
    , validator_(validator)
    , pca9685_(nullptr)
{
}

void Protocol::set_pca9685(PCA9685Driver* driver) {
    pca9685_ = driver;
}

// ── Poll (main dispatch) ─────────────────────────────────────────────────

void Protocol::poll() {
    // Check if execution completed since last poll.
    if (state_ == EXECUTING && executor_.is_complete()) {
        state_ = COMPLETED;
    }

    if (Serial.available() == 0) {
        return;
    }

    String line = Serial.readStringUntil('\n');
    line.trim();

    if (line.length() == 0) {
        return;
    }

    // ── Command dispatch ──────────────────────────────────────────────

    if (line.startsWith(F("HELLO "))) {
        handle_hello(line);
    } else if (line.startsWith(F("MANIFEST "))) {
        handle_manifest(line);
    } else if (line.startsWith(F("SEGMENT "))) {
        handle_segment(line);
    } else if (line.startsWith(F("SAMPLE "))) {
        handle_sample(line);
    } else if (line.equals(F("END_UPLOAD"))) {
        handle_end_upload();
    } else if (line.equals(F("EXECUTE"))) {
        handle_execute();
    } else if (line.equals(F("STOP"))) {
        handle_stop();
    } else if (line.equals(F("STATUS"))) {
        handle_status();
    } else if (line.startsWith(F("SAMPLES "))) {
        handle_samples(line);
    } else if (line.startsWith(F("RAW_PULSE "))) {
        handle_raw_pulse(line);
    } else {
        set_error(F("UNKNOWN_COMMAND"));
    }
}

// ── Command handlers ────────────────────────────────────────────────────

void Protocol::handle_hello(const String& line) {
    int version;
    if (sscanf(line.c_str(), "HELLO %d", &version) != 1) {
        set_error(F("MALFORMED_HELLO"));
        return;
    }

    // v2 (C): validate the version BEFORE any upload traffic — a stale v1
    // host must fail the handshake cleanly, not discover the incompatibility
    // mid-upload (after transmitting ~92KB).
    if (version != THALOS_PROTOCOL_VERSION) {
        set_error(F("VERSION_MISMATCH"));
        return;
    }

    // Echo the version back to confirm.
    char response[32];
    snprintf(response, sizeof(response), "HELLO %d OK", version);
    send_response(String(response));
}

void Protocol::handle_manifest(const String& line) {
    if (state_ != IDLE && state_ != COMPLETED) {
        set_error(F("NOT_IDLE"));
        return;
    }

    int dof = 0;
    int total = 0;
    int chunk = 1;
    unsigned long dur = 0;

    // v2 (C): optional 4th field = chunked-ACK batch size. v1 MANIFEST lines
    // (3 fields) default to 1 → ACK per line (legacy wire behavior).
    int parsed = sscanf(line.c_str(), "MANIFEST %d %d %lu %d", &dof, &total, &dur, &chunk);
    if (parsed < 3) {
        set_error(F("MALFORMED_MANIFEST"));
        return;
    }

    if (dof <= 0 || total <= 0 || dur == 0 || chunk <= 0) {
        set_error(F("INVALID_MANIFEST"));
        return;
    }

    manifest_.metadata.dof_count     = static_cast<uint8_t>(dof);
    manifest_.metadata.total_samples = static_cast<size_t>(total);
    manifest_.metadata.duration_us   = static_cast<uint64_t>(dur);
    manifest_.segments.clear();
    manifest_.samples.clear();
    manifest_.samples.reserve(static_cast<size_t>(total));

    chunk_size_       = static_cast<size_t>(chunk);
    samples_since_ack_ = 0;

    state_ = RECEIVING;
    send_response(F("OK"));
}

void Protocol::handle_segment(const String& line) {
    if (state_ != RECEIVING) {
        set_error(F("NOT_RECEIVING"));
        return;
    }

    int idx = 0, start = 0, count = 0;
    char inst[16] = {0};

    if (sscanf(line.c_str(), "SEGMENT %d %15s %d %d", &idx, inst, &start, &count) != 4) {
        set_error(F("MALFORMED_SEGMENT"));
        return;
    }

    ManifestSegment seg;
    seg.index        = static_cast<uint8_t>(idx);
    seg.sample_start = static_cast<size_t>(start);
    seg.sample_count = static_cast<size_t>(count);

    if (strcmp(inst, "movej") == 0) {
        seg.instruction = InstructionType::MOVEJ;
    } else if (strcmp(inst, "movel") == 0) {
        seg.instruction = InstructionType::MOVEL;
    } else {
        seg.instruction = InstructionType::UNKNOWN;
    }

    manifest_.segments.push_back(seg);
    send_response(F("OK"));
}

void Protocol::handle_sample(const String& line) {
    if (state_ != RECEIVING) {
        set_error(F("NOT_RECEIVING"));
        return;
    }

    // Parse SAMPLE <j0> <j1> ... <jN> <dt_us>
    // Tokenize the line after "SAMPLE ".
    char buf[256];
    line.toCharArray(buf, sizeof(buf));

    // Collect all tokens into a vector.
    std::vector<String> tokens;
    char* saveptr = nullptr;
    char* token   = strtok_r(buf, " ", &saveptr);

    while (token != nullptr) {
        tokens.push_back(String(token));
        token = strtok_r(nullptr, " ", &saveptr);
    }

    // Minimum: SAMPLE + 1 joint + dt = 3 tokens
    if (tokens.size() < 3) {
        set_error(F("MALFORMED_SAMPLE"));
        return;
    }

    // Expected: "SAMPLE" + DOF joints + dt = 2 + dof_count
    // First token is always "SAMPLE", last is dt_us, middle are joints.
    size_t expected_tokens = static_cast<size_t>(manifest_.metadata.dof_count) + 2;

    if (tokens.size() != expected_tokens) {
        set_error(F("DOF_MISMATCH"));
        return;
    }

    TimedWaypoint wp;
    for (size_t i = 1; i < tokens.size() - 1; ++i) {
        const char* tok = tokens[i].c_str();
        char* end = nullptr;
        errno = 0;
        // Arduino String::toFloat() is SILENT: garbage like "abc" parses to
        // 0.0, silently corrupting the manifest. Reject non-numeric joint
        // tokens instead of accepting 0.0 (full-token consumption check).
        float value = strtof(tok, &end);
        if (end == tok || *end != '\0' ||
            !std::isfinite(value) || errno == ERANGE) {
            // NaN / ±Inf / overflow ("1e39" → +Inf via ERANGE) are rejected
            // at PARSE time (design ADR-4, spec firmware-safety-envelope) —
            // before the validator or executor ever sees them.
            set_error(F("MALFORMED_SAMPLE"));
            return;
        }
        wp.joints.push_back(value);
    }

    // dt_us: parse as SIGNED first. A negative dt must be rejected BEFORE the
    // uint32_t cast — the pre-fix toInt()→cast silently wrapped -500 into
    // 4294966796 us and could pass the timing validator (ADR-4). Same
    // MALFORMED_SAMPLE code as the other parse failures (spec test 7).
    {
        const char* tok = tokens[tokens.size() - 1].c_str();
        char* end = nullptr;
        errno = 0;
        long dt = strtol(tok, &end, 10);
        if (end == tok || *end != '\0' || errno == ERANGE || dt < 0) {
            set_error(F("MALFORMED_SAMPLE"));
            return;
        }
        wp.dt_us = static_cast<uint32_t>(dt);
    }

    // Per-sample physical-envelope enforcement (ADR-2): an out-of-envelope
    // joint is rejected IMMEDIATELY at the SAMPLE line with INVALID_JOINT —
    // it never enters the manifest and no actuator ever sees it.
    Validator::ValidationResult envelope = validator_.check_physical_envelope(wp.joints);
    if (!envelope.valid) {
        set_error(envelope.error_reason);
        return;
    }

    manifest_.samples.push_back(wp);

    // v2 (C): chunked ACK — respond once per `chunk_size_` samples instead of
    // per line. Validation errors above still respond immediately; a chunk
    // boundary responds OK (flow control for the host's next batch).
    ++samples_since_ack_;
    if (samples_since_ack_ >= chunk_size_) {
        samples_since_ack_ = 0;
        send_response(F("OK"));
    }
}

void Protocol::handle_end_upload() {
    if (state_ != RECEIVING) {
        set_error(F("NOT_RECEIVING"));
        return;
    }

    Validator::ValidationResult result = validator_.validate_manifest(manifest_);

    if (result.valid) {
        executor_.load(manifest_);
        state_ = READY;
        send_response(F("READY"));
    } else {
        set_error(result.error_reason);
    }
}

void Protocol::handle_execute() {
    if (state_ != READY) {
        set_error(F("NOT_READY"));
        return;
    }

    executor_.start();
    state_ = EXECUTING;
    send_response(F("OK"));
}

void Protocol::handle_stop() {
    // STOP is valid from READY, EXECUTING, COMPLETED, or ERROR.
    if (state_ == IDLE || state_ == RECEIVING) {
        set_error(F("NOT_ACTIVE"));
        return;
    }

    executor_.stop();
    reset_state();
    send_response(F("OK"));
}

void Protocol::handle_status() {
    String response = F("STATUS ");

    switch (state_) {
        case IDLE:
            response += F("IDLE");
            break;
        case RECEIVING:
            response += F("RECEIVING");
            break;
        case READY:
            response += F("READY");
            break;
        case EXECUTING: {
            // S2.2: `STATUS RUNNING <progress> <j0> <j1> ... <jN>` — progress
            // fraction plus commanded joints so the host can render live
            // progress and positions. Wire token stays RUNNING (never EXECUTING).
            response += F("RUNNING ");
            response += String(executor_.progress(), 4);
            const std::vector<float>& joints = executor_.current_joints();
            for (size_t i = 0; i < joints.size(); ++i) {
                response += ' ';
                response += String(joints[i], 6);
            }
            break;
        }
        case COMPLETED:
            // S3.1: `STATUS COMPLETED <count>` — lets the host know how many
            // recorded samples to request via `SAMPLES <count>`.
            response += F("COMPLETED ");
            response += String(executor_.samples().size());
            break;
        case ERROR:
            response += F("ERROR ");
            response += error_reason_;
            break;
    }

    send_response(response);
}

void Protocol::handle_samples(const String& line) {
    // SAMPLES is valid from IDLE or COMPLETED (execution finished).
    if (state_ != IDLE && state_ != COMPLETED && state_ != READY) {
        set_error(F("NOT_AVAILABLE"));
        return;
    }

    int count = 0;
    if (sscanf(line.c_str(), "SAMPLES %d", &count) != 1 || count <= 0) {
        set_error(F("MALFORMED"));
        return;
    }

    const std::vector<ExecutionSample>& samples = executor_.samples();
    size_t available = samples.size();
    size_t to_send   = (static_cast<size_t>(count) < available)
                           ? static_cast<size_t>(count)
                           : available;

    send_response(F("OK"));

    for (size_t i = 0; i < to_send; ++i) {
        String sample_line = F("SAMPLE ");
        sample_line += String(samples[i].timestamp_us);

        for (size_t j = 0; j < samples[i].joints.size(); ++j) {
            sample_line += ' ';
            sample_line += String(samples[i].joints[j], 6);
        }

        Serial.println(sample_line);
    }

    // Clear samples after successful collection to free RAM.
    executor_.clear_samples();
}

// ── RAW_PULSE (calibration-only) ────────────────────────────────────────
//
// Commands the PCA9685 DIRECTLY with a raw pulse width (µs), bypassing the
// rad↔pulse map AND the envelope. Purpose: the calibration tool measures the
// servo's REAL pulse range — the mapped path cannot reach beyond the
// configured envelope, so a map-driven calibration can never discover the
// true endpoints (it extrapolates a stale map and hits the envelope wall).
//
// SAFETY: this command deliberately bypasses the envelope. It is intended
// for bench calibration ONLY (decoupled servo, per tools/calibrate.py). The
// calibration tool drives it; normal execution never uses it.
void Protocol::handle_raw_pulse(const String& line) {
    if (pca9685_ == nullptr) {
        set_error(F("NO_DRIVER"));
        return;
    }

    int channel = -1;
    long pulse_us = 0;
    if (sscanf(line.c_str(), "RAW_PULSE %d %ld", &channel, &pulse_us) != 2) {
        set_error(F("MALFORMED_RAW_PULSE"));
        return;
    }
    if (channel < 0 || channel > 15) {
        set_error(F("BAD_CHANNEL"));
        return;
    }
    // Sane pulse bounds: 0..20ms period. Negative/absurd values are a caller
    // error — refuse instead of saturating blindly.
    if (pulse_us < 0 || pulse_us > 20000) {
        set_error(F("BAD_PULSE"));
        return;
    }

    float steps_f = pulse_us * PCA9685_STEPS_PER_US;
    uint16_t steps = static_cast<uint16_t>(steps_f);
    if (steps > PCA9685_MAX_STEPS) {
        steps = PCA9685_MAX_STEPS;
    }
    pca9685_->setPWM(static_cast<uint8_t>(channel), 0, steps);
    send_response(F("OK"));
}

// ── Internal helpers ────────────────────────────────────────────────────

void Protocol::send_response(const String& msg) {
    Serial.println(msg);
    Serial.flush();
}

void Protocol::set_error(const String& reason) {
    // Spec: "Error during execution" → halt servo writes. If an error
    // arrives while EXECUTING, stop the executor so no further waypoints
    // are commanded; the PCA9685 holds the last PWM output (hold-last).
    if (state_ == EXECUTING) {
        executor_.stop();
    }

    error_reason_ = reason;
    state_ = ERROR;

    String response = F("ERROR ");
    response += reason;
    send_response(response);
}

void Protocol::reset_state() {
    state_ = IDLE;
    error_reason_ = String();
    manifest_.metadata = ManifestMetadata{0, 0, 0};
    manifest_.segments.clear();
    manifest_.samples.clear();
    // Free underlying memory (embedded — be frugal).
    std::vector<ManifestSegment>().swap(manifest_.segments);
    std::vector<TimedWaypoint>().swap(manifest_.samples);
    chunk_size_ = 1;
    samples_since_ack_ = 0;
}
