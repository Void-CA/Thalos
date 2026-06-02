use crate::math::algebra::vector::DynamicVector;
use crate::math::geometry::rotations::UnitQuaternion;
use crate::math::geometry::vectors::Vector3;
use crate::spatial::pose::Pose;

use super::result::IKResult;


// ─── IK Goal ──────────────────────────────────────────────────────────

/// Objetivo del solucionador de cinemática inversa.
///
/// - [`Position`](IKGoal::Position): solo posición del end-effector.
/// - [`Pose`](IKGoal::Pose): posición **y** orientación completas.
pub enum IKGoal {
    Position(Vector3),
    Pose(Pose),
}

/// Error de orientación 3-DOF a partir de la rotación relativa entre la
/// orientación actual y la deseada.
///
/// Usa la aproximación `ω = 2 · imag(q_rel)`, donde `q_rel` es el
/// cuaternión relativo `q_target · q_current⁻¹`. Para errores pequeños
/// esto es equivalente al vector de rotación (ángulo · eje), y para
/// errores grandes la dirección sigue siendo correcta para descenso por
/// gradiente.
fn orientation_error_3d(target_rot: &UnitQuaternion, current_rot: &UnitQuaternion) -> Vector3 {
    // r_rel = r_target * r_cur^{-1}
    let r_rel = *target_rot * current_rot.inverse();

    // ω ≈ 2 · imag(r_rel)
    Vector3::new(
        2.0 * r_rel.inner().x,
        2.0 * r_rel.inner().y,
        2.0 * r_rel.inner().z,
    )
}

/// Error completo 6-DOF para pose: [error_posición (3), error_orientación (3)].
pub fn compute_pose_error(current: &Pose, target: &Pose) -> DynamicVector {
    let pos_error = target.translation() - current.translation();

    let r_cur = current.transform().rotation;
    let r_target = target.transform().rotation;
    let orient_error = orientation_error_3d(&r_target, &r_cur);

    let mut error = DynamicVector::zeros(6);
    error[0] = pos_error.x;
    error[1] = pos_error.y;
    error[2] = pos_error.z;
    error[3] = orient_error.x;
    error[4] = orient_error.y;
    error[5] = orient_error.z;
    error
}


// ─── IKSolver trait ───────────────────────────────────────────────────

pub trait IKSolver {
    fn solve(&self, q0: &[f64], goal: IKGoal) -> IKResult;
}
