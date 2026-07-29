#include "validator.h"

// ── Public validate ──────────────────────────────────────────────────────

Validator::ValidationResult Validator::validate_manifest(const Manifest& manifest) {
    // 1. Non-empty
    if (manifest.samples.empty()) {
        return {false, F("EMPTY_MANIFEST")};
    }

    // 2. DOF consistency across all samples
    if (!check_dof_count(manifest)) {
        return {false, F("DOF_MISMATCH")};
    }

    // 3. Sample count matches metadata
    if (!check_sample_count(manifest)) {
        return {false, F("WAYPOINT_COUNT")};
    }

    // 4. Segments are in ascending index order
    if (!check_segments_ordered(manifest)) {
        return {false, F("SEGMENT_ORDER")};
    }

    // 5. Segments collectively cover all samples without gaps
    if (!check_segments_cover_all_samples(manifest)) {
        return {false, F("SEGMENT_COVERAGE")};
    }

    // 6. Timing integrity
    if (!check_timing_integrity(manifest)) {
        return {false, F("TIMING_INVALID")};
    }

    return {true, String()};
}

// ── Private checks ──────────────────────────────────────────────────────

bool Validator::check_dof_count(const Manifest& m) {
    for (const auto& sample : m.samples) {
        if (sample.joints.size() != static_cast<size_t>(m.metadata.dof_count)) {
            return false;
        }
    }
    return true;
}

bool Validator::check_sample_count(const Manifest& m) {
    return m.samples.size() == m.metadata.total_samples;
}

bool Validator::check_segments_ordered(const Manifest& m) {
    for (size_t i = 1; i < m.segments.size(); ++i) {
        if (m.segments[i].index <= m.segments[i - 1].index) {
            return false;
        }
    }
    return true;
}

bool Validator::check_segments_cover_all_samples(const Manifest& m) {
    // Segments must cover [0, total_samples) without overlap.
    // Reconstruct coverage as a simple bitmap would be overkill.
    // Instead: track next expected sample index.

    size_t next = 0;
    for (const auto& seg : m.segments) {
        // No overlap: segment start must equal or exceed current position.
        if (seg.sample_start > next) {
            return false;   // gap
        }
        // Update next expected position.
        size_t seg_end = seg.sample_start + seg.sample_count;
        if (seg_end > next) {
            next = seg_end;
        }
    }

    // All samples must be covered.
    return next == m.metadata.total_samples;
}

bool Validator::check_timing_integrity(const Manifest& m) {
    // First sample must have dt_us = 0 (start of execution).
    if (m.samples.empty()) {
        return true;
    }

    // All dt_us values should be non-negative (they are uint32_t, always >= 0).
    // No overflow in total duration.
    uint64_t accumulated = 0;
    for (const auto& sample : m.samples) {
        accumulated += static_cast<uint64_t>(sample.dt_us);
    }

    // Total accumulated time should roughly match declared duration.
    // Allow a small tolerance (1%) for floating-point rounding during planning.
    uint64_t declared = m.metadata.duration_us;
    uint64_t diff = (accumulated > declared) ? (accumulated - declared) : (declared - accumulated);

    // Tolerance: 1% of declared duration, minimum 1000 µs.
    uint64_t tolerance = (declared / 100) > 1000 ? (declared / 100) : 1000;

    if (diff > tolerance) {
        return false;
    }

    return true;
}
