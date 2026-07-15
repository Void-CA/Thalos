use std::ops::Range;

use thalos_core::prelude::{RobotState, Trajectory, TrajectoryPoint};

use crate::error::{CompileError, PlanningError};
use crate::goal::{
    GoalResolver, GoalResolverConfig, JointGoal, ResolvedPoseGoal, ValidatedGoal,
};
use crate::motion::move_j::{MoveJConfig, MoveJPlanner};
use crate::motion::move_l::{MoveLConfig, MoveLPlanner};
use crate::motion::planner::{MotionPlanner, PlanningContext};
use crate::motion::program::{CompiledPlan, MotionProgram, PlannedSegment};
use crate::motion::segment::MotionSegment;

/// Dispatches a `MotionSegment` to the appropriate `MotionPlanner`.
///
/// This trait exists so that `PlanCompiler` never needs to know about
/// specific movement types. New variants (MoveP, Wait, etc.) register a
/// new arm in the dispatcher without changing the compiler.
pub trait MotionPlannerDispatcher {
    /// Plan a single segment against the given context and return its
    /// time-parameterised trajectory.
    fn plan_segment(
        &self,
        segment: &MotionSegment,
        ctx: &PlanningContext,
    ) -> Result<Trajectory, PlanningError>;
}

/// Default dispatcher supporting MoveJ and MoveL.
///
/// Uses `GoalResolver` for validation and delegates to `MoveJPlanner` /
/// `MoveLPlanner`. New segment types require a new `match` arm here —
/// the compiler stays untouched.
pub struct DefaultPlannerDispatcher {
    pub goal_resolver_config: GoalResolverConfig,
}

impl DefaultPlannerDispatcher {
    pub fn new(config: GoalResolverConfig) -> Self {
        Self {
            goal_resolver_config: config,
        }
    }
}

impl Default for DefaultPlannerDispatcher {
    fn default() -> Self {
        Self {
            goal_resolver_config: GoalResolverConfig::default(),
        }
    }
}

impl MotionPlannerDispatcher for DefaultPlannerDispatcher {
    fn plan_segment(
        &self,
        segment: &MotionSegment,
        ctx: &PlanningContext,
    ) -> Result<Trajectory, PlanningError> {
        match segment {
            MotionSegment::MoveJ {
                target,
                max_velocity,
                max_acceleration,
            } => {
                let resolver = GoalResolver::new(self.goal_resolver_config.clone());
                let goal: ValidatedGoal<JointGoal> =
                    resolver.resolve_joint(ctx, target)?;

                let planner = MoveJPlanner::new(MoveJConfig {
                    max_velocity: max_velocity.unwrap_or(1.0),
                    max_acceleration: max_acceleration.unwrap_or(0.5),
                    time_step: 0.01,
                });
                planner.plan(ctx, &goal)
            }

            MotionSegment::MoveL {
                frame: _,
                target_pose,
                max_velocity,
            } => {
                let resolver = GoalResolver::new(self.goal_resolver_config.clone());
                let goal: ValidatedGoal<ResolvedPoseGoal> =
                    resolver.resolve_pose(ctx, target_pose)?;

                let planner = MoveLPlanner::new(MoveLConfig {
                    max_velocity: max_velocity.unwrap_or(0.25),
                    max_acceleration: 0.125,
                    time_step: 0.01,
                    cartesian_step: 0.01,
                });
                planner.plan(ctx, &goal)
            }
        }
    }
}

/// Compiles a `MotionProgram` into a `CompiledPlan`.
///
/// The compiler is a pure orchestrator:
/// 1. Iterates segments in order
/// 2. Delegates each to the dispatcher
/// 3. Concatenates trajectories with time offsets
/// 4. Returns the merged plan with per-segment metadata
///
/// It does **not** know about MoveJ, MoveL, or any specific motion type.
pub struct PlanCompiler {
    pub dispatcher: Box<dyn MotionPlannerDispatcher + Send + Sync>,
}

impl std::fmt::Debug for PlanCompiler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlanCompiler")
            .field("dispatcher", &format_args!("..."))
            .finish()
    }
}

impl PlanCompiler {
    pub fn new(dispatcher: Box<dyn MotionPlannerDispatcher + Send + Sync>) -> Self {
        Self { dispatcher }
    }

