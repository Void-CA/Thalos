use thalos_core::kinematics::inverse::result::IKResult;

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

/// Associate methods on RuntimeStateResponse.
///
/// The struct itself is defined in `super::responses`.
impl RuntimeStateResponse {
    /// Build from a RuntimeSnapshot and its derived VisualScene.
    ///
    /// `active_plan` is optionally pre-built with visualization payload.
    /// Use `build_plan_for_snapshot` in the handler to construct it.
    pub fn from_snapshot(
        snapshot: &thalos_runtime::RuntimeSnapshot,
        scene: VisualSceneDto,
        active_plan: Option<ActivePlanDto>,
    ) -> Self {
        Self {
            robot: snapshot.robot.metadata().into(),
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
