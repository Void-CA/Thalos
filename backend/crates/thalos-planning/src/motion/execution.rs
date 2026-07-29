use std::time::Duration;

use thalos_core::motion::{OutputChannel, OutputValue};
use thalos_math::Transform3D;

/// A vector of joint positions.
pub type JointState = Vec<f64>;

/// A single joint-space sample in a trajectory segment.
///
/// `time` is relative to the segment's start (t=0 at segment beginning).
#[derive(Debug, Clone, PartialEq)]
pub struct JointSample {
    pub time: Duration,
    pub joints: JointState,
}

/// A single Cartesian-space sample in a trajectory segment.
///
/// `time` is relative to the segment's start (t=0 at segment beginning).
#[derive(Debug, Clone, PartialEq)]
pub struct CartesianSample {
    pub time: Duration,
    pub pose: Transform3D,
}

/// A single segment in an `ExecutionPlan`.
///
/// Exactly four variants exist:
/// - `JointTrajectory`: discretised joint-space path from MoveJ
/// - `CartesianTrajectory`: discretised Cartesian path with per-sample IK solutions
/// - `Pause`: timed wait (no joint state)
/// - `Output`: IO event scheduled at an absolute plan time
#[derive(Debug, Clone, PartialEq)]
pub enum ExecutionSegment {
    JointTrajectory {
        samples: Vec<JointSample>,
    },
    CartesianTrajectory {
        samples: Vec<CartesianSample>,
        /// IK solution for each Cartesian sample.
        /// Invariant: `resolved.len() == samples.len()`.
        resolved: Vec<JointState>,
    },
    Pause {
        duration: Duration,
    },
    Output {
        /// Absolute time relative to plan start (t=0).
        at_time: Duration,
        channel: OutputChannel,
        value: OutputValue,
    },
}

/// Provenance metadata for an `ExecutionPlan`.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanMetadata {
    pub total_duration: Duration,
    pub segment_count: usize,
    pub robot_model: String,
}

/// A complete, discretised execution plan ready for hardware backends.
///
/// Produced by a `MotionPlanner` from a `MotionProgram`. Contains a
/// time-ordered sequence of segments with strict continuity and timing
/// invariants.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionPlan {
    pub segments: Vec<ExecutionSegment>,
    pub metadata: PlanMetadata,
}

