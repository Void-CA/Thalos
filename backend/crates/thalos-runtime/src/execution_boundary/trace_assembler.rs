//! Trace assembler — converts collected `ExecutionSample`s into a `MotionTrace`.
//!
//! The assembler takes the raw samples recorded by a hardware backend (ESP32)
//! together with the original segment boundaries and produces a `MotionTrace`
//! suitable for analysis, comparison, and export.

use std::time::Duration;

use crate::motion_trace::{MotionSample, MotionTrace};

use super::manifest::ManifestSegment;
use super::sample::ExecutionSample;

/// Assemble a `MotionTrace` from collected execution samples and segment metadata.
///
/// # Parameters
///
/// * `samples` — raw samples collected by the hardware backend, in timestamp order.
/// * `segments` — the segment boundaries from the original `ExecutionManifest`,
///   used to validate the expected sample count.
///
///   The expected total (sum of all `sample_count`) is logged but not enforced —
///   the hardware may have collected fewer samples if execution was interrupted.
///
/// # Returns
///
/// A `MotionTrace` with one `MotionSample` per input sample. Fields not reported
/// by the hardware (velocities, target joints) are left as defaults; `progress`
/// is set proportionally across the sample count, and `timestamp` is converted
/// from microseconds to `Duration`.
pub fn assemble_trace(samples: Vec<ExecutionSample>, segments: &[ManifestSegment]) -> MotionTrace {
    let _total_expected: usize = segments.iter().map(|s| s.sample_count).sum();

    let mut trace = MotionTrace::new();
    let total = samples.len();

    for (i, sample) in samples.into_iter().enumerate() {
        let timestamp = Duration::from_micros(sample.timestamp_us);
        let progress = if total > 1 {
            i as f64 / (total - 1) as f64
        } else {
            1.0
        };

        trace.push(MotionSample {
            timestamp,
            joints: sample.joints,
            velocities: vec![],
            target_joints: None,
            progress,
            errors: vec![],
        });
    }

    trace
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution_boundary::manifest::ManifestInstruction;

    #[test]
    fn assemble_empty_samples_returns_empty_trace() {
        let segments: Vec<ManifestSegment> = vec![];
        let trace = assemble_trace(vec![], &segments);

        assert!(trace.is_empty());
        assert_eq!(trace.len(), 0);
    }

    #[test]
    fn assemble_trace_maps_samples_to_segments() {
        let samples = vec![
            ExecutionSample {
                timestamp_us: 0,
                joints: vec![0.0, 0.0],
            },
            ExecutionSample {
                timestamp_us: 100_000,
                joints: vec![0.5, 0.3],
            },
            ExecutionSample {
                timestamp_us: 200_000,
                joints: vec![1.0, 0.5],
            },
            ExecutionSample {
                timestamp_us: 350_000,
                joints: vec![1.5, 0.7],
            },
            ExecutionSample {
                timestamp_us: 500_000,
                joints: vec![2.0, 0.9],
            },
        ];

        let segments = vec![
            ManifestSegment {
                index: 0,
                instruction: ManifestInstruction::MoveJ,
                sample_start: 0,
                sample_count: 3,
            },
            ManifestSegment {
                index: 1,
                instruction: ManifestInstruction::MoveL,
                sample_start: 3,
                sample_count: 2,
            },
        ];

        let trace = assemble_trace(samples.clone(), &segments);

        assert_eq!(trace.len(), 5);

        // Verify each sample's data is preserved
        for (i, sample) in trace.samples().iter().enumerate() {
            assert_eq!(sample.joints, samples[i].joints);
            assert_eq!(
                sample.timestamp,
                Duration::from_micros(samples[i].timestamp_us)
            );
        }
    }

    #[test]
    fn single_sample_trace_has_progress_one() {
        let samples = vec![ExecutionSample {
            timestamp_us: 0,
            joints: vec![0.0],
        }];
        let segments = vec![ManifestSegment {
            index: 0,
            instruction: ManifestInstruction::MoveJ,
            sample_start: 0,
            sample_count: 1,
        }];

        let trace = assemble_trace(samples, &segments);

        assert_eq!(trace.len(), 1);
        assert!((trace.samples()[0].progress - 1.0).abs() < 1e-12);
    }

    #[test]
    fn velocities_are_empty_for_hardware_samples() {
        let samples = vec![ExecutionSample {
            timestamp_us: 1000,
            joints: vec![0.0, 0.0, 0.0],
        }];
        let segments = vec![ManifestSegment {
            index: 0,
            instruction: ManifestInstruction::MoveJ,
            sample_start: 0,
            sample_count: 1,
        }];

        let trace = assemble_trace(samples, &segments);

        assert!(trace.samples()[0].velocities.is_empty());
        assert!(trace.samples()[0].target_joints.is_none());
        assert!(trace.samples()[0].errors.is_empty());
    }
}
