use thalos_core::{
    kinematics::{forward::result::FKResult, inverse::result::IKResult},
    robot::tool_frame::ToolFrame,
};
use thalos_runtime::plan::ExecutionMode;

use crate::features::robots::dto::{JointMetadataDto, RobotMetadataDto};

use super::super::{
    ActivePlanDto, ExecutionDto, ExecutionStatusDto, IkResultDto, ResolvedPoseDto,
    RuntimeStateResponse, ToolFrameDto, VisualSceneDto,
};

impl From<IKResult> for IkResultDto {
    fn from(ik: IKResult) -> Self {
        Self {
            status: format!("{:?}", ik.status),
            iterations: ik.iterations,
            final_error: ik.final_error,
        }
    }
}

impl From<(&ToolFrame, &FKResult)> for ToolFrameDto {
    fn from((tcp, fk): (&ToolFrame, &FKResult)) -> Self {
        let base_frame_id = match tcp.base_frame {
            thalos_core::spatial::frame::FrameId::Id(id) => id,
            thalos_core::spatial::frame::FrameId::World => 0,
        };

        let offset = if tcp.has_offset() {
            let t = &tcp.transform.translation;
            Some([t.x, t.y, t.z])
        } else {
            None
        };

        // Design D1: reuse the snapshot's FK result — zero-cost, no
        // recomputation. `None` when the TCP base frame is absent from FK.
        let resolved_pose = fk.tcp_pose(tcp).map(|pose| {
            let t = pose.translation();
            let q = pose.transform().rotation.inner();
            ResolvedPoseDto {
                position: [t.x, t.y, t.z],
                // Quaternion [w, x, y, z] (matches RotationDto::Quaternion).
                orientation: [q.w, q.x, q.y, q.z],
            }
        });

        ToolFrameDto {
            base_frame_id,
            offset,
            resolved_pose,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use thalos_core::{
        kinematics::forward::{ForwardKinematics, result::FKResult},
        models::{RobotModel, RobotRegistry},
        robot::tool_frame::ToolFrame,
        spatial::{frame::FrameId, pose::Pose},
    };
    use thalos_math::{Transform3D, Vector3};

    use super::super::super::VisualSceneDto;
    use super::*;

    /// FK result with a single frame whose transform is a pure translation
    /// (identity rotation) — mirrors the fixture pattern in
    /// `thalos-core/src/robot/tool_frame.rs`.
    fn make_fk_with_frame(frame_id: u64, translation: Vector3) -> FKResult {
        let mut poses = HashMap::new();
        let frame = FrameId::new(frame_id);
        let transform = Transform3D::from_translation(translation);
        poses.insert(frame.clone(), Pose::new(FrameId::World, frame, transform));
        FKResult::new(poses, FrameId::new(frame_id))
    }

    fn empty_scene() -> VisualSceneDto {
        VisualSceneDto {
            frames: vec![],
            links: vec![],
            joint_axes: vec![],
            twists: vec![],
            primitives: vec![],
            reference_dimension: 1.0,
        }
    }

    /// Minimal `RuntimeSnapshot` over the built-in Planar2R chain.
    fn test_snapshot(active_tcp: Option<ToolFrame>) -> thalos_runtime::RuntimeSnapshot {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let joints = vec![0.0, 0.0];
        let fk_result = ForwardKinematics::new(chain.clone()).evaluate(&joints);
        thalos_runtime::RuntimeSnapshot {
            robot: Some(RobotModel::Planar2R),
            robot_source: None,
            robot_name: "test".into(),
            robot_id: "planar_2r".into(),
            joints_meta: vec![],
            joints,
            chain,
            fk_result,
            ik_result: None,
            active_plan: None,
            execution: None,
            active_tcp,
            generated_at: chrono::Utc::now(),
        }
    }

    // ── Spec tcp-resolved-pose R1: resolved_pose in ToolFrameDto ──

    /// R1.1: TCP active + FK succeeds → `resolved_pose` is `Some` with the
    /// FK result (position = frame translation, orientation = identity).
    #[test]
    fn resolved_pose_some_when_fk_has_frame() {
        let fk = make_fk_with_frame(42, Vector3::new(1.0, 2.0, 3.0));
        let tcp = ToolFrame::identity(FrameId::new(42));

        let dto = ToolFrameDto::from((&tcp, &fk));

        let rp = dto
            .resolved_pose
            .expect("resolved_pose should be Some when FK has the TCP base frame");
        assert_eq!(rp.position, [1.0, 2.0, 3.0]);
        // FK fixture uses identity rotation → quaternion [w, x, y, z] = [1, 0, 0, 0]
        assert_eq!(rp.orientation, [1.0, 0.0, 0.0, 0.0]);
    }

    /// R1.3: TCP base frame missing from FK → `resolved_pose` is `None`
    /// (no crash, field present with null value).
    #[test]
    fn resolved_pose_none_when_frame_missing() {
        let fk = make_fk_with_frame(42, Vector3::new(1.0, 2.0, 3.0));
        let tcp = ToolFrame::identity(FrameId::new(99)); // not in FK

        let dto = ToolFrameDto::from((&tcp, &fk));

        assert!(
            dto.resolved_pose.is_none(),
            "resolved_pose should be None when FK lacks the TCP base frame"
        );
    }

    /// R1.2: `active_tcp` is `None` → the response carries no ToolFrameDto
    /// (and therefore no `resolved_pose`).
    #[test]
    fn active_tcp_none_yields_no_tool_frame_dto() {
        let snapshot = test_snapshot(None);

        let response = RuntimeStateResponse::from_snapshot(&snapshot, empty_scene(), None);

        assert!(
            response.active_tcp.is_none(),
            "active_tcp must be None when the snapshot has no TCP"
        );
    }

    /// R1.1 end-to-end: a real chain TCP (identity at the end effector)
    /// resolves through `from_snapshot` into a `Some(resolved_pose)`.
    #[test]
    fn from_snapshot_active_tcp_carries_resolved_pose() {
        let chain = RobotRegistry::create_default(RobotModel::Planar2R);
        let tcp = ToolFrame::identity(*chain.end_effector());

        let snapshot = test_snapshot(Some(tcp));
        let response = RuntimeStateResponse::from_snapshot(&snapshot, empty_scene(), None);

        let dto = response
            .active_tcp
            .expect("active_tcp should be present when the snapshot has a TCP");
        assert!(
            dto.resolved_pose.is_some(),
            "resolved_pose should be Some when the TCP base frame is in the FK result"
        );
    }
}

impl RuntimeStateResponse {
    pub fn from_snapshot(
        snapshot: &thalos_runtime::RuntimeSnapshot,
        scene: VisualSceneDto,
        active_plan: Option<ActivePlanDto>,
    ) -> Self {
        // Invariant (spec: "DTO Invariant"): joints_meta.is_empty() ⇔
        // robot.is_some(). Built-in robots carry Some(model) with empty
        // joints_meta (metadata comes from the catalog model); URDF robots
        // carry None with non-empty joints_meta. Caught in debug builds.
        debug_assert!(
            snapshot.joints_meta.is_empty() == snapshot.robot.is_some(),
            "invariant violated: joints_meta.is_empty()={} but robot.is_some()={}",
            snapshot.joints_meta.is_empty(),
            snapshot.robot.is_some()
        );

        // When the robot was imported from URDF, the runtime carries joint
        // metadata. Otherwise fall back to the built-in RobotMetadata.
        // The emitted `id` always comes from `snapshot.robot_id` — the
        // canonical single source (spec robot-identity R1): metadata.id for
        // catalog robots (R1.3), `urdf:<hash>` for imports (R1.1).
        let robot = if snapshot.joints_meta.is_empty() {
            let mut dto: RobotMetadataDto = snapshot
                .robot
                .as_ref()
                .expect("built-in robot must carry a catalog model")
                .metadata()
                .into();
            dto.id = snapshot.robot_id.clone();
            dto
        } else {
            RobotMetadataDto {
                id: snapshot.robot_id.clone(),
                display_name: snapshot.robot_name.clone(),
                dof: snapshot.joints.len(),
                joints: snapshot
                    .joints_meta
                    .iter()
                    .map(|jm| JointMetadataDto {
                        name: jm.name.clone(),
                        kind: jm.kind.clone(),
                        min: jm.min,
                        max: jm.max,
                    })
                    .collect(),
            }
        };

        Self {
            robot,
            joints: snapshot.joints.clone(),
            scene,
            ik_result: snapshot.ik_result.as_ref().map(|ik| IkResultDto {
                status: format!("{:?}", ik.status),
                iterations: ik.iterations,
                final_error: ik.final_error,
            }),
            active_plan,
            active_tcp: snapshot
                .active_tcp
                .as_ref()
                .map(|tcp| ToolFrameDto::from((tcp, &snapshot.fk_result))),
            execution: snapshot.execution.as_ref().map(|exe| {
                use thalos_runtime::SessionStatus;
                let status = match exe.status {
                    SessionStatus::Ready => ExecutionStatusDto::Ready,
                    SessionStatus::Running => ExecutionStatusDto::Running,
                    SessionStatus::Paused => ExecutionStatusDto::Paused,
                    SessionStatus::Completed => ExecutionStatusDto::Completed,
                    SessionStatus::Cancelled => ExecutionStatusDto::Cancelled,
                    SessionStatus::Failed => ExecutionStatusDto::Failed,
                };
                ExecutionDto {
                    status,
                    progress: exe.current_time,
                    elapsed_secs: exe.current_time,
                    source: Some(exe.source.to_string()),
                    mode: exe.mode,
                    iteration: exe.iteration,
                    total_iterations: exe.total_iterations,
                }
            }),
            generated_at: snapshot.generated_at,
        }
    }
}

/// Build an `ActivePlanDto` with trajectory visualization from a snapshot.
///
/// Derives the plan state from the execution session when available,
/// falling back to the plan's own state for single-shot commands (MoveJ/MoveL).
pub fn build_plan_dto(snapshot: &thalos_runtime::RuntimeSnapshot) -> Option<ActivePlanDto> {
    let plan = snapshot.active_plan.as_ref()?;
    let mut dto =
        ActivePlanDto::with_visualization(plan, &snapshot.chain, snapshot.active_tcp.as_ref());

    // If there's an execution session, override the plan state with the
    // session's status so the frontend sees the correct execution state.
    if let Some(ref exe) = snapshot.execution {
        dto.state = match exe.status {
            thalos_runtime::SessionStatus::Ready => "Created".into(),
            thalos_runtime::SessionStatus::Running => "Active".into(),
            thalos_runtime::SessionStatus::Paused => "Paused".into(),
            thalos_runtime::SessionStatus::Completed => "Completed".into(),
            thalos_runtime::SessionStatus::Cancelled => "Cancelled".into(),
            thalos_runtime::SessionStatus::Failed => "Failed".into(),
        };
        // Override progress from the session
        let duration = snapshot
            .active_plan
            .as_ref()
            .map(|p| p.trajectory.duration())
            .unwrap_or(0.0);
        dto.trajectory_progress = Some(exe.progress(duration));
        // Override timestamps
        dto.started_at = exe.started_at;
        dto.completed_at = exe.completed_at;
    }

    Some(dto)
}
