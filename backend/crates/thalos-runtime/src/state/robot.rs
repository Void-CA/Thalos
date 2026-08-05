use thalos_core::robot::tool_frame::ToolFrame;
use thalos_core::spatial::frame::FrameId;
use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        inverse::{DampedLeastSquaresSolver, IKGoal, IKResult, IKSolver, IkError},
    },
    prelude::Trajectory,
};
use thalos_models::Robot;
use thalos_planning::motion::program::CompiledPlan;
use thalos_planning::program_edit::ProgramEdit;

use crate::error::RuntimeError;
use crate::snapshots::scene::JointMeta;
pub use thalos_core::prelude::ActiveRobot;

use crate::plan::{ActiveMotionPlan, MotionType};

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

/// Feature gate name for the scene write-back surface (design D5).
///
/// `replace_active_plan` is the FIRST runtime-mutating surface introduced by
/// the analysis-advisor change. The flag is OFF by default — enable
/// per-environment only after integration tests pass. Rollback-safe: flipping
/// the flag off restores the previous read-only behavior with zero code
/// changes.
pub const SCENE_WRITEBACK_FLAG: &str = "scene-writeback";

/// A command applied to the runtime, with its pre-computed inverse (D6).
///
/// PR4 stores the inverse in memory so PR5 can implement `undo` in O(1) via
/// `apply(inverse)` — no replay, no re-derivation. The undo endpoint lands in
/// PR5; the history Vec lives on `SceneRuntime` close to the mutation surface.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedCommand {
    /// The semantic edit that was applied.
    pub command: ProgramEdit,
    /// The edit that restores the previous program (`command.inverse()`).
    pub inverse: ProgramEdit,
}

/// Runtime state — plans, IK, and robot metadata.
///
/// Trajectory execution is delegated to the active `RobotController`
/// via `BackendManager`. This struct manages only plan metadata and
/// the kinematic model.
pub struct SceneRuntime {
    pub active_robot: ActiveRobot,
    pub robot_name: String,
    /// Canonical robot identity (spec robot-identity R1): catalog robots
    /// carry `metadata.id`; URDF imports carry `urdf:<sha256-trunc-12>`.
    /// Single source for every consumer — snapshots and the API DTO.
    pub robot_id: String,
    /// Original URDF model — `None` for built-in robots, `Some` for imports.
    pub robot_source: Option<Robot>,
    pub joints_meta: Vec<JointMeta>,

    /// Active Tool Center Point (TCP) frame.
    ///
    /// When `Some`, all analysis (workspace, singularity, manipulability)
    /// and IK default to this TCP instead of the flange (`chain.end_effector`).
    /// When `None`, the flange is used as the default working frame.
    pub active_tcp: Option<ToolFrame>,

    /// The compiled plan ready for visualisation and execution.
    /// Set by Preview — immutable, carries trajectory + segments.
    pub scheduled_plan: Option<CompiledPlan>,

    /// Active plan for snapshot backward compatibility.
    pub active_plan: Option<ActiveMotionPlan>,

    /// Feature gate for the scene write-back surface (design D5).
    ///
    /// OFF by default. `replace_active_plan` refuses to mutate the runtime
    /// while this flag is disabled — rollback = flip the flag off.
    scene_writeback_enabled: bool,

    /// Applied command history (design D6): pre-computed inverses, in apply
    /// order. PR5's `undo` pops the last entry in O(1) and applies its
    /// inverse. Stored in memory — no persistence in PR4.
    command_history: Vec<AppliedCommand>,

    next_plan_id: u64,
}

impl SceneRuntime {
    pub fn new(active_robot: ActiveRobot, robot_name: String) -> Self {
        // Initial identity derives from the catalog model when present
        // (design D4: explicit field, single writer via commands).
        let robot_id = active_robot
            .model
            .map(|m| m.metadata().id.to_string())
            .unwrap_or_default();
        Self {
            active_robot,
            robot_name,
            robot_id,
            robot_source: None,
            joints_meta: Vec::new(),
            active_tcp: None,
            scheduled_plan: None,
            active_plan: None,
            scene_writeback_enabled: false,
            command_history: Vec::new(),
            next_plan_id: 0,
        }
    }

    /// Update `active_robot.joints` from a controller state (e.g. simulation tick).
    pub fn set_joints_from_state(&mut self, joints: &[f64]) {
        if joints.len() == self.active_robot.joints.len() {
            self.active_robot.joints.copy_from_slice(joints);
        }
    }

