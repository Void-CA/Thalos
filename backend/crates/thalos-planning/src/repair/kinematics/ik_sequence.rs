//! IK sequence resolver: resuelve una secuencia de waypoints manteniendo
//! continuidad, usando FK para obtener la pose actual y aplicando un
//! offset cartesiano antes de resolver IK.

use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        inverse::solver::{IKGoal, IKSolver},
    },
    robot::serial_chain::SerialChain,
    spatial::{frame::FrameId, pose::Pose},
    trajectory::{Trajectory, TrajectoryPoint},
};
use thalos_math::{Transform3D, UnitQuaternion, UnitVector3, Vector3};

use crate::repair::domain::types::RepairError;

/// Aplica una transformación cartesiana (traslación) a una secuencia de
/// waypoints. Para cada waypoint: FK → offset → IK → nuevo joint.
pub fn solve_translation_offset(
    chain: &SerialChain,
    _tcp_frame: &FrameId,
    ik_solver: &dyn IKSolver,
    segment: &Trajectory,
    offset: Vector3,
) -> Result<Trajectory, RepairError> {
    let fk = ForwardKinematics::new(chain.clone());
    let wps = segment.waypoints();
    let mut result = Vec::with_capacity(wps.len());

    for wp in wps {
        let q = wp.joints().to_vec();
        let fk_result = fk.evaluate(&q);
        let current = fk_result.ee_pose().ok_or_else(|| {
            RepairError::IkFailure("FK returned no pose".into())
        })?;

        let new_trans = current.translation() + offset;
        let target = Pose::new(
            current.reference_id(),
            current.target_id(),
            Transform3D {
                translation: new_trans,
                rotation: current.transform().rotation,
            },
        );

        let ik_result = ik_solver.solve(&q, IKGoal::Pose(target));
        if !ik_result.status.is_converged() {
            return Err(RepairError::IkFailure(format!(
                "IK did not converge (status: {:?}, error: {})",
                ik_result.status, ik_result.final_error
            )));
        }
        result.push(TrajectoryPoint::new(ik_result.q, wp.timestamp()));
    }
    Ok(Trajectory::new(result))
}

/// Aplica una rotación al TCP (manteniendo posición).
/// `angle_rad` es la rotación alrededor del eje Z del TCP en radianes.
pub fn solve_rotation_offset(
    chain: &SerialChain,
    _tcp_frame: &FrameId,
    ik_solver: &dyn IKSolver,
    segment: &Trajectory,
    angle_rad: f64,
) -> Result<Trajectory, RepairError> {
    let fk = ForwardKinematics::new(chain.clone());
    let wps = segment.waypoints();
    let mut result = Vec::with_capacity(wps.len());

    let delta_rot = UnitQuaternion::from_axis_angle(UnitVector3::z_axis(), angle_rad);

    for wp in wps {
        let q = wp.joints().to_vec();
        let fk_result = fk.evaluate(&q);
        let current = fk_result.ee_pose().ok_or_else(|| {
            RepairError::IkFailure("FK returned no pose".into())
        })?;

        // Componer rotación: rotación actual * rotación delta (TCP-local)
        let new_rot = current.transform().rotation * delta_rot;
        let target = Pose::new(
            current.reference_id(),
            current.target_id(),
            Transform3D {
                translation: current.translation(),
                rotation: new_rot,
            },
        );

        let ik_result = ik_solver.solve(&q, IKGoal::Pose(target));
        if !ik_result.status.is_converged() {
            return Err(RepairError::IkFailure(format!(
                "IK did not converge for rotation (status: {:?}, error: {})",
                ik_result.status, ik_result.final_error
            )));
        }
        result.push(TrajectoryPoint::new(ik_result.q, wp.timestamp()));
    }
    Ok(Trajectory::new(result))
}
