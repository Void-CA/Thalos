use std::time::Duration;

use thalos_planning::motion::execution::{ExecutionPlan, ExecutionSegment};

use crate::backends::controller::RobotController;
use crate::motion_trace::{MotionSample, MotionTrace};
use crate::state::robot_state::MotionMode;

use super::command::{ExecutionCommand, ExecutionSegmentBoundary};
use super::report::{ExecutionError, ExecutionReport, ExecutionStatus};

/// Adapter that translates `ExecutionPlan` into `RobotController` commands and
/// produces an `ExecutionReport` with a `MotionTrace`.
///
/// This is a stateless utility — all methods are associated functions.
pub struct ExecutionAdapter;

impl ExecutionAdapter {
    /// Translate an `ExecutionPlan` into a flattened `ExecutionCommand`.
    ///
    /// Iterates each segment:
    /// - `JointTrajectory`: copies joint positions as waypoints, records segment boundary
    /// - `CartesianTrajectory`: uses the pre-computed IK solutions as waypoints
    /// - `Pause`: adds its duration to the total
    /// - `Output`: adds its `at_time` to the total
    ///
    /// Total duration is the sum of all segment durations (cumulative).
    pub fn prepare(plan: &ExecutionPlan) -> ExecutionCommand {
        let mut waypoints: Vec<Vec<f64>> = Vec::new();
        let mut segments: Vec<ExecutionSegmentBoundary> = Vec::new();
        let mut total_duration = Duration::ZERO;

        for (index, segment) in plan.segments.iter().enumerate() {
            match segment {
                ExecutionSegment::JointTrajectory { samples } => {
                    let start_sample = waypoints.len();
                    for sample in samples {
                        waypoints.push(sample.joints.clone());
                    }
                    let end_sample = waypoints.len();
                    if start_sample < end_sample {
                        segments.push(ExecutionSegmentBoundary {
                            index,
                            start_sample,
                            end_sample,
                        });
                    }
                    if let Some(last) = samples.last() {
                        total_duration += last.time;
                    }
                }
                ExecutionSegment::CartesianTrajectory { samples, resolved } => {
                    let start_sample = waypoints.len();
                    for joints in resolved {
                        waypoints.push(joints.clone());
                    }
                    let end_sample = waypoints.len();
                    if start_sample < end_sample {
                        segments.push(ExecutionSegmentBoundary {
                            index,
                            start_sample,
                            end_sample,
                        });
                    }
                    if let Some(last) = samples.last() {
                        total_duration += last.time;
                    }
                }
                ExecutionSegment::Pause { duration } => {
                    total_duration += *duration;
                }
                ExecutionSegment::Output { at_time, .. } => {
                    total_duration += *at_time;
                }
            }
        }

        ExecutionCommand {
            waypoints,
            duration: total_duration,
            segments,
        }
    }