    pub fn solve_and_apply_ik(
        &mut self,
        frame: FrameId,
        goal: IKGoal,
    ) -> Result<IKResult, IkError> {
        let fk = ForwardKinematics::new(self.active_robot.chain.clone());
        let solver =
            DampedLeastSquaresSolver::new(fk, frame, IK_MAX_ITERS, IK_TOLERANCE, IK_LAMBDA);
        let q0 = self.active_robot.joints.clone();
        let result = solver.solve(&q0, goal)?;
        self.active_robot.joints = result.q.clone();
        Ok(result)
    }

    // ── Single-shot plan setters (MoveJ / MoveL) ──

    pub fn set_completed_plan(
        &mut self,
        trajectory: impl Into<Trajectory>,
        motion_type: MotionType,
    ) {
        let tid = self.next_plan_id();
        self.active_plan = Some(ActiveMotionPlan::completed(
            tid,
            trajectory.into(),
            motion_type,
        ));
    }

    pub fn set_created_plan(&mut self, trajectory: impl Into<Trajectory>, motion_type: MotionType) {
        let tid = self.next_plan_id();
        self.active_plan = Some(ActiveMotionPlan::created(
            tid,
            trajectory.into(),
            motion_type,
        ));
    }

    // ── Multi-segment program (Preview / Execution) ──

    /// Schedule a compiled multi-segment program for preview and optional execution.
    pub fn schedule_plan(&mut self, compiled: CompiledPlan) {
        let tid = self.next_plan_id();
        self.scheduled_plan = Some(compiled.clone());
        self.active_plan = Some(ActiveMotionPlan::from_compiled_plan(tid, compiled));
    }

    pub fn clear_plan(&mut self) {
        self.scheduled_plan = None;
        self.active_plan = None;
    }

    // ── Scene write-back (PR4 — first runtime-mutating surface, D4/D5) ──

    /// Read the scene-writeback feature flag (design D5).
    pub fn scene_writeback_enabled(&self) -> bool {
        self.scene_writeback_enabled
    }

    /// Enable/disable the scene-writeback feature flag (design D5).
    ///
    /// Default is OFF. Enable per-environment after integration tests pass.
    pub fn set_scene_writeback(&mut self, enabled: bool) {
        self.scene_writeback_enabled = enabled;
    }

    /// Replace the active plan with a recompiled plan (design D4).
    ///
    /// This is the FIRST surface that mutates the runtime from outside the
    /// command pipeline, so it is deliberately conservative:
    /// 1. Feature gate (D5): while `scene-writeback` is disabled the method
    ///    errors and mutates NOTHING — rollback is a flag flip.
    /// 2. Snapshot (D4): the complete previous plan (scheduled_plan +
    ///    active_plan) is cloned BEFORE any mutation.
    /// 3. Validation: the replacement must be a real plan (non-empty,
    ///    non-zero duration) — an empty plan is rejected.
    /// 4. Restore: if any step fails, the snapshot is written back so the
    ///    runtime is byte-for-byte as before the call.
    ///
    /// Because `scheduled_plan` is the source for `trajectory_to_waypoints`
    /// (scene.rs), the write-back propagates to execution automatically.
    pub fn replace_active_plan(&mut self, compiled: CompiledPlan) -> Result<(), RuntimeError> {
        // 1. Feature gate (D5): flag OFF → error, NO mutation.
        if !self.scene_writeback_enabled {
            return Err(RuntimeError::FeatureDisabled {
                feature: SCENE_WRITEBACK_FLAG,
            });
        }

        // 2. Snapshot (D4): complete previous plan — scheduled + active.
        let snapshot = (self.scheduled_plan.clone(), self.active_plan.clone());

        // 3+4. Fallible steps run BEFORE the commit point; on ANY error the
        // snapshot is restored so the runtime is left exactly as before.
        let result = self.replace_active_plan_inner(compiled);
        if let Err(err) = result {
            self.scheduled_plan = snapshot.0;
            self.active_plan = snapshot.1;
            return Err(err);
        }
        Ok(())
    }

    /// Fallible core of the replacement. Only `Ok` commits; the caller
    /// restores the snapshot on `Err`.
    fn replace_active_plan_inner(
        &mut self,
        compiled: CompiledPlan,
    ) -> Result<(), RuntimeError> {
        if compiled.waypoint_count == 0 || compiled.duration <= 0.0 {
            return Err(RuntimeError::InvalidCompiledPlan {
                reason: format!(
                    "compiled plan carries {} waypoints and {:.3}s of motion",
                    compiled.waypoint_count, compiled.duration
                ),
            });
        }
        let tid = self.next_plan_id();
        self.scheduled_plan = Some(compiled.clone());
        self.active_plan = Some(ActiveMotionPlan::from_compiled_plan(tid, compiled));
        Ok(())
    }

