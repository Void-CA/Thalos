use serde::Deserialize;

use thalos_core::{
    kinematics::inverse::IKGoal,
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
    /// Target pose with translation and rotation.
    pub target: PoseTargetDto,
}

#[derive(Debug, Deserialize)]
pub struct PoseTargetDto {
    /// Translation `[x, y, z]` in world coordinates.
    pub translation: [f64; 3],
    /// Rotation expressed in the chosen representation. Conversion to
    /// `UnitQuaternion` happens once in `to_pose`, so all downstream code
    /// (IK solver, scene building) keeps working in the canonical form.
    pub rotation: RotationDto,
}

/// Rotation input — the client picks the representation that fits the user.
///
/// Wire format (serde tagged enum):
/// ```json
/// { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
/// { "kind": "Ypr",        "value": { "roll": 0.0, "pitch": 0.0, "yaw": 0.0 } }
/// ```
///
/// `Ypr` uses ZYX intrinsic order — i.e. roll around X, then pitch around Y,
/// then yaw around Z — matching `thalos_core::UnitQuaternion::from_euler` and
/// `to_euler`. Angles are in radians; the client converts to/from degrees
/// for display.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", content = "value")]
pub enum RotationDto {
    /// Unit quaternion `[w, x, y, z]`.
    Quaternion { w: f64, x: f64, y: f64, z: f64 },
    /// ZYX Euler angles (roll, pitch, yaw) in radians.
    Ypr { roll: f64, pitch: f64, yaw: f64 },
}

#[derive(Debug, Deserialize)]
pub struct ExecuteIKRequest {
    pub joint_angles: Vec<f64>,
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

    /// Build an IKGoal from this request (no Command wrapping).
    pub fn to_ik_goal(&self, default_ee: FrameId) -> (FrameId, IKGoal) {
        let frame = self.frame_id.map_or(default_ee, FrameId::Id);
        let target = Vector3::new(self.target[0], self.target[1], self.target[2]);
        (frame, IKGoal::Position(target))
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

    /// Build an IKGoal from this request (no Command wrapping).
    pub fn to_ik_goal(&self, default_ee: FrameId) -> (FrameId, IKGoal) {
        let frame = self.frame_id.map_or(default_ee, FrameId::Id);
        let target = self.target.to_pose(frame);
        (frame, IKGoal::Pose(target))
    }
}

impl PoseTargetDto {
    pub fn to_pose(&self, target_frame: FrameId) -> Pose {
        let [tx, ty, tz] = self.translation;
        let translation = Vector3::new(tx, ty, tz);

        // Single source of truth: the core owns the math. Whether the client
        // sent a quaternion or ZYX Euler angles, the conversion to a unit
        // quaternion goes through the core (`UnitQuaternion::new` /
        // `UnitQuaternion::from_euler`). No duplicated trig here.
        let rotation = match self.rotation {
            RotationDto::Quaternion { w, x, y, z } => {
                let q = Quaternion::new(w, x, y, z);
                UnitQuaternion::new(q.normalize_or_identity())
                    .unwrap_or_else(|_| UnitQuaternion::identity())
            }
            RotationDto::Ypr { roll, pitch, yaw } => {
                UnitQuaternion::from_euler(roll, pitch, yaw)
            }
        };

        let transform = Transform3D {
            translation,
            rotation,
        };

        Pose::new(FrameId::World, target_frame, transform)
    }
}
