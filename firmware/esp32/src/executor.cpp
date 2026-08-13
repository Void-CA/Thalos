#include "executor.h"
#include "protocol.h"   // for Manifest definition
#include "servo_config.h"   // for SAFETY_ENVELOPE / NUM_SERVO_CHANNELS
#include "servo_driver.h"   // for write()/enabled() during physical actuation

#include <algorithm>
#include <cmath>

// ── Velocity-bounding constants (ADR-3) ───────────────────────────────────
// Maximum elapsed real time (µs) the velocity bound may use. Defensive clamp
// against 32-bit micros() wrap: unsigned subtraction is defined across wrap,
// but a stale/corrupted `last_write_time_us_` could otherwise read as a huge
// elapsed, making max_advance huge enough to defeat the bound and allow a
// full-trajectory catch-up. Clamping to 1 h keeps the bound meaningful;
// ServoDriver's defensive envelope rejection remains the final backstop.

static constexpr unsigned long MAX_ADVANCE_ELAPSED_US = 3600000000UL;   // 1 h

// ── Constructor ──────────────────────────────────────────────────────────

Executor::Executor()
    : manifest_ptr_(nullptr)
    , current_sample_index_(0)
    , start_time_us_(0)
    , last_write_time_us_(0)
    , target_time_us_(0)
    , recorded_sample_count_(0)
    , current_position_()
    , servo_driver_(nullptr)
    , exec_state_(IDLE)
{
}

// ── Lifecycle ────────────────────────────────────────────────────────────

void Executor::load(const Manifest& manifest) {
    manifest_ptr_         = &manifest;
    current_sample_index_ = 0;
    exec_state_           = IDLE;
    recorded_samples_.clear();
}

void Executor::start() {
    if (manifest_ptr_ == nullptr) {
        return;   // load() was never called — should not happen when driven by Protocol
    }

    start_time_us_     = micros();
    last_write_time_us_ = micros();
    target_time_us_    = 0;           // first waypoint is at t=0
    current_sample_index_ = 0;
    recorded_sample_count_ = 0;
    // current_position_ = the first waypoint's pose (the arm is commanded
    // there at t=0): the first physical write is a no-op move, never a jump.
    current_position_.clear();
    if (!manifest_ptr_->samples.empty()) {
        const size_t n = std::min(manifest_ptr_->samples[0].joints.size(),
                                  static_cast<size_t>(NUM_SERVO_CHANNELS));
        current_position_.assign(manifest_ptr_->samples[0].joints.begin(),
                                 manifest_ptr_->samples[0].joints.begin() + n);
    }
    exec_state_        = RUNNING;
}

void Executor::stop() {
    exec_state_ = IDLE;
}

void Executor::set_servo_driver(ServoDriver* servo_driver) {
    servo_driver_ = servo_driver;
}

void Executor::update(unsigned long now_us) {
    if (exec_state_ != RUNNING) {
        return;
    }
    step_to(now_us);
}

// ── Query ────────────────────────────────────────────────────────────────

bool Executor::is_complete() const {
    return exec_state_ == DONE;
}

float Executor::progress() const {
    if (manifest_ptr_ == nullptr || manifest_ptr_->samples.empty()) {
        return 0.0f;
    }
    return static_cast<float>(current_sample_index_)
         / static_cast<float>(manifest_ptr_->samples.size());
}

Executor::State Executor::current_state() const {
    return exec_state_;
}

std::vector<float> Executor::current_joints() const {
    if (exec_state_ != RUNNING || manifest_ptr_ == nullptr ||
        current_sample_index_ >= manifest_ptr_->samples.size()) {
        return {};
    }
    return manifest_ptr_->samples[current_sample_index_].joints;
}

const std::vector<ExecutionSample>& Executor::samples() const {
    return recorded_samples_;
}

void Executor::clear_samples() {
    recorded_samples_.clear();
    std::vector<ExecutionSample>().swap(recorded_samples_);
}

// ── Internal stepping logic ──────────────────────────────────────────────
//
// Two independent concerns (ADR-3, spec "Executor Velocity-Bounding" and
// "dt_us==0 Protocol Semantics"):
//
//  1. Consumption/telemetry — every waypoint whose target time has been
//     reached is RECORDED in samples() (commanded plan, for post-execution
//     analysis). This happens BEFORE the write and is never limited, except
//     by the zero-dt guard below.
//
//  2. Physical actuation — the write target is the LAST stale waypoint
//     (existing catch-up policy), but the per-channel advance from the last
//     written position is capped at max_velocity × elapsed_since_last_write.
//     A delayed update() can therefore never teleport the arm to a far
//     waypoint: catch-up is velocity-bounded.

