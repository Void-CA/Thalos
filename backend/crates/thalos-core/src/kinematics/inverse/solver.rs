use crate::kinematics::forward::ForwardKinematics;
use crate::kinematics::jacobian::{GeometricJacobian, JacobianSolver};
use crate::math::algebra::DynamicMatrix;
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

// ─── Damped Least Squares (DLS) ─────────────────────────────────────────

/// Solver de cinemática inversa basado en Damped Least Squares (`Jᵀ(J Jᵀ + λ²I)⁻¹`).
///
/// También conocido como *Levenberg–Marquardt* para IK. En cada iteración:
///
/// ```text
/// Δq = Jᵀ · (J · Jᵀ + λ² · I)⁻¹ · e
/// ```
///
/// donde `λ` (lambda) es el factor de damping.
///
/// Ventajas: maneja singularidades naturalmente (el damping regulariza la
/// matriz), no se queda atascado como JT en configuraciones singulares.
/// Desventajas: requiere invertir una matriz 3×3 (o 6×6 para pose) por
/// iteración, más costoso que JT.
pub struct DampedLeastSquaresSolver {
    jacobian: GeometricJacobian,
    fk: ForwardKinematics,
    max_iters: usize,
    tolerance: f64,
    lambda: f64,
    track_history: bool,
}

impl DampedLeastSquaresSolver {
    pub fn new(
        fk: ForwardKinematics,
        end_effector: FrameId,
        max_iters: usize,
        tolerance: f64,
        lambda: f64,
    ) -> Self {
        let jacobian = GeometricJacobian::new(fk.clone(), end_effector);
        Self {
            jacobian,
            fk,
            max_iters,
            tolerance,
            lambda,
            track_history: false,
        }
    }

    /// Habilita el registro del historial de error por iteración.
    pub fn with_history(mut self, enabled: bool) -> Self {
        self.track_history = enabled;
        self
    }
}

impl IKSolver for DampedLeastSquaresSolver {
    fn solve(&self, q0: &[f64], target: Vector3) -> IKResult {
        let mut q = DynamicVector::from_column_slice(q0);
        let mut error_history = if self.track_history {
            Some(Vec::with_capacity(self.max_iters))
        } else {
            None
        };

        let lambda_sq = self.lambda * self.lambda;
        let identity_3x3 = DynamicMatrix::identity(3, 3);

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

            // J_lin es 3×n
            let j = self.jacobian.evaluate(q.as_slice());
            let j_lin = j.linear().clone();

            // A = J_lin · J_linᵀ  (3×3)
            let a = &j_lin * j_lin.transpose();

            // A_damped = A + λ² · I₃
            let a_damped = a + lambda_sq * &identity_3x3;

            // Inversa (siempre existe con λ > 0, pero por las dudas
            // fallbackeamos a (1/λ²)·I si try_inverse falla)
            let inv = match a_damped.try_inverse() {
                Some(inv) => inv,
                None => {
                    // λ² = 0 y matriz singular → no hay update
                    // Esto no debería pasar porque en la práctica
                    // usamos λ > 0. Si pasa, early exit con lo que
                    // tengamos.
                    return IKResult::max_iterations(
                        q.as_slice().to_vec(),
                        iteration + 1,
                        magnitude,
                        error_history,
                    );
                }
            };

            // Δq = J_linᵀ · inv(A_damped) · e
            let dq = j_lin.transpose() * (inv * error_vec);
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