    /// Record an applied command with its pre-computed inverse (D6).
    ///
    /// PR5's `undo` pops the last entry in O(1) and applies `inverse`.
    /// PR4 only stores the inverse in memory — the undo endpoint is PR5.
    pub fn record_applied_command(&mut self, command: ProgramEdit, inverse: ProgramEdit) {
        self.command_history.push(AppliedCommand { command, inverse });
    }

    /// Number of applied commands with stored inverses (undo history size).
    pub fn history_len(&self) -> usize {
        self.command_history.len()
    }

    fn next_plan_id(&mut self) -> String {
        let id = self.next_plan_id;
        self.next_plan_id += 1;
        format!("plan-{}", id)
    }

    // ── TCP selection ──

    /// Select or clear the active Tool Center Point (TCP).
    ///
    /// If `tool_frame` is `Some`, validates that the frame exists in the robot chain.
    /// If `tool_frame` is `None`, clears the TCP (falls back to flange).
    ///
    /// Returns an error if the frame does not exist in the chain.
    pub fn select_tool_frame(&mut self, tool_frame: Option<ToolFrame>) -> Result<(), RuntimeError> {
        if let Some(tcp) = &tool_frame {
            // Validate that the frame exists in the chain
            if self
                .active_robot
                .chain
                .frames
                .get(&tcp.base_frame)
                .is_none()
            {
                return Err(RuntimeError::ToolFrameNotFound {
                    frame_id: match tcp.base_frame {
                        FrameId::Id(id) => id,
                        FrameId::World => 0,
                    },
                });
            }
        }
        self.active_tcp = tool_frame;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::models::{RobotModel, RobotRegistry};
    use thalos_core::trajectory::TrajectoryPoint;

    fn test_runtime() -> SceneRuntime {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let active_robot = ActiveRobot::new(Some(RobotModel::Planar2R), chain, vec![0.0; 2]);
        SceneRuntime::new(active_robot, "test-bot".into())
    }

    /// A VALID compiled plan: two waypoints, non-zero duration, target `[t, t]`.
    fn compiled_plan(t: f64) -> CompiledPlan {
        let points = vec![
            TrajectoryPoint::new(vec![0.0, 0.0], 0.0),
            TrajectoryPoint::new(vec![t, t], 1.0),
        ];
        CompiledPlan::new(Trajectory::new(points), vec![])
    }

    /// An INVALID compiled plan: zero waypoints → fails replacement validation.
    fn empty_plan() -> CompiledPlan {
        CompiledPlan::new(Trajectory::new(vec![]), vec![])
    }

    /// Behavior-relevant signature of a CompiledPlan (Trajectory has no
    /// PartialEq — compare the actual trajectory data, not struct identity).
    fn compiled_signature(p: &CompiledPlan) -> (f64, usize, Vec<Vec<f64>>) {
        (
            p.duration,
            p.waypoint_count,
            p.merged_trajectory
                .waypoints()
                .iter()
                .map(|w| w.joints().to_vec())
                .collect(),
        )
    }

    /// Behavior-relevant signature of the active plan.
    fn active_signature(p: &ActiveMotionPlan) -> (String, Vec<Vec<f64>>) {
        (
            p.plan_id.clone(),
            p.trajectory.waypoints().iter().map(|w| w.joints().to_vec()).collect(),
        )
    }

    #[test]
    fn replace_active_plan_success_swaps_plan() {
        // Spec scene-writeback "Successful replacement": flag on + valid plan
        // → active_plan updated; snapshot of previous plan stored.
        let mut runtime = test_runtime();
        runtime.set_scene_writeback(true);
        runtime.schedule_plan(compiled_plan(1.0));
        let before = runtime.active_plan.clone();
        let before_id = before.as_ref().unwrap().plan_id.clone();

        runtime
            .replace_active_plan(compiled_plan(2.0))
            .expect("flag on + valid plan → replacement succeeds");

        let active = runtime.active_plan.clone().unwrap();
        assert_eq!(
            active.trajectory.waypoints().last().unwrap().joints(),
            &[2.0, 2.0],
            "active_plan must carry the NEW trajectory"
        );
        assert_ne!(
            active.plan_id, before_id,
            "replacement must allocate a NEW plan id"
        );
        assert_eq!(
            runtime
                .scheduled_plan
                .as_ref()
                .unwrap()
                .merged_trajectory
                .waypoints()
                .last()
                .unwrap()
                .joints(),
            &[2.0, 2.0],
            "scheduled_plan must carry the NEW compiled plan"
        );
    }

    #[test]
    fn replace_active_plan_failure_restores_previous_plan() {
        // Spec scene-writeback "Failure rollback" + "Snapshot integrity": a
        // compiled plan that fails validation must leave the runtime exactly
        // as before — the complete previous plan (trajectory + duration) is
        // restored from the snapshot.
        let mut runtime = test_runtime();
        runtime.set_scene_writeback(true);
        runtime.schedule_plan(compiled_plan(1.0));
        let before_scheduled = runtime.scheduled_plan.clone();
        let before_active = runtime.active_plan.clone();

        let err = runtime
            .replace_active_plan(empty_plan())
            .expect_err("empty plan must fail validation");
        assert!(
            matches!(err, RuntimeError::InvalidCompiledPlan { .. }),
            "empty plan must produce InvalidCompiledPlan, got {err:?}"
        );

        assert_eq!(
            compiled_signature(runtime.scheduled_plan.as_ref().unwrap()),
            compiled_signature(before_scheduled.as_ref().unwrap()),
            "scheduled_plan must be restored (snapshot integrity)"
        );
        assert_eq!(
            active_signature(runtime.active_plan.as_ref().unwrap()),
            active_signature(before_active.as_ref().unwrap()),
            "active_plan must be restored (snapshot integrity)"
        );
        assert_eq!(
            runtime.scheduled_plan.as_ref().unwrap().duration,
            before_scheduled.as_ref().unwrap().duration,
            "snapshot must preserve the previous plan duration"
        );
    }

    #[test]
    fn replace_active_plan_flag_off_errors_without_mutation() {
        // Spec scene-writeback "Flag disabled" (D5): default flag OFF → error,
        // active_plan unchanged, scheduled_plan unchanged.
        let mut runtime = test_runtime();
        assert!(
            !runtime.scene_writeback_enabled(),
            "scene-writeback flag must default to OFF (D5)"
        );
        runtime.schedule_plan(compiled_plan(1.0));
        let before_active = runtime.active_plan.clone();
        let before_scheduled = runtime.scheduled_plan.clone();

        let err = runtime
            .replace_active_plan(compiled_plan(2.0))
            .expect_err("flag off → replace must error");
        assert!(
            matches!(
                err,
                RuntimeError::FeatureDisabled {
                    feature: "scene-writeback"
                }
            ),
            "flag-off error must name the scene-writeback feature, got {err:?}"
        );

        assert_eq!(
            active_signature(runtime.active_plan.as_ref().unwrap()),
            active_signature(before_active.as_ref().unwrap()),
            "flag-off must NOT mutate the active plan"
        );
        assert_eq!(
            compiled_signature(runtime.scheduled_plan.as_ref().unwrap()),
            compiled_signature(before_scheduled.as_ref().unwrap()),
            "flag-off must NOT mutate the scheduled plan"
        );
    }

    #[test]
    fn replace_active_plan_flag_on_proceeds() {
        // Spec scene-writeback "Flag enabled": flag on + valid plan → replacement
        // proceeds normally.
        let mut runtime = test_runtime();
        runtime.set_scene_writeback(true);
        runtime.schedule_plan(compiled_plan(1.0));

        runtime
            .replace_active_plan(compiled_plan(2.0))
            .expect("flag on + valid plan → replacement proceeds");
    }

    #[test]
    fn replace_active_plan_failure_after_success_restores_latest_plan() {
        // Triangulation: the snapshot is taken PER CALL — a failure after an
        // earlier success must restore the LATEST committed plan, not the
        // original one.
        let mut runtime = test_runtime();
        runtime.set_scene_writeback(true);
        runtime.schedule_plan(compiled_plan(1.0));
        runtime.replace_active_plan(compiled_plan(2.0)).unwrap();
        let after_second = runtime.scheduled_plan.clone();

        let err = runtime
            .replace_active_plan(empty_plan())
            .expect_err("empty plan must fail validation");
        assert!(matches!(err, RuntimeError::InvalidCompiledPlan { .. }));
        assert_eq!(
            compiled_signature(runtime.scheduled_plan.as_ref().unwrap()),
            compiled_signature(after_second.as_ref().unwrap()),
            "restore must bring back the LATEST committed plan"
        );
    }
}
