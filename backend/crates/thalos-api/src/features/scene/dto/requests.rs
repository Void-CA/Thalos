use serde::Deserialize;

use thalos_core::{
    kinematics::inverse::IKGoal,
    models::{RobotModel, RobotModelError},
    spatial::{frame::FrameId, pose::Pose},
};
use thalos_math::{Quaternion, Transform3D, UnitQuaternion, Vector3};
use thalos_planning::motion::program::MotionProgram;
use thalos_core::motion::segment::MotionSegment;
use thalos_runtime::commands::kinematics::KinematicsCommand;
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

// ── Motion program request ──

/// A single segment in a motion program request.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum MotionSegmentDto {
    #[serde(rename = "movej")]
    MoveJ {
        target: Vec<f64>,
        #[serde(default)]
        max_velocity: Option<f64>,
        #[serde(default)]
        max_acceleration: Option<f64>,
    },
    #[serde(rename = "movel")]
    MoveL {
        #[serde(default)]
        frame_id: Option<u64>,
        target: PoseTargetDto,
        #[serde(default)]
        max_velocity: Option<f64>,
    },
}

/// A request to compile and execute a multi-segment motion program.
#[derive(Debug, Deserialize)]
pub struct MotionPlanRequest {
    pub segments: Vec<MotionSegmentDto>,
}

impl MotionPlanRequest {
    /// Convert into a domain `MotionProgram`, resolving frame references
    /// against the given default end-effector frame.
    pub fn into_program(self, default_ee: FrameId) -> MotionProgram {
        let segments = self
            .segments
            .into_iter()
            .map(|s| s.into_segment(default_ee))
            .collect();
        MotionProgram::new(segments)
    }
}

impl MotionSegmentDto {
    fn into_segment(self, default_ee: FrameId) -> MotionSegment {
        match self {
            MotionSegmentDto::MoveJ {
                target,
                max_velocity,
                max_acceleration,
            } => MotionSegment::MoveJ {
                target,
                max_velocity,
                max_acceleration,
            },
            MotionSegmentDto::MoveL {
                frame_id,
                target,
                max_velocity,
            } => {
                let frame = frame_id.map_or(default_ee, FrameId::Id);
                let pose = target.to_pose(frame);
                MotionSegment::MoveL {
                    frame,
                    target_pose: pose,
                    max_velocity,
                }
            }
        }
    }
}

/// Import a robot from raw URDF source.
#[derive(Debug, Deserialize)]
pub struct LoadUrdfRobotRequest {
    pub urdf_source: String,
}

// ── Execution tick request ──

/// Request to advance execution by `dt` seconds.
#[derive(Debug, Deserialize)]
pub struct TickRequest {
    pub dt: f64,
}

/// Request to seek execution to a position.
#[derive(Debug, Deserialize)]
pub struct SeekRequest {
    /// Position as fraction 0.0–1.0.
    pub position: f64,
}

// ── TCP selection request ──

/// Request to select or clear the active Tool Center Point (TCP).
///
/// When `frame_id` is `Some`, sets the TCP to that frame with an optional offset.
/// When `frame_id` is `None`, clears the TCP (falls back to flange/end_effector).
#[derive(Debug, Deserialize)]
pub struct SelectToolFrameRequest {
    /// The frame to use as TCP base. `None` clears the TCP.
    #[serde(default)]
    pub frame_id: Option<u64>,
    /// Optional offset from the base frame. If `None`, uses identity transform.
    /// Format: `[x, y, z]` translation in meters.
    #[serde(default)]
    pub offset: Option<[f64; 3]>,
}

impl SelectToolFrameRequest {
    /// Convert into a Command to set or clear the active TCP.
    pub fn into_command(&self) -> Command {
        match self.frame_id {
            Some(frame_id) => {
                let base_frame = FrameId::Id(frame_id);
                let transform = match self.offset {
                    Some([x, y, z]) => {
                        Transform3D::from_translation(Vector3::new(x, y, z))
                    }
                    None => Transform3D::identity(),
                };
                let tcp = thalos_core::robot::tool_frame::ToolFrame::with_offset(
                    base_frame,
                    transform,
                );
                Command::SelectToolFrame(Some(tcp))
            }
            None => Command::SelectToolFrame(None),
        }
    }
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
        Command::Kinematics(KinematicsCommand::MoveToPosition { frame, target })
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
        Command::Kinematics(KinematicsCommand::MoveToPose { frame, target })
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
