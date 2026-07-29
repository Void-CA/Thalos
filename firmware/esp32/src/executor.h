#ifndef THALOS_EXECUTOR_H
#define THALOS_EXECUTOR_H

#include <Arduino.h>
#include <vector>

// Forward declaration — Executor receives a fully-built Manifest but does
// not depend on Protocol internals.
struct Manifest;

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

    /// Progress as fraction 0.0–1.0.
    float progress() const;

    enum State : uint8_t { IDLE, RUNNING, DONE };

    State current_state() const;

    /// Get recorded samples since last clear.
    const std::vector<ExecutionSample>& samples() const;

    /// Clear recorded samples after host has collected them.
    void clear_samples();

    /// Stop execution immediately.
    void stop();

private:
    const Manifest* manifest_ptr_;
    size_t current_sample_index_;
    unsigned long start_time_us_;       // micros() at start()
    unsigned long target_time_us_;      // cumulative time for current waypoint
    unsigned long recorded_sample_count_;
    std::vector<ExecutionSample> recorded_samples_;
    State exec_state_;

    void step_to(unsigned long now_us);
    void record_sample(unsigned long timestamp_us, const std::vector<float>& joints);
};

#endif // THALOS_EXECUTOR_H
