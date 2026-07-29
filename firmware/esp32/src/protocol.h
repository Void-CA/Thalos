#ifndef THALOS_PROTOCOL_H
#define THALOS_PROTOCOL_H

#include <Arduino.h>
#include <vector>
#include <cstring>

// Forward declarations
class Executor;
class Validator;

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
    Executor& executor_;
    Validator& validator_;

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

    // ── Helpers ───────────────────────────────────────────────────────

    void send_response(const String& msg);
    void set_error(const String& reason);
    void reset_state();
};

#endif // THALOS_PROTOCOL_H
