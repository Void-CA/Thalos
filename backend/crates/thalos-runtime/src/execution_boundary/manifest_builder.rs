//! `ExecutionManifestBuilder` — constructs an `ExecutionManifest` from an `ExecutionPlan`.
//!
//! The builder converts the plan's per-segment relative-timed samples into a flat
//! sequence of `TimedWaypoint`s with absolute delta timing, ready for hardware upload.

use thalos_planning::motion::execution::{ExecutionPlan, ExecutionSegment};

use super::manifest::{
    ExecutionManifest, ManifestInstruction, ManifestMetadata, ManifestSegment, TimedWaypoint,
};

/// Errors that can occur when building an `ExecutionManifest`.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ManifestError {
    /// The plan contains no trajectory waypoints (all segments are Pause or Output).
    #[error("plan contains no trajectory waypoints")]
    EmptyPlan,

    /// The number of samples in the manifest does not match metadata.
    #[error("sample count mismatch: metadata says {expected}, samples has {actual}")]
    SampleCountMismatch { expected: usize, actual: usize },

    /// Segments are not in strictly ascending index order.
    #[error("segments are not in ascending index order")]
    SegmentsNotOrdered,

    /// A segment's sample range overlaps with the previous segment.
    #[error(
        "segment overlap: index {index} starts at sample {start} but previous ends at {prev_end}"
    )]
    SegmentOverlap {
        index: usize,
        start: usize,
        prev_end: usize,
    },

    /// The last segment does not cover all samples.
    #[error("last segment ends at sample {end}, but total samples is {total}")]
    SegmentCoverage { end: usize, total: usize },
}

/// Builder that constructs an `ExecutionManifest` from an `ExecutionPlan`.
///
/// # Invariants (verified after construction)
///
/// - `samples.len() == metadata.total_samples`
/// - Segments are in strictly ascending index order
/// - No segment overlap
/// - The last segment covers all samples
pub struct ExecutionManifestBuilder;

impl ExecutionManifestBuilder {
    /// Build an `ExecutionManifest` from an `ExecutionPlan`.
    ///
    /// Converts each trajectory segment's relative-timed samples into a flat
    /// sequence of `TimedWaypoint`s with delta timing. Non-trajectory segments
    /// (Pause, Output) advance the cumulative clock but produce no waypoints.
    ///
    /// # Errors
    ///
    /// Returns `ManifestError::EmptyPlan` if the plan has no trajectory waypoints.
    /// Returns other `ManifestError` variants if post-construction invariant checks
    /// fail (defense-in-depth — the builder should always produce a valid manifest).
    pub fn from_plan(plan: &ExecutionPlan) -> Result<ExecutionManifest, ManifestError> {
        let dof_count = Self::detect_dof(plan);

        let mut samples: Vec<TimedWaypoint> = Vec::new();
        let mut manifest_segments: Vec<ManifestSegment> = Vec::new();
        let mut cumulative_offset_us: u64 = 0;
        // Tracks the global timestamp (µs from plan start) of the most recently
        // added waypoint. `None` when no waypoints have been added yet.
        let mut prev_global_time_us: Option<u64> = None;

        for (index, segment) in plan.segments.iter().enumerate() {
            match segment {
                ExecutionSegment::JointTrajectory {
                    samples: seg_samples,
                } => {
                    if seg_samples.is_empty() {
                        continue;
                    }

                    let sample_start = samples.len();

                    for seg_sample in seg_samples {
                        let global_time_us =
                            cumulative_offset_us + seg_sample.time.as_micros() as u64;

                        let dt_us = match prev_global_time_us {
                            None => 0,
                            Some(prev) => {
                                (global_time_us.saturating_sub(prev)).min(u32::MAX as u64) as u32
                            }
                        };

                        samples.push(TimedWaypoint {
                            joints: seg_sample.joints.clone(),
                            dt_us,
                        });
                        prev_global_time_us = Some(global_time_us);
                    }

                    manifest_segments.push(ManifestSegment {
                        index,
                        instruction: ManifestInstruction::MoveJ,
                        sample_start,
                        sample_count: seg_samples.len(),
                    });

                    // Advance cumulative offset by this segment's duration
                    if let Some(last) = seg_samples.last() {
                        cumulative_offset_us += last.time.as_micros() as u64;
                    }
                }

                ExecutionSegment::CartesianTrajectory {
                    samples: seg_samples,
                    resolved,
                } => {
                    if seg_samples.is_empty() {
                        continue;
                    }

                    let sample_start = samples.len();

                    // CartesianTrajectory guarantees samples.len() == resolved.len()
                    for (seg_sample, joints) in seg_samples.iter().zip(resolved.iter()) {
                        let global_time_us =
                            cumulative_offset_us + seg_sample.time.as_micros() as u64;

                        let dt_us = match prev_global_time_us {
                            None => 0,
                            Some(prev) => {
                                (global_time_us.saturating_sub(prev)).min(u32::MAX as u64) as u32
                            }
                        };

                        samples.push(TimedWaypoint {
                            joints: joints.clone(),
                            dt_us,
                        });
                        prev_global_time_us = Some(global_time_us);
                    }

                    manifest_segments.push(ManifestSegment {
                        index,
                        instruction: ManifestInstruction::MoveL,
                        sample_start,
                        sample_count: seg_samples.len(),
                    });

                    if let Some(last) = seg_samples.last() {
                        cumulative_offset_us += last.time.as_micros() as u64;
                    }
                }

                // Non-trajectory segments: advance the clock but add no waypoints.
                ExecutionSegment::Pause { duration } => {
                    cumulative_offset_us += duration.as_micros() as u64;
                }
                ExecutionSegment::Output { at_time, .. } => {
                    cumulative_offset_us += at_time.as_micros() as u64;
                }
            }
        }

        if samples.is_empty() {
            return Err(ManifestError::EmptyPlan);
        }

        let total_samples = samples.len();

        let manifest = ExecutionManifest {
            metadata: ManifestMetadata {
                dof_count,
                total_samples,
                duration_us: cumulative_offset_us,
            },
            segments: manifest_segments,
            samples,
        };

        Self::check_invariants(&manifest)?;

        Ok(manifest)
    }