void Executor::step_to(unsigned long now_us) {
    // ── 1. Advancement budget since the last physical write ─────────────
    // Unsigned subtraction is defined across 32-bit micros() wrap (~71 min),
    // but clamp defensively so a stale timestamp can never inflate the
    // budget into a full-trajectory catch-up (see MAX_ADVANCE_ELAPSED_US).
    unsigned long elapsed = now_us - last_write_time_us_;
    if (elapsed > MAX_ADVANCE_ELAPSED_US) {
        elapsed = MAX_ADVANCE_ELAPSED_US;
    }
    float max_advance[NUM_SERVO_CHANNELS];
    for (size_t ch = 0; ch < NUM_SERVO_CHANNELS; ++ch) {
        max_advance[ch] = SAFETY_ENVELOPE[ch].max_velocity_rad_per_s
                        * static_cast<float>(elapsed) * 1e-6f;
    }

    // ── 2. Waypoint consumption (telemetry, recorded BEFORE the write) ──
    const unsigned long elapsed_from_start = now_us - start_time_us_;
    const TimedWaypoint* last_stale_wp = nullptr;
    // dt_us==0 PROTOCOL SEMANTICS: waypoints sharing one timestamp must not
    // all be consumed in a single update — that reads the whole zero-dt chain
    // as simultaneous, i.e. an INFINITE host velocity. The firmware controls
    // advancement: at most one zero-dt waypoint per update() call, so a
    // degenerate all-zero-dt manifest is stepped one waypoint at a time.
    bool zero_dt_chain = false;

    while (current_sample_index_ < manifest_ptr_->samples.size()) {
        if (elapsed_from_start < target_time_us_) {
            break;
        }
        if (zero_dt_chain) {
            break;
        }
        const TimedWaypoint& wp = manifest_ptr_->samples[current_sample_index_];
        record_sample(target_time_us_, wp.joints);
        last_stale_wp = &wp;

        current_sample_index_++;
        if (current_sample_index_ < manifest_ptr_->samples.size()) {
            // Advance target time by THIS waypoint's dt: a dt_us==0 waypoint
            // leaves the next target unchanged, which arms the zero-dt guard.
            target_time_us_ += manifest_ptr_->samples[current_sample_index_].dt_us;
            zero_dt_chain = (manifest_ptr_->samples[current_sample_index_].dt_us == 0);
        }
    }

    // ── 3. Physical actuation — velocity-bounded catch-up (ADR-3) ────────
    // The write target is the LAST stale waypoint (existing policy), but the
    // per-channel advance from current_position_ is capped at max_advance.
    // Only a successful driver write updates current_position_ and the write
    // clock; a rejected write leaves both untouched so the next update
    // retries with the same time base (defensive backstop, never a clamp).
    if (last_stale_wp != nullptr &&
        servo_driver_ != nullptr &&
        servo_driver_->enabled()) {
        std::vector<float> bounded = current_position_;
        const size_t n = std::min(last_stale_wp->joints.size(),
                                  static_cast<size_t>(NUM_SERVO_CHANNELS));
        for (size_t ch = 0; ch < n; ++ch) {
            float delta = last_stale_wp->joints[ch] - bounded[ch];
            if (std::abs(delta) > max_advance[ch]) {
                delta = (delta > 0.0f) ? max_advance[ch] : -max_advance[ch];
            }
            bounded[ch] += delta;
        }
        if (servo_driver_->write(bounded)) {
            current_position_  = bounded;
            last_write_time_us_ = now_us;
        }
    }

    // Check for completion.
    if (current_sample_index_ >= manifest_ptr_->samples.size()) {
        exec_state_ = DONE;
    }
}

void Executor::record_sample(unsigned long timestamp_us, const std::vector<float>& joints) {
    ExecutionSample sample;
    sample.timestamp_us = static_cast<uint64_t>(timestamp_us);
    sample.joints       = joints;
    recorded_samples_.push_back(sample);
}
