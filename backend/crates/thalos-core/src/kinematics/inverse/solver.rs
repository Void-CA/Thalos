use crate::kinematics::forward::ForwardKinematics;
use crate::kinematics::jacobian::{GeometricJacobian, JacobianSolver};
use crate::math::algebra::vector::DynamicVector;
use crate::math::geometry::vectors::Vector3;
use crate::spatial::frame::FrameId;

use super::result::IKResult;


pub trait IKSolver {
    fn solve(&self, q0: &[f64], target: Vector3) -> IKResult;
}

// ─── Jacobian Transpose ─────────────────────────────────────────────────

/// Solver de cinemática inversa basado en Jacobian Transpose (`Jᵀ`).
///
/// Es el método más simple: en cada iteración calcula el error de posición
/// y lo proyecta al espacio articular mediante `Δq = α · Jᵀ · e`.
///
/// Ventajas: simple, numéricamente estable.
/// Desventajas: converge lento cerca de singularidades.
pub struct JacobianTransposeSolver {
    jacobian: GeometricJacobian,
    fk: ForwardKinematics,
    max_iters: usize,
    tolerance: f64,
    alpha: f64,
    track_history: bool,
}

impl JacobianTransposeSolver {
    pub fn new(
        fk: ForwardKinematics,
        end_effector: FrameId,
        max_iters: usize,
        tolerance: f64,
        alpha: f64,
    ) -> Self {
        let jacobian = GeometricJacobian::new(fk.clone(), end_effector);
        Self {
            jacobian,
            fk,
            max_iters,
            tolerance,
            alpha,
            track_history: false,
        }
    }

    /// Habilita el registro del historial de error por iteración.
    pub fn with_history(mut self, enabled: bool) -> Self {
        self.track_history = enabled;
        self
    }
}

impl IKSolver for JacobianTransposeSolver {
    fn solve(&self, q0: &[f64], target: Vector3) -> IKResult {
        let mut q = DynamicVector::from_column_slice(q0);
        let mut error_history = if self.track_history {
            Some(Vec::with_capacity(self.max_iters))
        } else {
            None
        };

        for iteration in 0..self.max_iters {
            let fk_result = self.fk.evaluate(q.as_slice());
            let p = fk_result.ee_position().unwrap();
            let error = target - p;
            let magnitude = error.magnitude();

            if let Some(ref mut history) = error_history {
                history.push(magnitude);
            }

            if magnitude < self.tolerance {
                return IKResult::converged(
                    q.as_slice().to_vec(),
                    iteration + 1,
                    magnitude,
                    error_history,
                );
            }

            let error_vec: DynamicVector = error.into();
            let jacobian = self.jacobian.evaluate(q.as_slice());
            let dq = self.alpha * (jacobian.linear().transpose() * error_vec);
            q += dq;
        }

        // Último error después de agotar iteraciones
        let fk_result = self.fk.evaluate(q.as_slice());
        let final_error = (target - fk_result.ee_position().unwrap()).magnitude();

        IKResult::max_iterations(
            q.as_slice().to_vec(),
            self.max_iters,
            final_error,
            error_history,
        )
    }
}