    /// Execute a plan through a `RobotController` and collect a trace.
    ///
    /// 1. Calls `prepare(plan)` to build the command
    /// 2. Returns `EmptyPlan` if no waypoints were produced
    /// 3. Calls `controller.execute(command.waypoints, command.duration)`
    /// 4. Polls `controller.robot_state()` in a loop until progress >= 1.0 or
    ///    the motion mode becomes idle
    /// 5. Builds a `MotionTrace` from the periodic state samples
    /// 6. Returns an `ExecutionReport` with status `Completed`
    pub async fn execute(
        controller: &mut dyn RobotController,
        plan: &ExecutionPlan,
    ) -> Result<ExecutionReport, ExecutionError> {
        let command = Self::prepare(plan);

        if command.waypoints.is_empty() {
            return Err(ExecutionError::EmptyPlan);
        }

        controller
            .execute(command.waypoints, command.duration.as_secs_f64())
            .await?;

        let mut trace = MotionTrace::new();
        let start = std::time::Instant::now();

        loop {
            let state = controller.robot_state().await;
            let elapsed = start.elapsed();
            trace.push(MotionSample::from_state(elapsed, &state));

            let progress = state.execution.progress;
            if progress >= 1.0 || state.motion.mode == MotionMode::Idle {
                break;
            }

            tokio::task::yield_now().await;
        }

        Ok(ExecutionReport {
            trace,
            duration: command.duration,
            status: ExecutionStatus::Completed,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use thalos_math::Transform3D;
    use thalos_planning::motion::execution::{
        CartesianSample, ExecutionPlan, ExecutionSegment, JointSample,
    };

    use crate::backends::controller::tests::MockController;
    use crate::backends::controller::RobotController;

    use super::*;

    // ── prepare() tests ────────────────────────────────────────────────

    #[test]
    fn joint_trajectory_with_three_samples_produces_three_waypoints() {
        let samples = vec![
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
        ];
        let plan = ExecutionPlan::new(
            vec![ExecutionSegment::JointTrajectory {
                samples: samples.clone(),
            }],
            "test".into(),
        );

        let cmd = ExecutionAdapter::prepare(&plan);

        assert_eq!(cmd.waypoints.len(), 3);
        assert_eq!(cmd.waypoints[0], vec![0.0, 0.0]);
        assert_eq!(cmd.waypoints[1], vec![0.5, 0.3]);
        assert_eq!(cmd.waypoints[2], vec![1.0, 0.5]);
        assert_eq!(cmd.segments.len(), 1);
        assert_eq!(cmd.segments[0].index, 0);
        assert_eq!(cmd.segments[0].start_sample, 0);
        assert_eq!(cmd.segments[0].end_sample, 3);
        assert_eq!(cmd.duration, Duration::from_secs(1));
    }

    #[test]
    fn cartesian_trajectory_uses_resolved_joints_not_poses() {
        let samples = vec![
            CartesianSample {
                time: Duration::ZERO,
                pose: Transform3D::identity(),
            },
            CartesianSample {
                time: Duration::from_millis(200),
                pose: Transform3D::identity(),
            },
        ];
        let resolved = vec![vec![0.1, 0.2, 0.3], vec![0.4, 0.5, 0.6]];
        let plan = ExecutionPlan::new(
            vec![ExecutionSegment::CartesianTrajectory {
                samples,
                resolved: resolved.clone(),
            }],
            "test".into(),
        );

        let cmd = ExecutionAdapter::prepare(&plan);

        assert_eq!(cmd.waypoints, resolved);
        assert_eq!(cmd.segments.len(), 1);
        assert_eq!(cmd.segments[0].start_sample, 0);
        assert_eq!(cmd.segments[0].end_sample, 2);
    }

    #[test]
    fn two_segments_produce_correct_boundaries_and_cumulative_samples() {
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
                            joints: vec![0.1],
                        },
                    ],
                },
                ExecutionSegment::JointTrajectory {
                    samples: vec![
                        JointSample {
                            time: Duration::ZERO,
                            joints: vec![0.2],
                        },
                        JointSample {
                            time: Duration::from_millis(200),
                            joints: vec![0.4],
                        },
                        JointSample {
                            time: Duration::from_millis(400),
                            joints: vec![0.6],
                        },
                    ],
                },
            ],
            "test".into(),
        );

        let cmd = ExecutionAdapter::prepare(&plan);

        // Total waypoints: 2 + 3 = 5
        assert_eq!(cmd.waypoints.len(), 5);

        // Segment 0: samples 0..2
        assert_eq!(cmd.segments.len(), 2);
        assert_eq!(cmd.segments[0].index, 0);
        assert_eq!(cmd.segments[0].start_sample, 0);
        assert_eq!(cmd.segments[0].end_sample, 2);

        // Segment 1: samples 2..5
        assert_eq!(cmd.segments[1].index, 1);
        assert_eq!(cmd.segments[1].start_sample, 2);
        assert_eq!(cmd.segments[1].end_sample, 5);

        // Duration: 100ms + 400ms = 500ms
        assert_eq!(cmd.duration, Duration::from_millis(500));
    }

    #[test]
    fn empty_plan_returns_command_with_no_waypoints() {
        let plan = ExecutionPlan::new(vec![], "test".into());
        let cmd = ExecutionAdapter::prepare(&plan);

        assert!(cmd.waypoints.is_empty());
        assert!(cmd.segments.is_empty());
        assert_eq!(cmd.duration, Duration::ZERO);
    }

    #[test]
    fn single_segment_duration_matches_last_sample_time() {
        let samples = vec![
            JointSample {
                time: Duration::ZERO,
                joints: vec![0.0],
            },
            JointSample {
                time: Duration::from_millis(750),
                joints: vec![1.0],
            },
        ];
        let plan = ExecutionPlan::new(
            vec![ExecutionSegment::JointTrajectory { samples }],
            "test".into(),
        );

        let cmd = ExecutionAdapter::prepare(&plan);

        assert_eq!(cmd.duration, Duration::from_millis(750));
    }

    #[test]
    fn pause_segment_affects_duration_no_waypoints() {
        let plan = ExecutionPlan::new(
            vec![
                ExecutionSegment::JointTrajectory {
                    samples: vec![JointSample {
                        time: Duration::from_secs(1),
                        joints: vec![1.0],
                    }],
                },
                ExecutionSegment::Pause {
                    duration: Duration::from_secs(2),
                },
            ],
            "test".into(),
        );

        let cmd = ExecutionAdapter::prepare(&plan);

        assert_eq!(cmd.waypoints.len(), 1);
        assert_eq!(cmd.segments.len(), 1);
        // Duration: 1s (trajectory) + 2s (pause) = 3s
        assert_eq!(cmd.duration, Duration::from_secs(3));
    }

    #[test]
    fn output_segment_affects_duration_no_waypoints() {
        let plan = ExecutionPlan::new(
            vec![
                ExecutionSegment::JointTrajectory {
                    samples: vec![JointSample {
                        time: Duration::from_secs(1),
                        joints: vec![1.0],
                    }],
                },
                ExecutionSegment::Output {
                    at_time: Duration::from_secs(5),
                    channel: thalos_core::motion::OutputChannel {
                        name: "gripper".into(),
                        channel_type: "digital".into(),
                    },
                    value: thalos_core::motion::OutputValue::Bool(true),
                },
            ],
            "test".into(),
        );

        let cmd = ExecutionAdapter::prepare(&plan);

        assert_eq!(cmd.waypoints.len(), 1);
        assert_eq!(cmd.segments.len(), 1);
        // Duration: 1s (trajectory) + 5s (output at_time) = 6s
        assert_eq!(cmd.duration, Duration::from_secs(6));
    }

    // ── execute() tests ────────────────────────────────────────────────

    #[tokio::test]
    async fn execute_empty_plan_returns_error() {
        let plan = ExecutionPlan::new(vec![], "test".into());
        let mut controller = MockController::new();

        let result = ExecutionAdapter::execute(&mut controller, &plan).await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ExecutionError::EmptyPlan));
    }

    #[tokio::test]
    async fn execute_produces_report_with_trace() {
        let plan = ExecutionPlan::new(
            vec![ExecutionSegment::JointTrajectory {
                samples: vec![
                    JointSample {
                        time: Duration::ZERO,
                        joints: vec![0.0, 0.0],
                    },
                    JointSample {
                        time: Duration::from_millis(100),
                        joints: vec![0.5, 0.3],
                    },
                ],
            }],
            "test".into(),
        );

        let mut controller = MockController::new();
        controller.connect().await.unwrap();

        let report = ExecutionAdapter::execute(&mut controller, &plan)
            .await
            .expect("execution should succeed");

        assert!(matches!(report.status, ExecutionStatus::Completed));
        assert!(!report.trace.is_empty());
        assert!(report.duration > Duration::ZERO);
    }

    #[tokio::test]
    async fn execute_on_disconnected_controller_propagates_error() {
        let plan = ExecutionPlan::new(
            vec![ExecutionSegment::JointTrajectory {
                samples: vec![JointSample {
                    time: Duration::ZERO,
                    joints: vec![0.0],
                }],
            }],
            "test".into(),
        );

        let mut controller = MockController::new(); // not connected

        let result = ExecutionAdapter::execute(&mut controller, &plan).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ExecutionError::Controller(e) => {
                assert_eq!(e, crate::error::ControllerError::NotConnected);
            }
            _ => panic!("expected Controller error"),
        }
    }
}
