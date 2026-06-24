use thalos_core::kinematics::inverse::result::IKResult;

use crate::features::robots::dto::{JointMetadataDto, RobotMetadataDto};

use super::super::{ActivePlanDto, IkResultDto, RuntimeStateResponse, VisualSceneDto};

impl From<IKResult> for IkResultDto {
    fn from(ik: IKResult) -> Self {
        Self {
            status: format!("{:?}", ik.status),
            iterations: ik.iterations,
            final_error: ik.final_error,
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
            generated_at: snapshot.generated_at,
        }
    }
}

/// Build an `ActivePlanDto` with trajectory visualization from a snapshot.
pub fn build_plan_dto(
    snapshot: &thalos_runtime::RuntimeSnapshot,
) -> Option<ActivePlanDto> {
    let plan = snapshot.active_plan.as_ref()?;
    Some(ActivePlanDto::with_visualization(plan, &snapshot.chain))
}
