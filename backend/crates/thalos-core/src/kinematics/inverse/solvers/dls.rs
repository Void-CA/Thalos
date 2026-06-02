use crate::kinematics::forward::ForwardKinematics;
use crate::kinematics::jacobian::{GeometricJacobian, JacobianSolver};
use crate::math::algebra::DynamicMatrix;
use crate::math::algebra::vector::DynamicVector;
use crate::spatial::frame::FrameId;
use crate::kinematics::inverse::{
    result::IKResult,
    solver::{compute_pose_error, IKGoal},
    IKSolver,
};


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
    fn solve(&self, q0: &[f64], goal: IKGoal) -> IKResult {
        let mut q = DynamicVector::from_column_slice(q0);
        let mut error_history = if self.track_history {
            Some(Vec::with_capacity(self.max_iters))
        } else {
            None
        };

        let lambda_sq = self.lambda * self.lambda;

        for iteration in 0..self.max_iters {
            let fk_result = self.fk.evaluate(q.as_slice());
            let jacobian = self.jacobian.evaluate(q.as_slice());

            // Extract error vector and Jacobian matrix based on goal type
            let (error_vec, j_mat, magnitude) = match &goal {
                IKGoal::Position(target_pos) => {
                    let p = fk_result.ee_position().unwrap();
                    let error = *target_pos - p;
                    let mag = error.magnitude();
                    let j_lin = jacobian.linear().clone_owned();
                    (DynamicVector::from(error), j_lin, mag)
                }
                IKGoal::Pose(target_pose) => {
                    let current_pose = fk_result.ee_pose().unwrap();
                    let error = compute_pose_error(current_pose, target_pose);
                    let mag = error.magnitude();
                    let j_full = jacobian.full();
                    (error, j_full, mag)
                }
            };

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

            // A = J · Jᵀ  (n_dof × n_dof)
            // A_damped = A + λ² · I
            let n_dof = j_mat.nrows();
            let identity = DynamicMatrix::identity(n_dof, n_dof);
            let a = &j_mat * j_mat.transpose();
            let a_damped = a + lambda_sq * identity;

            let inv = match a_damped.try_inverse() {
                Some(inv) => inv,
                None => {
                    return IKResult::max_iterations(
                        q.as_slice().to_vec(),
                        iteration + 1,
                        magnitude,
                        error_history,
                    );
                }
            };

            // Δq = Jᵀ · inv(A_damped) · e
            let dq = j_mat.transpose() * (inv * error_vec);
            q += dq;
        }

        // Último error después de agotar iteraciones
        let fk_result = self.fk.evaluate(q.as_slice());
        let final_error = match &goal {
            IKGoal::Position(target_pos) => {
                (*target_pos - fk_result.ee_position().unwrap()).magnitude()
            }
            IKGoal::Pose(target_pose) => {
                let current = fk_result.ee_pose().unwrap();
                compute_pose_error(current, target_pose).magnitude()
            }
        };

        IKResult::max_iterations(
            q.as_slice().to_vec(),
            self.max_iters,
            final_error,
            error_history,
        )
    }
}
