use serde::Deserialize;

use thalos_core::{
    math::geometry::{
        rigid::Transform3D,
        rotations::{Quaternion, UnitQuaternion},
        vectors::Vector3,
    },
    models::{RobotModel, RobotModelError},
    spatial::{frame::FrameId, pose::Pose},
};
use thalos_runtime::Command;

use super::responses::VisualSceneDto;

// ── Existing request DTOs ──

#[derive(Deserialize)]
pub struct SetJointsRequest {
    pub joint_angles: Vec<f64>,
}

#[derive(Deserialize)]
pub struct ValidateRequest {
    pub scene: VisualSceneDto,
}

#[derive(Deserialize)]
pub struct DiffRequest {
    pub old: VisualSceneDto,
    pub new: VisualSceneDto,
    #[serde(default = "default_epsilon")]
    pub epsilon: f64,
}

#[derive(Debug, Deserialize)]
pub struct LoadRobotRequest {
    pub robot_id: String,
}

// ── IK motion request DTOs ──

/// Target frame reference for IK commands.
///
/// - `None` → use the active robot's end effector.
/// - `Some(id)` → target a specific frame by its numeric index.
#[derive(Debug, Deserialize)]
pub struct MoveToPositionRequest {
    /// Which frame to move (defaults to end effector if `None`).
    #[serde(default)]
    pub frame_id: Option<u64>,
    /// Target position `[x, y, z]` in world coordinates.
    pub target: [f64; 3],
}

#[derive(Debug, Deserialize)]
pub struct MoveToPoseRequest {
    /// Which frame to move (defaults to end effector if `None`).
    #[serde(default)]
    pub frame_id: Option<u64>,
    /// Target pose with translation and rotation (quaternion `[w, x, y, z]`).
    pub target: PoseTargetDto,
}

#[derive(Debug, Deserialize)]
pub struct PoseTargetDto {
    /// Translation `[x, y, z]` in world coordinates.
    pub translation: [f64; 3],
    /// Unit quaternion `[w, x, y, z]` for orientation.
    pub rotation: [f64; 4],
}

fn default_epsilon() -> f64 {
    1e-6
}


// ── DTO → Command conversions ──

impl LoadRobotRequest {
    /// Resolve the robot model and build a `LoadRobot` command.
    pub fn into_command(&self) -> Result<Command, RobotModelError> {
        RobotModel::from_id(&self.robot_id).map(Command::LoadRobot)
    }
}

// ── DTO → Domain conversions ──

impl MoveToPositionRequest {
    /// Build a Command from this request, resolving `frame_id` against the
    /// active robot's end effector when `None`.
    pub fn into_command(&self, default_ee: FrameId) -> Command {
        let frame = self.frame_id.map_or(default_ee, FrameId::Id);
        let target = Vector3::new(self.target[0], self.target[1], self.target[2]);
        Command::MoveToPosition { frame, target }
    }
}

impl MoveToPoseRequest {
    /// Build a Command from this request, resolving `frame_id` against the
    /// active robot's end effector when `None`.
    pub fn into_command(&self, default_ee: FrameId) -> Command {
        let frame = self.frame_id.map_or(default_ee, FrameId::Id);
        let target = self.target.to_pose(frame);
        Command::MoveToPose { frame, target }
    }
}

impl PoseTargetDto {
    fn to_pose(&self, target_frame: FrameId) -> Pose {
        let [tx, ty, tz] = self.translation;
        let [qw, qx, qy, qz] = self.rotation;

        let translation = Vector3::new(tx, ty, tz);
        let q = Quaternion::new(qw, qx, qy, qz);
        let rotation = UnitQuaternion::new(q.normalize_or_identity())
            .unwrap_or(UnitQuaternion::identity());

        let transform = Transform3D {
            translation,
            rotation,
        };

        Pose::new(FrameId::World, target_frame, transform)
    }
}