    /// Compile a complete motion program.
    ///
    /// Each segment is planned sequentially. The end state of segment N
    /// becomes the start state of segment N+1. All waypoints are merged
    /// into a single continuous trajectory with monotonically increasing
    /// timestamps.
    ///
    /// # Atomicity
    ///
    /// If **any** segment fails, the entire compilation fails with a
    /// `CompileError` identifying which segment and why. No partial
    /// `CompiledPlan` is returned — the runtime is never modified.
    pub fn compile(
        &self,
        program: &MotionProgram,
        ctx: &PlanningContext,
    ) -> Result<CompiledPlan, CompileError> {
        let mut segments = Vec::with_capacity(program.segments.len());
        let mut all_waypoints: Vec<TrajectoryPoint> = Vec::new();
        let mut time_offset = 0.0_f64;
        let mut current_joints = ctx.current_state.joints.clone();

        for (segment_index, segment) in program.segments.iter().enumerate() {
            let segment_state = RobotState::new(current_joints.clone());
            let segment_ctx = PlanningContext {
                robot: ctx.robot,
                current_state: &segment_state,
                ik_solver: ctx.ik_solver,
                tcp: ctx.tcp,
            };

            let trajectory = self
                .dispatcher
                .plan_segment(segment, &segment_ctx)
                .map_err(|source| CompileError {
                    segment_index,
                    source,
                })?;

            let start_idx = all_waypoints.len();

            // Append waypoints with shifted timestamps
            for wp in trajectory.waypoints() {
                all_waypoints.push(TrajectoryPoint::new(
                    wp.joints().to_vec(),
                    wp.timestamp() + time_offset,
                ));
            }

            let end_idx = all_waypoints.len();
            let seg_duration = trajectory.duration();

            // Advance current state to end of this segment
            if let Some(last) = trajectory.waypoints().last() {
                current_joints = last.joints().to_vec();
            }

            segments.push(PlannedSegment {
                source: segment.clone(),
                trajectory,
                waypoint_range: Range { start: start_idx, end: end_idx },
                time_range: Range {
                    start: time_offset,
                    end: time_offset + seg_duration,
                },
            });

            time_offset += seg_duration;
        }

        let merged = Trajectory::new(all_waypoints);
        Ok(CompiledPlan::new(merged, segments))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::{
        kinematics::inverse::{IKResult, IKSolver},
        models::{RobotModel, RobotRegistry},
        robot::state::RobotState,
    };

    struct NoopIKSolver;

    impl IKSolver for NoopIKSolver {
        fn solve(&self, q0: &[f64], _goal: thalos_core::kinematics::inverse::IKGoal) -> IKResult {
            IKResult::converged(q0.to_vec(), 1, 0.0, None)
        }
    }

    /// Helper: create a Planar2R chain and a planning context owning all data.
    struct TestHarness {
        chain: thalos_core::robot::serial_chain::SerialChain,
        state: RobotState,
        ik: NoopIKSolver,
    }

    impl TestHarness {
        fn new() -> Self {
            let chain = RobotRegistry::create_default(RobotModel::Planar2R);
            let state = RobotState::zero(chain.dof_count());
            Self { chain, state, ik: NoopIKSolver }
        }

        fn ctx(&self) -> PlanningContext<'_> {
            PlanningContext {
                robot: &self.chain,
                current_state: &self.state,
                ik_solver: &self.ik,
                tcp: None,
            }
        }
    }

    #[test]
    fn compile_empty_program() {
        let h = TestHarness::new();
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let program = MotionProgram::new(vec![]);

        let result = compiler.compile(&program, &h.ctx());
        assert!(result.is_ok());
        let plan = result.unwrap();
        assert!(plan.merged_trajectory.is_empty());
        assert!(plan.segments.is_empty());
        assert_eq!(plan.duration, 0.0);
        assert_eq!(plan.waypoint_count, 0);
    }

    #[test]
    fn compile_single_movej() {
        let h = TestHarness::new();
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let program = MotionProgram::new(vec![MotionSegment::MoveJ {
            target: vec![1.0, 1.0],
            max_velocity: None,
            max_acceleration: None,
        }]);

        let plan = compiler.compile(&program, &h.ctx()).expect("compile failed");
        assert!(!plan.merged_trajectory.is_empty());
        assert_eq!(plan.segments.len(), 1);
        assert_eq!(plan.waypoint_count, plan.merged_trajectory.len());

        // Verify segment metadata
        let seg = &plan.segments[0];
        assert_eq!(seg.waypoint_range.start, 0);
        assert_eq!(seg.waypoint_range.end, plan.waypoint_count);
        assert_eq!(seg.time_range.start, 0.0);
        assert!(seg.time_range.end > 0.0);

        // Verify first waypoint is at timestamp 0.0
        let first = &plan.merged_trajectory.waypoints()[0];
        let last = &plan.merged_trajectory.waypoints()[plan.waypoint_count - 1];
        assert_eq!(first.timestamp(), 0.0);
        assert!((last.timestamp() - plan.duration).abs() < 1e-9);

        // Verify source preservation
        match &seg.source {
            MotionSegment::MoveJ { target, .. } => {
                assert_eq!(target, &vec![1.0, 1.0]);
            }
            _ => panic!("expected MoveJ"),
        }
    }