    /// Detect the DOF count from the first trajectory segment in the plan.
    fn detect_dof(plan: &ExecutionPlan) -> usize {
        plan.segments
            .iter()
            .find_map(|seg| match seg {
                ExecutionSegment::JointTrajectory { samples } => {
                    samples.first().map(|s| s.joints.len())
                }
                ExecutionSegment::CartesianTrajectory { resolved, .. } => {
                    resolved.first().map(|j| j.len())
                }
                _ => None,
            })
            .unwrap_or(0)
    }

    /// Verify post-construction invariants on a completed manifest.
    ///
    /// Returns `Ok(())` if all checks pass. Returns the first failing
    /// `ManifestError` otherwise.
    fn check_invariants(manifest: &ExecutionManifest) -> Result<(), ManifestError> {
        // 1. sample count matches metadata
        if manifest.samples.len() != manifest.metadata.total_samples {
            return Err(ManifestError::SampleCountMismatch {
                expected: manifest.metadata.total_samples,
                actual: manifest.samples.len(),
            });
        }

        // 2. segments are in strictly ascending index order
        for window in manifest.segments.windows(2) {
            if window[0].index >= window[1].index {
                return Err(ManifestError::SegmentsNotOrdered);
            }
        }

        // 3. no segment overlap
        for window in manifest.segments.windows(2) {
            let prev_end = window[0].sample_start + window[0].sample_count;
            if window[1].sample_start < prev_end {
                return Err(ManifestError::SegmentOverlap {
                    index: window[1].index,
                    start: window[1].sample_start,
                    prev_end,
                });
            }
        }

        // 4. last segment covers all samples
        if let Some(last) = manifest.segments.last() {
            let end = last.sample_start + last.sample_count;
            if end != manifest.metadata.total_samples {
                return Err(ManifestError::SegmentCoverage {
                    end,
                    total: manifest.metadata.total_samples,
                });
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use thalos_core::motion::{OutputChannel, OutputValue};
    use thalos_math::Transform3D;
    use thalos_planning::motion::execution::{
        CartesianSample, ExecutionPlan, ExecutionSegment, JointSample,
    };

    use super::*;

    // ── Helpers ─────────────────────────────────────────────────────────

    fn single_joint_trajectory_plan() -> ExecutionPlan {
        ExecutionPlan::new(
            vec![ExecutionSegment::JointTrajectory {
                samples: vec![
                    JointSample {
                        time: Duration::ZERO,
                        joints: vec![0.0, 0.0],
                    },
                    JointSample {
                        time: Duration::from_millis(500),
                        joints: vec![0.5, 0.3],
                    },
                    JointSample {
                        time: Duration::from_secs(1),
                        joints: vec![1.0, 0.5],
                    },
                ],
            }],
            "test".into(),
        )
    }

    fn multi_segment_plan() -> ExecutionPlan {
        ExecutionPlan::new(
            vec![
                ExecutionSegment::JointTrajectory {
                    samples: vec![
                        JointSample {
                            time: Duration::ZERO,
                            joints: vec![0.0, 0.0],
                        },
                        JointSample {
                            time: Duration::from_millis(200),
                            joints: vec![0.2, 0.1],
                        },
                    ],
                },
                ExecutionSegment::JointTrajectory {
                    samples: vec![
                        JointSample {
                            time: Duration::ZERO,
                            joints: vec![0.2, 0.1],
                        },
                        JointSample {
                            time: Duration::from_millis(300),
                            joints: vec![0.5, 0.4],
                        },
                        JointSample {
                            time: Duration::from_millis(600),
                            joints: vec![0.8, 0.6],
                        },
                    ],
                },
            ],
            "test".into(),
        )
    }

    // ── Task 1.1: RED — reject empty plan ──────────────────────────────

    #[test]
    fn rejects_empty_segments_plan() {
        let plan = ExecutionPlan::new(vec![], "test".into());
        let result = ExecutionManifestBuilder::from_plan(&plan);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ManifestError::EmptyPlan);
    }

    #[test]
    fn rejects_plan_with_only_pause_and_output() {
        let plan = ExecutionPlan::new(
            vec![
                ExecutionSegment::Pause {
                    duration: Duration::from_secs(1),
                },
                ExecutionSegment::Output {
                    at_time: Duration::from_secs(2),
                    channel: OutputChannel {
                        name: "gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: OutputValue::Bool(true),
                },
            ],
            "test".into(),
        );
        let result = ExecutionManifestBuilder::from_plan(&plan);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ManifestError::EmptyPlan);
    }

    // ── Task 1.3: GREEN — basic single-segment construction ────────────

    #[test]
    fn builds_manifest_from_joint_trajectory() {
        let plan = single_joint_trajectory_plan();
        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        // Metadata
        assert_eq!(manifest.metadata.dof_count, 2);
        assert_eq!(manifest.metadata.total_samples, 3);
        assert_eq!(manifest.metadata.duration_us, 1_000_000); // 1 second

        // Segments
        assert_eq!(manifest.segments.len(), 1);
        assert_eq!(manifest.segments[0].index, 0);
        assert_eq!(manifest.segments[0].instruction, ManifestInstruction::MoveJ);
        assert_eq!(manifest.segments[0].sample_start, 0);
        assert_eq!(manifest.segments[0].sample_count, 3);

        // Samples
        assert_eq!(manifest.samples.len(), 3);
        assert_eq!(manifest.samples[0].joints, vec![0.0, 0.0]);
        assert_eq!(manifest.samples[0].dt_us, 0); // first sample

        assert_eq!(manifest.samples[1].joints, vec![0.5, 0.3]);
        assert_eq!(manifest.samples[1].dt_us, 500_000); // 500ms delta

        assert_eq!(manifest.samples[2].joints, vec![1.0, 0.5]);
        assert_eq!(manifest.samples[2].dt_us, 500_000); // 500ms delta
    }

    #[test]
    fn builds_manifest_from_cartesian_trajectory() {
        let plan = ExecutionPlan::new(
            vec![ExecutionSegment::CartesianTrajectory {
                samples: vec![
                    CartesianSample {
                        time: Duration::ZERO,
                        pose: Transform3D::identity(),
                    },
                    CartesianSample {
                        time: Duration::from_millis(200),
                        pose: Transform3D::identity(),
                    },
                ],
                resolved: vec![vec![0.1, 0.2, 0.3], vec![0.4, 0.5, 0.6]],
            }],
            "test".into(),
        );

        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        assert_eq!(manifest.metadata.dof_count, 3);
        assert_eq!(manifest.metadata.total_samples, 2);
        assert_eq!(manifest.segments.len(), 1);
        assert_eq!(manifest.segments[0].instruction, ManifestInstruction::MoveL);
        assert_eq!(manifest.samples[0].joints, vec![0.1, 0.2, 0.3]);
        assert_eq!(manifest.samples[0].dt_us, 0);
        assert_eq!(manifest.samples[1].joints, vec![0.4, 0.5, 0.6]);
        assert_eq!(manifest.samples[1].dt_us, 200_000);
    }

    #[test]
    fn dt_us_sum_matches_total_duration() {
        let plan = single_joint_trajectory_plan();
        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        let dt_sum: u64 = manifest.samples.iter().map(|s| s.dt_us as u64).sum();
        assert_eq!(dt_sum, manifest.metadata.duration_us);
    }

    // ── Multi-segment ─────────────────────────────────────────────────

    #[test]
    fn builds_manifest_from_multi_segment_plan() {
        let plan = multi_segment_plan();
        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        assert_eq!(manifest.metadata.total_samples, 5); // 2 + 3
        assert_eq!(manifest.segments.len(), 2);

        // Segment 0
        assert_eq!(manifest.segments[0].index, 0);
        assert_eq!(manifest.segments[0].sample_start, 0);
        assert_eq!(manifest.segments[0].sample_count, 2);

        // Segment 1
        assert_eq!(manifest.segments[1].index, 1);
        assert_eq!(manifest.segments[1].sample_start, 2);
        assert_eq!(manifest.segments[1].sample_count, 3);

        // Delta timing: first sample of segment 1 has dt=0 (adjacent to seg 0 end)
        assert_eq!(manifest.samples[2].dt_us, 0);
        // which means its joints must match the previous sample's end position
        assert_eq!(manifest.samples[1].joints, manifest.samples[2].joints);
    }

    // ── Plan with Pause ────────────────────────────────────────────────

    #[test]
    fn pause_advances_clock_without_adding_waypoints() {
        let plan = ExecutionPlan::new(
            vec![
                ExecutionSegment::JointTrajectory {
                    samples: vec![
                        JointSample {
                            time: Duration::ZERO,
                            joints: vec![0.0],
                        },
                        JointSample {
                            time: Duration::from_millis(100),
                            joints: vec![1.0],
                        },
                    ],
                },
                ExecutionSegment::Pause {
                    duration: Duration::from_millis(500),
                },
                ExecutionSegment::JointTrajectory {
                    samples: vec![
                        JointSample {
                            time: Duration::ZERO,
                            joints: vec![1.0],
                        },
                        JointSample {
                            time: Duration::from_millis(200),
                            joints: vec![2.0],
                        },
                    ],
                },
            ],
            "test".into(),
        );

        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        assert_eq!(manifest.metadata.total_samples, 4);
        // duration: 100ms + 500ms + 200ms = 800ms
        assert_eq!(manifest.metadata.duration_us, 800_000);

        // dt from last sample of seg 0 to first of seg 2 should include the pause
        // last seg 0 sample: global = 100000
        // after pause: cumulative = 600000
        // first seg 2 sample: global = 600000
        // dt = 600000 - 100000 = 500000
        assert_eq!(manifest.samples[2].dt_us, 500_000);
        assert_eq!(manifest.samples[3].dt_us, 200_000);
    }

    // ── Empty trajectory segment is skipped ────────────────────────────

    #[test]
    fn empty_trajectory_segment_skipped() {
        let plan = ExecutionPlan::new(
            vec![
                ExecutionSegment::JointTrajectory { samples: vec![] },
                ExecutionSegment::JointTrajectory {
                    samples: vec![JointSample {
                        time: Duration::from_millis(100),
                        joints: vec![0.5],
                    }],
                },
            ],
            "test".into(),
        );

        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        assert_eq!(manifest.metadata.total_samples, 1);
        assert_eq!(manifest.segments.len(), 1);
        assert_eq!(manifest.segments[0].index, 1); // segment 0 was skipped
    }

    // ── Invariant checks (Tasks 1.8-1.9) ─────────────────────────────

    #[test]
    fn invariants_hold_for_single_segment() {
        let plan = single_joint_trajectory_plan();
        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        // These are verified by check_invariants, but we also test directly
        assert_eq!(manifest.samples.len(), manifest.metadata.total_samples);

        let last = manifest.segments.last().unwrap();
        assert_eq!(
            last.sample_start + last.sample_count,
            manifest.metadata.total_samples
        );

        // All segments in ascending order
        for w in manifest.segments.windows(2) {
            assert!(w[0].index < w[1].index);
        }
    }

    #[test]
    fn invariants_hold_for_multi_segment() {
        let plan = multi_segment_plan();
        let manifest = ExecutionManifestBuilder::from_plan(&plan).expect("should build");

        assert_eq!(manifest.samples.len(), manifest.metadata.total_samples);

        let last = manifest.segments.last().unwrap();
        assert_eq!(
            last.sample_start + last.sample_count,
            manifest.metadata.total_samples
        );

        // No overlap
        for w in manifest.segments.windows(2) {
            assert!(w[0].sample_start + w[0].sample_count <= w[1].sample_start);
        }
    }
}
