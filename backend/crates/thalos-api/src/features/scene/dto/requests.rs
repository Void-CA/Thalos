use serde::Deserialize;

use thalos_core::motion::segment::MotionSegment;
use thalos_core::{
    ids::OperationId,
    kinematics::inverse::IKGoal,
    models::{RobotModel, RobotModelError},
    operation::{Operation, OperationConstraints},
    spatial::{frame::FrameId, pose::Pose},
};
use thalos_math::{Quaternion, Transform3D, UnitQuaternion, Vector3};
use thalos_planning::motion::program::PlanningProgram;
use thalos_runtime::Command;
use thalos_runtime::commands::kinematics::KinematicsCommand;

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
    /// Rotation expressed in the chosen representation. `None` means
    /// position-only targeting — orientation is left unconstrained (the
    /// planner drives IK with `IKGoal::Position`).
    #[serde(default)]
    pub rotation: Option<RotationDto>,
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
    /// Author segments — legacy path, kept for backward compatibility.
    /// Optional so `operations`-only requests are accepted; when both are
    /// present, the semantic `operations` path takes precedence.
    #[serde(default)]
    pub segments: Vec<MotionSegmentDto>,
    /// Semantic Operation IR — when present, `preview_plan()` routes through
    /// `compile_with_operations()` instead of raw `compile()`.
    #[serde(default)]
    pub operations: Option<Vec<OperationDto>>,
}

impl MotionPlanRequest {
    /// Convert into a domain `PlanningProgram` (IR-2), resolving frame
    /// references against the given default end-effector frame.
    pub fn into_program(self, default_ee: FrameId) -> PlanningProgram {
        let segments = self
            .segments
            .into_iter()
            .map(|s| s.into_segment(default_ee))
            .collect();
        PlanningProgram::new(segments)
    }
}

impl MotionSegmentDto {
    /// Segments authored directly on the wire (no semantic IR-0 operation).
    /// They carry a fixed placeholder origin so invariant I2 stays intact
    /// for every `MotionSegment` in the system.
    const MANUAL_ORIGIN: &'static str = "manual";

    fn into_segment(self, default_ee: FrameId) -> MotionSegment {
        match self {
            MotionSegmentDto::MoveJ {
                target,
                max_velocity,
                max_acceleration,
            } => MotionSegment::MoveJ {
                origin: OperationId(Self::MANUAL_ORIGIN.into()),
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
                if target.rotation.is_some() {
                    let pose = target.to_pose(frame);
                    MotionSegment::MoveL {
                        origin: OperationId(Self::MANUAL_ORIGIN.into()),
                        frame,
                        target_pose: pose,
                        max_velocity,
                    }
                } else {
                    MotionSegment::MoveLPosition {
                        origin: OperationId(Self::MANUAL_ORIGIN.into()),
                        frame,
                        target_position: target.translation,
                        max_velocity,
                    }
                }
            }
        }
    }
}

// ── Semantic Operation IR (PR 3) ────────────────────────────────────

/// Constraint envelope for an operation on the wire.
///
/// Mirrors the subset of `OperationConstraints` the frontend authors today.
/// `JointDeviationLimit`, approach and retreat directions are deferred to a
/// future change (see design open questions).
#[derive(Debug, Default, Deserialize)]
pub struct OperationConstraintsDto {
    #[serde(default)]
    pub position_tolerance: Option<f64>,
    #[serde(default)]
    pub orientation_tolerance: Option<f64>,
    #[serde(default)]
    pub velocity_limit: Option<f64>,
}

/// A semantic work unit in the Operation IR, as authored by the frontend.
///
/// Mirrors `thalos_core::operation::Operation` on the wire. When
/// `MotionPlanRequest.operations` is present, `preview_plan()` compiles the
/// program through `compile_with_operations()` (preserving provenance and
/// constraints); when absent, the legacy `segments` path is used unchanged.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum OperationDto {
    #[serde(rename = "pick")]
    Pick {
        id: u64,
        #[serde(default)]
        frame_id: Option<u64>,
        target: PoseTargetDto,
        #[serde(default)]
        constraints: OperationConstraintsDto,
    },
    #[serde(rename = "place")]
    Place {
        id: u64,
        #[serde(default)]
        frame_id: Option<u64>,
        target: PoseTargetDto,
        #[serde(default)]
        constraints: OperationConstraintsDto,
    },
    #[serde(rename = "transit")]
    Transit {
        id: u64,
        #[serde(default)]
        frame_id: Option<u64>,
        target: PoseTargetDto,
        #[serde(default)]
        constraints: OperationConstraintsDto,
    },
}

