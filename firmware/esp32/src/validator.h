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
    /// and timing integrity.
    ValidationResult validate_manifest(const Manifest& manifest);

private:
    bool check_dof_count(const Manifest& m);
    bool check_sample_count(const Manifest& m);
    bool check_segments_ordered(const Manifest& m);
    bool check_segments_cover_all_samples(const Manifest& m);
    bool check_timing_integrity(const Manifest& m);
};

#endif // THALOS_VALIDATOR_H
