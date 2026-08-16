#ifndef THALOS_PROTOCOL_H
#define THALOS_PROTOCOL_H

#include <Arduino.h>
#include <vector>
#include <cstring>

// Forward declarations
class Executor;
class Validator;
class PCA9685Driver;

// ── Protocol version ─────────────────────────────────────────────────────
//
// v2 (C): chunked upload ACK — the host sends batches of SAMPLE lines and the
// firmware answers ONE `OK` per chunk (declared in the MANIFEST line) instead
// of one per line. `handle_hello` validates the version so a stale v1 host
// fails the handshake BEFORE a 92KB upload starts (never mid-upload).
// v1 hosts sent `MANIFEST <dof> <N> <dur_us>` (no chunk) → chunk defaults to 1
// (ACK per line), preserving the v1 wire behavior against the v2 firmware.
#define THALOS_PROTOCOL_VERSION 2

// ── Instruction type ──────────────────────────────────────────────────────

enum class InstructionType : uint8_t {
    MOVEJ,
    MOVEL,
    UNKNOWN
};

// ── Manifest data structures ─────────────────────────────────────────────

struct ManifestMetadata {
    uint8_t dof_count;
    size_t total_samples;
    uint64_t duration_us;
};

struct ManifestSegment {
    uint8_t index;
    InstructionType instruction;
    size_t sample_start;
    size_t sample_count;
};

struct TimedWaypoint {
    std::vector<float> joints;
    uint32_t dt_us;       // microseconds since previous waypoint
};

struct Manifest {
    ManifestMetadata metadata;
    std::vector<ManifestSegment> segments;
    std::vector<TimedWaypoint> samples;
};

// ── Protocol class ───────────────────────────────────────────────────────
//
// Text command parser, response formatter, and state machine.
// Owns the protocol state and partially-built manifest during RECEIVING.

class Protocol {
public:
    Protocol(Executor& executor, Validator& validator);

    /// Poll the serial port: check executor completion, read one command,
    /// process it, write response.
    void poll();

    /// Inject the raw PWM driver (calibration-only, RAW_PULSE command).
    /// Called by main.cpp after the boot-time I2C probe — null (probe failed
    /// or not injected) makes RAW_PULSE answer `ERROR NO_DRIVER`.
    void set_pca9685(PCA9685Driver* driver);

private:
    enum State : uint8_t {
        IDLE,
        RECEIVING,
        READY,
        EXECUTING,
        COMPLETED,
        ERROR
    };

    State state_;
    String error_reason_;

    Manifest manifest_;         // partially built during RECEIVING
    /// Chunked-ACK batch size (v2, from the MANIFEST line; default 1 = ACK per
    /// line). The host derives it from the DOF so a full chunk fits the RX
    /// buffer with margin (chunk × max_line ≤ 3072 < RX_BUFFER 4096).
    size_t chunk_size_;
    /// Samples received since the last chunk ACK (v2).
    size_t samples_since_ack_;
    Executor& executor_;
    Validator& validator_;
    /// Raw PWM driver for the calibration-only RAW_PULSE command. Bypasses
    /// the rad↔pulse map AND the envelope on purpose: calibration measures the
    /// servo's REAL pulse range, which the mapped path cannot reach beyond
    /// the configured envelope. Calibration tool requires a decoupled servo.
    PCA9685Driver* pca9685_;

    // ── Command handlers ──────────────────────────────────────────────

    void handle_hello(const String& line);
    void handle_manifest(const String& line);
    void handle_segment(const String& line);
    void handle_sample(const String& line);
    void handle_end_upload();
    void handle_execute();
    void handle_stop();
    void handle_status();
    void handle_samples(const String& line);
    void handle_raw_pulse(const String& line);

    // ── Helpers ───────────────────────────────────────────────────────

    void send_response(const String& msg);
    void set_error(const String& reason);
    void reset_state();
};

#endif // THALOS_PROTOCOL_H
