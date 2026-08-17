#ifndef THALOS_EXECUTOR_H
#define THALOS_EXECUTOR_H

#include <Arduino.h>
#include <vector>

// Forward declaration — Executor receives a fully-built Manifest but does
// not depend on Protocol internals.
struct Manifest;

// Forward declaration — Executor holds an optional ServoDriver (null = no
// servos, graceful degradation). Full definition lives in servo_driver.h.
class ServoDriver;

// ── Execution sample ─────────────────────────────────────────────────────

struct ExecutionSample {
    uint64_t timestamp_us;       // microseconds from execution start
    std::vector<float> joints;   // joint positions at this timestamp
};

// ── Executor class ───────────────────────────────────────────────────────
//
// Protocol-independent waypoint stepper. Receives a validated manifest,
// steps through timed waypoints using micros() as time authority, and
// records execution samples.
//
// ── Velocity-bounding + dt_us==0 PROTOCOL SEMANTICS (ADR-3, Correction D) ─
//
// The PHYSICAL write is velocity-bounded per update:
//     max_advance[ch] = SAFETY_ENVELOPE[ch].max_velocity_rad_per_s
//                       × elapsed_since_last_write
// The arm advances by at most max_advance from its last-written position —
// never by a full trajectory jump, no matter how stale the waypoints are.
//
// dt_us == 0 is a PROTOCOL CONTRACT, not an implementation detail: when a
// waypoint carries dt_us == 0, physical velocity v = Δq/Δt is UNDEFINED
// (Δt = 0). The firmware MUST NOT infer host velocity from the commanded
// delta. The firmware controls advancement:
//   - at most ONE zero-dt waypoint is consumed per update() call, so a
//     degenerate all-zero-dt manifest is never consumed in a single update
//     (that would be an infinite-velocity jump from start to end);
//   - the physical write advances by at most max_velocity × elapsed real
//     time since the last write.
//
// Telemetry is preserved: EVERY commanded waypoint is recorded in samples()
// (recorded BEFORE the write); only the bounded physical write is limited.

class Executor {
public:
    Executor();

    /// Load a validated manifest. Must be called before start().
    void load(const Manifest& manifest);

    /// Start execution. Must be called once after load().
    void start();

    /// Must be called frequently from loop(). Steps through waypoints
    /// by elapsed time from start.
    void update(unsigned long now_us);

    /// Whether execution is complete.
    bool is_complete() const;

    /// Progress as fraction 0.0–1.0. With firmware-side repeat (count in the
    /// MANIFEST) this is the OVERALL fraction across ALL passes — the host's
    /// completion gate fires only at the true end (fraction 1.0).
    float progress() const;

    /// Current commanded joint positions (the waypoint currently being
    /// stepped). Empty when not RUNNING or past the last sample (S2.1).
    std::vector<float> current_joints() const;

    enum State : uint8_t { IDLE, RUNNING, DONE };

    State current_state() const;

    /// Get recorded samples since last clear.
    const std::vector<ExecutionSample>& samples() const;

    /// Number of VALID recorded samples (== the retained last pass for
    /// firmware-side repeat, <= capacity). Always <= samples().size().
    size_t sample_count() const;

    /// Clear recorded samples after host has collected them.
    void clear_samples();

    /// Stop execution immediately.
    void stop();

    /// Inject servo driver (optional — null = no servos, graceful
    /// degradation). Called by main.cpp after the boot-time I2C probe.
    void set_servo_driver(ServoDriver* servo_driver);

private:
    const Manifest* manifest_ptr_;
    size_t current_sample_index_;
    unsigned long start_time_us_;       // micros() at start() (or pass reset)
    unsigned long last_write_time_us_;  // micros() at last successful physical write
    unsigned long target_time_us_;      // cumulative time for current waypoint
    unsigned long recorded_sample_count_;
    std::vector<float> current_position_;   // last physically-written joint positions
    // Bounding the execution trace: the firmware is NOT the historical store of
    // an arbitrarily large execution. recorded_samples_ has FIXED capacity (one
    // pass, set at load()) and reuse the same storage across firmware-repeat
    // passes — only the LAST pass is retained. Avoids the OOM/fragmentation of
    // accumulating repeat_count × waypoints in memory (1228 × 5 = 6140).
    std::vector<ExecutionSample> recorded_samples_;
    size_t recorded_capacity_;      // fixed slots, set at load()
    size_t recorded_next_;          // next free slot / valid count (<= capacity)
    ServoDriver* servo_driver_;
    State exec_state_;

    // ── Firmware-side repeat (count in MANIFEST) ─────────────────────────
    // The executor loops the trajectory `repeat_total_` times back-to-back —
    // NO host re-upload between passes. Each pass boundary resets exactly like
    // `start()` (index/target/start_time, current_position_ = samples[0]) so
    // the physical per-pass motion is identical to the old host re-execute;
    // the velocity bound keeps the return move safe. Sample timestamps stay
    // MONOTONIC across passes via `sample_time_base_us_` so the single NF3
    // trace is not corrupted.
    unsigned long repeat_total_;
    unsigned long passes_done_;          // completed passes (for progress())
    unsigned long sample_time_base_us_;  // accumulated pass durations (monotonic samples)
    unsigned long pass_duration_us_;     // total dt_us of ONE pass (computed at load)

    void step_to(unsigned long now_us);
    void record_sample(unsigned long timestamp_us, const std::vector<float>& joints);
};

#endif // THALOS_EXECUTOR_H
