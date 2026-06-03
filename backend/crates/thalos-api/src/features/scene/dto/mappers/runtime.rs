use thalos_core::kinematics::inverse::result::IKResult;

use super::super::{IkResultDto, RuntimeStateResponse, VisualSceneDto};

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
    pub fn from_snapshot(
        snapshot: &thalos_runtime::RuntimeSnapshot,
        scene: VisualSceneDto,
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
            generated_at: snapshot.generated_at,
        }
    }
}