impl OperationDto {
    /// Convert into a domain `Operation` (IR), resolving the target pose
    /// against the explicit `frame_id` or the default end-effector frame.
    pub fn into_operation(self, default_ee: FrameId) -> Operation {
        match self {
            OperationDto::Pick {
                id,
                frame_id,
                target,
                constraints,
            } => Operation::Pick {
                id: OperationId(id.to_string()),
                target_pose: target.to_pose(frame_id.map_or(default_ee, FrameId::Id)),
                constraints: constraints.into_constraints(),
            },
            OperationDto::Place {
                id,
                frame_id,
                target,
                constraints,
            } => Operation::Place {
                id: OperationId(id.to_string()),
                target_pose: target.to_pose(frame_id.map_or(default_ee, FrameId::Id)),
                constraints: constraints.into_constraints(),
            },
            OperationDto::Transit {
                id,
                frame_id,
                target,
                constraints,
            } => Operation::Transit {
                id: OperationId(id.to_string()),
                target_pose: target.to_pose(frame_id.map_or(default_ee, FrameId::Id)),
                constraints: constraints.into_constraints(),
            },
        }
    }
}

impl OperationConstraintsDto {
    fn into_constraints(self) -> OperationConstraints {
        OperationConstraints {
            position_tolerance: self.position_tolerance,
            orientation_tolerance: self.orientation_tolerance,
            joint_deviation_limit: None,
            velocity_limit: self.velocity_limit,
            approach_direction: None,
            retreat_direction: None,
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
                    Some([x, y, z]) => Transform3D::from_translation(Vector3::new(x, y, z)),
                    None => Transform3D::identity(),
                };
                let tcp =
                    thalos_core::robot::tool_frame::ToolFrame::with_offset(base_frame, transform);
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
            Some(RotationDto::Quaternion { w, x, y, z }) => {
                let q = Quaternion::new(w, x, y, z);
                UnitQuaternion::new(q.normalize_or_identity())
                    .unwrap_or_else(|_| UnitQuaternion::identity())
            }
            Some(RotationDto::Ypr { roll, pitch, yaw }) => {
                UnitQuaternion::from_euler(roll, pitch, yaw)
            }
            // Position-only target: identity rotation, only the translation is meaningful.
            None => UnitQuaternion::identity(),
        };

        let transform = Transform3D {
            translation,
            rotation,
        };