    #[test]
    fn compile_two_movej_segments() {
        let h = TestHarness::new();
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let program = MotionProgram::new(vec![
            MotionSegment::MoveJ {
                target: vec![1.0, 0.5],
                max_velocity: None,
                max_acceleration: None,
            },
            MotionSegment::MoveJ {
                target: vec![0.0, 1.0],
                max_velocity: None,
                max_acceleration: None,
            },
        ]);

        let plan = compiler.compile(&program, &h.ctx()).expect("compile failed");
        assert_eq!(plan.segments.len(), 2);
        assert_eq!(plan.waypoint_count, plan.merged_trajectory.len());

        // Verify segment 1 waypoint range
        let seg0 = &plan.segments[0];
        let seg1 = &plan.segments[1];
        assert_eq!(seg0.waypoint_range.start, 0);
        assert_eq!(seg1.waypoint_range.end, plan.waypoint_count);
        assert_eq!(seg0.waypoint_range.end, seg1.waypoint_range.start);

        // Verify concatenated timestamps are monotonic
        let waypoints = plan.merged_trajectory.waypoints();
        for i in 1..waypoints.len() {
            assert!(
                waypoints[i].timestamp() >= waypoints[i - 1].timestamp(),
                "timestamps must be monotonic at index {}",
                i
            );
        }

        // Verify segment 1 time range starts after segment 0
        assert_eq!(seg0.time_range.start, 0.0);
        assert_eq!(seg1.time_range.start, seg0.time_range.end);
    }

    #[test]
    fn compile_two_movej_first_waypoint_matches_start_state() {
        let h = TestHarness::new();
        let compiler = PlanCompiler::new(Box::new(DefaultPlannerDispatcher::default()));
        let program = MotionProgram::new(vec![
            MotionSegment::MoveJ { target: vec![1.0, 0.5], max_velocity: None, max_acceleration: None },
            MotionSegment::MoveJ { target: vec![0.0, 1.0], max_velocity: None, max_acceleration: None },
        ]);

        let plan = compiler.compile(&program, &h.ctx()).expect("compile failed");

        let wps = plan.merged_trajectory.waypoints();
        // First waypoint must be the start position [0, 0], NOT the final target
        assert_eq!(wps[0].joints(), &[0.0, 0.0],
            "first waypoint must match start position, got {:?}", wps[0].joints());
    }

    /// A dispatcher that always fails with `InvalidGoal`.
    struct FailingDispatcher;

    impl MotionPlannerDispatcher for FailingDispatcher {
        fn plan_segment(
            &self,
            _segment: &MotionSegment,
            _ctx: &PlanningContext,
        ) -> Result<Trajectory, PlanningError> {
            Err(PlanningError::InvalidGoal("always fails".into()))
        }
    }

    #[test]
    fn compile_fails_atomically_on_segment_error() {
        let h = TestHarness::new();
        let compiler = PlanCompiler::new(Box::new(FailingDispatcher));
        let program = MotionProgram::new(vec![
            MotionSegment::MoveJ {
                target: vec![0.5, 0.5],
                max_velocity: None,
                max_acceleration: None,
            },
            MotionSegment::MoveJ {
                target: vec![1.0, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
        ]);

        // Set state to something non-zero so the first segment also fails
        let err = compiler.compile(&program, &h.ctx()).expect_err("should fail");
        assert_eq!(err.segment_index, 0);
        assert_eq!(err.segment_1based(), 1);
        assert_eq!(err.to_string(), "segment 1 failed: Invalid goal: always fails");
    }

    #[test]
    fn compile_fails_on_second_segment() {
        /// Dispatcher: first segment succeeds, second fails.
        struct FailingSecondDispatcher;

        impl MotionPlannerDispatcher for FailingSecondDispatcher {
            fn plan_segment(
                &self,
                segment: &MotionSegment,
                ctx: &PlanningContext,
            ) -> Result<Trajectory, PlanningError> {
                // Let the first segment through
                match segment {
                    MotionSegment::MoveJ { target, .. } if target == &vec![0.5, 0.5] => {
                        DefaultPlannerDispatcher::default().plan_segment(segment, ctx)
                    }
                    _ => Err(PlanningError::InvalidGoal("second segment fails".into())),
                }
            }
        }

        let h = TestHarness::new();
        let compiler = PlanCompiler::new(Box::new(FailingSecondDispatcher));
        let program = MotionProgram::new(vec![
            MotionSegment::MoveJ {
                target: vec![0.5, 0.5],
                max_velocity: None,
                max_acceleration: None,
            },
            MotionSegment::MoveJ {
                target: vec![1.0, 0.0],
                max_velocity: None,
                max_acceleration: None,
            },
        ]);

        let err = compiler.compile(&program, &h.ctx()).expect_err("second segment should fail");
        assert_eq!(err.segment_index, 1);
        assert_eq!(err.segment_1based(), 2);
        assert_eq!(err.to_string(), "segment 2 failed: Invalid goal: second segment fails");
    }
}