impl ExecutionPlan {
    /// Create a new execution plan.
    ///
    /// # Panics
    ///
    /// Panics if any `CartesianTrajectory` violates the
    /// `samples.len() == resolved.len()` invariant.
    pub fn new(segments: Vec<ExecutionSegment>, robot_model: String) -> Self {
        // Enforce CartesianTrajectory invariant
        for seg in &segments {
            if let ExecutionSegment::CartesianTrajectory { samples, resolved } = seg {
                assert_eq!(
                    samples.len(),
                    resolved.len(),
                    "CartesianTrajectory samples.len() ({}) must equal resolved.len() ({})",
                    samples.len(),
                    resolved.len()
                );
            }
        }

        let segment_count = segments.len();
        let total_duration = segments
            .iter()
            .map(|seg| match seg {
                ExecutionSegment::JointTrajectory { samples } => {
                    samples.last().map(|s| s.time).unwrap_or(Duration::ZERO)
                }
                ExecutionSegment::CartesianTrajectory { samples, .. } => {
                    samples.last().map(|s| s.time).unwrap_or(Duration::ZERO)
                }
                ExecutionSegment::Pause { duration } => *duration,
                ExecutionSegment::Output { at_time, .. } => *at_time,
            })
            .sum::<Duration>();

        Self {
            segments,
            metadata: PlanMetadata {
                total_duration,
                segment_count,
                robot_model,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Phase 1, Task 1: Type construction ─────────────────────────────

    #[test]
    fn joint_sample_constructs_with_time_and_joints() {
        let sample = JointSample {
            time: Duration::from_millis(500),
            joints: vec![0.5, 0.3, -0.2],
        };
        assert_eq!(sample.time, Duration::from_millis(500));
        assert_eq!(sample.joints, vec![0.5, 0.3, -0.2]);
    }

    #[test]
    fn cartesian_sample_constructs_with_time_and_pose() {
        let pose = Transform3D::identity();
        let sample = CartesianSample {
            time: Duration::from_millis(250),
            pose: pose.clone(),
        };
        assert_eq!(sample.time, Duration::from_millis(250));
        assert_eq!(sample.pose, Transform3D::identity());
    }

    #[test]
    fn joint_trajectory_segment_preserves_samples() {
        let samples = vec![
            JointSample {
                time: Duration::ZERO,
                joints: vec![0.0, 0.0],
            },
            JointSample {
                time: Duration::from_millis(100),
                joints: vec![1.0, 1.0],
            },
        ];
        let seg = ExecutionSegment::JointTrajectory {
            samples: samples.clone(),
        };
        match &seg {
            ExecutionSegment::JointTrajectory { samples: s } => {
                assert_eq!(s.len(), 2);
                assert_eq!(s[0].time, Duration::ZERO);
                assert_eq!(s[1].joints, vec![1.0, 1.0]);
            }
            _ => panic!("Expected JointTrajectory"),
        }
    }

    #[test]
    fn cartesian_trajectory_parallel_vectors_equal_length() {
        let samples = vec![CartesianSample {
            time: Duration::ZERO,
            pose: Transform3D::identity(),
        }];
        let resolved = vec![vec![0.0, 0.0]];
        let seg = ExecutionSegment::CartesianTrajectory {
            samples: samples.clone(),
            resolved: resolved.clone(),
        };
        match &seg {
            ExecutionSegment::CartesianTrajectory {
                samples: s,
                resolved: r,
            } => {
                assert_eq!(s.len(), r.len());
            }
            _ => panic!("Expected CartesianTrajectory"),
        }
    }

    #[test]
    fn pause_segment_holds_duration() {
        let dur = Duration::from_millis(500);
        let seg = ExecutionSegment::Pause { duration: dur };
        match &seg {
            ExecutionSegment::Pause { duration: d } => {
                assert_eq!(*d, Duration::from_millis(500));
            }
            _ => panic!("Expected Pause"),
        }
    }

    #[test]
    fn output_segment_holds_all_fields() {
        let at_time = Duration::from_secs(3);
        let channel = OutputChannel {
            name: "gripper".into(),
            channel_type: "digital".into(),
        };
        let value = OutputValue::Bool(true);
        let seg = ExecutionSegment::Output {
            at_time,
            channel: channel.clone(),
            value: value.clone(),
        };
        match &seg {
            ExecutionSegment::Output {
                at_time: t,
                channel: c,
                value: v,
            } => {
                assert_eq!(*t, Duration::from_secs(3));
                assert_eq!(*c, channel);
                assert_eq!(*v, value);
            }
            _ => panic!("Expected Output"),
        }
    }

    // ── Segment times are relative ─────────────────────────────────────

    #[test]
    fn sample_times_are_relative_to_segment() {
        // Two segments: segment 1 has t=0..100ms, segment 2 has t=0..200ms
        let jt = ExecutionSegment::JointTrajectory {
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
        };
        match &jt {
            ExecutionSegment::JointTrajectory { samples } => {
                // First sample at t=0 (relative to segment start)
                assert_eq!(samples[0].time, Duration::ZERO);
                assert_eq!(samples[1].time, Duration::from_millis(100));
            }
            _ => unreachable!(),
        }
    }

    // ── Phase 1, Task 2: JointState type alias ─────────────────────────

    #[test]
    fn joint_state_is_vec_f64() {
        let js: JointState = vec![0.1, 0.2, 0.3];
        assert_eq!(js.len(), 3);
        assert!((js[0] - 0.1).abs() < 1e-12);
    }

    // ── ExecutionPlan construction ─────────────────────────────────────

    #[test]
    fn execution_plan_empty_segments() {
        let plan = ExecutionPlan::new(vec![], "test".into());
        assert!(plan.segments.is_empty());
        assert_eq!(plan.metadata.segment_count, 0);
        assert_eq!(plan.metadata.total_duration, Duration::ZERO);
        assert_eq!(plan.metadata.robot_model, "test");
    }

    #[test]
    fn execution_plan_metadata_reflects_contents() {
        let segments = vec![
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
                duration: Duration::from_secs(2),
            },
        ];
        let plan = ExecutionPlan::new(segments, "scara".into());
        assert_eq!(plan.metadata.segment_count, 2);
        assert!(plan.metadata.total_duration >= Duration::from_secs(2));
        assert_eq!(plan.metadata.robot_model, "scara");
    }

    #[test]
    #[should_panic(expected = "samples.len()")]
    fn cartesian_trajectory_mismatched_lengths_panics() {
        ExecutionPlan::new(
            vec![ExecutionSegment::CartesianTrajectory {
                samples: vec![CartesianSample {
                    time: Duration::ZERO,
                    pose: Transform3D::identity(),
                }],
                resolved: vec![], // 0 resolved != 1 sample
            }],
            "test".into(),
        );
    }

    // ── Sample time monotonicity within segment ────────────────────────

    #[test]
    fn joint_trajectory_times_are_monotonic() {
        let samples = vec![
            JointSample {
                time: Duration::ZERO,
                joints: vec![0.0],
            },
            JointSample {
                time: Duration::from_millis(100),
                joints: vec![0.5],
            },
            JointSample {
                time: Duration::from_millis(200),
                joints: vec![1.0],
            },
        ];
        for w in samples.windows(2) {
            assert!(w[0].time <= w[1].time);
        }
    }

    #[test]
    fn cartesian_trajectory_times_are_monotonic() {
        let samples = vec![
            CartesianSample {
                time: Duration::ZERO,
                pose: Transform3D::identity(),
            },
            CartesianSample {
                time: Duration::from_millis(50),
                pose: Transform3D::identity(),
            },
        ];
        for w in samples.windows(2) {
            assert!(w[0].time <= w[1].time);
        }
    }
}
