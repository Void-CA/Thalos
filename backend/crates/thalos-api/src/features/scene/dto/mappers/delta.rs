use thalos_core::{
    kinematics::forward::result::FKResult,
    robot::serial_chain::SerialChain,
};
use thalos_runtime::TickDelta;

use super::super::{ExecutionDto, ExecutionStatusDto, LinkTransformDto, RuntimeDelta};

/// Convierte un `TickDelta` del runtime en un `RuntimeDelta` DTO.
pub fn to_delta_response(delta: &TickDelta) -> RuntimeDelta {
    let link_transforms = build_link_transforms(&delta.chain, &delta.fk_result);

    let execution = delta.execution.as_ref().map(|exe| {
        let status = match exe.status {
            thalos_runtime::SessionStatus::Ready => ExecutionStatusDto::Ready,
            thalos_runtime::SessionStatus::Running => ExecutionStatusDto::Running,
            thalos_runtime::SessionStatus::Paused => ExecutionStatusDto::Paused,
            thalos_runtime::SessionStatus::Completed => ExecutionStatusDto::Completed,
            thalos_runtime::SessionStatus::Cancelled => ExecutionStatusDto::Cancelled,
            thalos_runtime::SessionStatus::Failed => ExecutionStatusDto::Failed,
        };

        ExecutionDto {
            status,
            progress: exe.progress(delta.plan_duration),
            elapsed_secs: exe.current_time,
        }
    }).unwrap_or(ExecutionDto {
        status: ExecutionStatusDto::Idle,
        progress: 0.0,
        elapsed_secs: 0.0,
    });

    RuntimeDelta {
        joints: delta.joints.clone(),
        link_transforms,
        execution,
    }
}

/// Construye los link transforms iterando la cadena cinemática y el FK result.
///
/// Esencialmente replica la lógica de `SceneBuilder::build` pero solo para
/// links, sin frames, axes, twists ni primitives.
fn build_link_transforms(chain: &SerialChain, fk: &FKResult) -> Vec<LinkTransformDto> {
    chain
        .segments
        .iter()
        .filter(|seg| seg.joint.dof() > 0)
        .filter_map(|seg| {
            let child_pose = fk.pose(&seg.child)?;
            let parent_pose = fk.pose(&seg.parent)?;
            Some(LinkTransformDto {
                id: seg.joint.id(),
                start: [
                    parent_pose.translation().x,
                    parent_pose.translation().y,
                    parent_pose.translation().z,
                ],
                end: [
                    child_pose.translation().x,
                    child_pose.translation().y,
                    child_pose.translation().z,
                ],
            })
        })
        .collect()
}