        Pose::new(FrameId::World, target_frame, transform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use thalos_core::operation::Operation;

    fn operation_json(type_name: &str, id: u64) -> Value {
        json!({
            "type": type_name,
            "id": id,
            "target": {
                "translation": [0.3, 0.4, 0.0],
                "rotation": { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
            }
        })
    }

    // ── OperationDto deserialization ──────────────────────

    #[test]
    fn operation_dto_pick_deserializes_with_tag_and_constraints() {
        let raw = json!({
            "type": "pick",
            "id": 7,
            "target": {
                "translation": [0.3, 0.4, 0.0],
                "rotation": { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
            },
            "constraints": { "position_tolerance": 0.01, "velocity_limit": 0.5 }
        });
        let dto: OperationDto = serde_json::from_value(raw).expect("pick must deserialize");
        match dto {
            OperationDto::Pick {
                id,
                target,
                constraints,
                ..
            } => {
                assert_eq!(id, 7);
                assert_eq!(target.translation, [0.3, 0.4, 0.0]);
                assert_eq!(constraints.position_tolerance, Some(0.01));
                assert_eq!(constraints.velocity_limit, Some(0.5));
                assert_eq!(constraints.orientation_tolerance, None);
            }
            other => panic!("expected Pick, got {other:?}"),
        }
    }

    #[test]
    fn operation_dto_place_and_transit_deserialize() {
        let place: OperationDto = serde_json::from_value(operation_json("place", 8))
            .expect("place must deserialize");
        assert!(matches!(place, OperationDto::Place { id: 8, .. }));

        let transit: OperationDto = serde_json::from_value(operation_json("transit", 9))
            .expect("transit must deserialize");
        assert!(matches!(transit, OperationDto::Transit { id: 9, .. }));
    }

    #[test]
    fn operation_dto_constraints_default_when_absent() {
        let dto: OperationDto = serde_json::from_value(operation_json("pick", 1))
            .expect("pick without constraints must deserialize");
        match dto {
            OperationDto::Pick { constraints, .. } => {
                assert_eq!(constraints.position_tolerance, None);
                assert_eq!(constraints.orientation_tolerance, None);
                assert_eq!(constraints.velocity_limit, None);
            }
            other => panic!("expected Pick, got {other:?}"),
        }
    }

    // ── MotionPlanRequest backward compatibility ─────────

    #[test]
    fn motion_plan_request_without_operations_defaults_none() {
        // Legacy frontend payload: only `segments`, no `operations`.
        let raw = json!({
            "segments": [ { "type": "movej", "target": [1.0, 0.5] } ]
        });
        let req: MotionPlanRequest =
            serde_json::from_value(raw).expect("legacy payload must deserialize");
        assert!(req.operations.is_none(), "operations must default to None");
        assert_eq!(req.segments.len(), 1);
    }

    #[test]
    fn motion_plan_request_with_operations_deserializes() {
        let raw = json!({
            "segments": [],
            "operations": [ operation_json("pick", 1) ]
        });
        let req: MotionPlanRequest = serde_json::from_value(raw).expect("must deserialize");
        let ops = req.operations.expect("operations must be Some");
        assert_eq!(ops.len(), 1);
        assert!(matches!(ops[0], OperationDto::Pick { .. }));
    }

    // ── OperationDto → Operation conversion ───────────────

    #[test]
    fn operation_dto_into_operation_maps_domain_fields() {
        let raw = json!({
            "type": "pick",
            "id": 42,
            "frame_id": 3,
            "target": {
                "translation": [0.3, 0.4, 0.0],
                "rotation": { "kind": "Quaternion", "value": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 } }
            },
            "constraints": {
                "position_tolerance": 0.01,
                "orientation_tolerance": 0.02,
                "velocity_limit": 0.5
            }
        });
        let dto: OperationDto = serde_json::from_value(raw).unwrap();
        let op = dto.into_operation(FrameId::Id(9));
        match op {
            Operation::Pick {
                id,
                target_pose,
                constraints,
            } => {
                assert_eq!(id, OperationId("42".to_string()));
                assert_eq!(
                    target_pose.target_id(),
                    FrameId::Id(3),
                    "explicit frame_id must win over the default"
                );
                assert_eq!(constraints.position_tolerance, Some(0.01));
                assert_eq!(constraints.orientation_tolerance, Some(0.02));
                assert_eq!(constraints.velocity_limit, Some(0.5));
                assert!(
                    constraints.joint_deviation_limit.is_none(),
                    "deferred constraint fields stay None"
                );
            }
            other => panic!("expected Operation::Pick, got {other:?}"),
        }
    }

    #[test]
    fn operation_dto_into_operation_resolves_default_frame() {
        let dto: OperationDto = serde_json::from_value(operation_json("transit", 5)).unwrap();
        let op = dto.into_operation(FrameId::Id(9));
        match op {
            Operation::Transit {
                id,
                target_pose,
                constraints,
            } => {
                assert_eq!(id, OperationId("5".to_string()));
                assert_eq!(
                    target_pose.target_id(),
                    FrameId::Id(9),
                    "missing frame_id falls back to the default end effector"
                );
                assert!(constraints.position_tolerance.is_none());
            }
            other => panic!("expected Operation::Transit, got {other:?}"),
        }
    }
}
