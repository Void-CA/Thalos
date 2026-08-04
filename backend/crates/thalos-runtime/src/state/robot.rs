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

use crate::error::RuntimeError;
use crate::snapshots::scene::JointMeta;
pub use thalos_core::prelude::ActiveRobot;

use crate::plan::{ActiveMotionPlan, MotionType};

const IK_MAX_ITERS: usize = 500;
const IK_TOLERANCE: f64 = 1e-6;
const IK_LAMBDA: f64 = 0.1;

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
