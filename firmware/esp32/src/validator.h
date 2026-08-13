#ifndef THALOS_VALIDATOR_H
#define THALOS_VALIDATOR_H

#include <Arduino.h>
#include "protocol.h"

class Validator {
public:
    struct ValidationResult {
        bool valid;
        String error_reason;
    };

    /// Validate a fully-built manifest.
    /// Checks DOF count, sample count, segment ordering, segment coverage,
    /// timing integrity, and physical envelope (INVALID_JOINT).
    ValidationResult validate_manifest(const Manifest& manifest);

    /// Per-waypoint physical-envelope check against SAFETY_ENVELOPE (the
    /// execution enforcement authority, ADR-1/ADR-2). Rejects — never clamps.
    /// Checks only the first NUM_SERVO_CHANNELS joints: channels beyond the
    /// hardware are ignored by ServoDriver and never actuated.
    static ValidationResult check_physical_envelope(const std::vector<float>& joints);

private:
    bool check_dof_count(const Manifest& m);
    bool check_sample_count(const Manifest& m);
    bool check_segments_ordered(const Manifest& m);
    bool check_segments_cover_all_samples(const Manifest& m);
    bool check_timing_integrity(const Manifest& m);
    bool check_manifest_envelope(const Manifest& m);
};

#endif // THALOS_VALIDATOR_H
