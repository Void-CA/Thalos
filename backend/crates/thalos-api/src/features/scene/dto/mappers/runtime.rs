use thalos_core::kinematics::inverse::result::IKResult;

use crate::features::robots::dto::{JointMetadataDto, RobotMetadataDto};

use super::super::{ActivePlanDto, IkResultDto, RuntimeStateResponse, ToolFrameDto, VisualSceneDto};

impl From<IKResult> for IkResultDto {
    fn from(ik: IKResult) -> Self {
        Self {
            status: format!("{:?}", ik.status),
            iterations: ik.iterations,
            final_error: ik.final_error,
        }
    }
}

impl From<&thalos_core::robot::tool_frame::ToolFrame> for ToolFrameDto {
    fn from(tcp: &thalos_core::robot::tool_frame::ToolFrame) -> Self {
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

        ToolFrameDto {
            base_frame_id,
            offset,
        }
    }
}


impl RuntimeStateResponse {
    pub fn from_snapshot(
        snapshot: &thalos_runtime::RuntimeSnapshot,
        scene: VisualSceneDto,
        active_plan: Option<ActivePlanDto>,
    ) -> Self {
        // When the robot was imported from URDF, the runtime carries joint
        // metadata. Otherwise fall back to the built-in RobotMetadata.
        let robot = if snapshot.joints_meta.is_empty() {
            snapshot.robot.metadata().into()
        } else {
            RobotMetadataDto {
                id: "urdf".into(),
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
            ik_result: snapshot.ik_result.as_ref().map(|ik| {
                IkResultDto {
                    status: format!("{:?}", ik.status),
                    iterations: ik.iterations,
                    final_error: ik.final_error,
                }
            }),
            active_plan,
            active_tcp: snapshot.active_tcp.as_ref().map(ToolFrameDto::from),
            generated_at: snapshot.generated_at,
        }
    }
}

/// Build an `ActivePlanDto` with trajectory visualization from a snapshot.
///
/// Derives the plan state from the execution session when available,
/// falling back to the plan's own state for single-shot commands (MoveJ/MoveL).
pub fn build_plan_dto(
    snapshot: &thalos_runtime::RuntimeSnapshot,
) -> Option<ActivePlanDto> {
    let plan = snapshot.active_plan.as_ref()?;
    let mut dto = ActivePlanDto::with_visualization(plan, &snapshot.chain, snapshot.active_tcp.as_ref());

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
