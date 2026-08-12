#include "executor.h"
#include "protocol.h"   // for Manifest definition
#include "servo_driver.h"   // for write()/enabled() during physical actuation

// ── Constructor ──────────────────────────────────────────────────────────

Executor::Executor()
    : manifest_ptr_(nullptr)
    , current_sample_index_(0)
    , start_time_us_(0)
    , target_time_us_(0)
    , recorded_sample_count_(0)
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
    target_time_us_    = 0;           // first waypoint is at t=0
    current_sample_index_ = 0;
    recorded_sample_count_ = 0;
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

void Executor::step_to(unsigned long now_us) {
    unsigned long elapsed = now_us - start_time_us_;

    // Track the last stale waypoint for physical actuation (catch-up policy:
    // ALL waypoints are recorded; only the last stale one is written).
    const TimedWaypoint* last_stale_wp = nullptr;

    // Step through all waypoints whose target time has been reached.
    while (current_sample_index_ < manifest_ptr_->samples.size()) {
        if (elapsed >= target_time_us_) {
            const TimedWaypoint& wp = manifest_ptr_->samples[current_sample_index_];
            record_sample(target_time_us_, wp.joints);
            last_stale_wp = &wp;

            current_sample_index_++;

            if (current_sample_index_ < manifest_ptr_->samples.size()) {
                // Advance target time by this waypoint's dt.
                target_time_us_ += manifest_ptr_->samples[current_sample_index_].dt_us;
            }
        } else {
            break;
        }
    }

    // Physical actuation: write ONLY the last stale waypoint (skip
    // intermediates — they were never physically reached).
    if (last_stale_wp != nullptr &&
        servo_driver_ != nullptr &&
        servo_driver_->enabled()) {
        servo_driver_->write(last_stale_wp->joints);
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
