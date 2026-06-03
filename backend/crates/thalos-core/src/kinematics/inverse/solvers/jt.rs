use crate::kinematics::forward::ForwardKinematics;
use crate::kinematics::jacobian::{GeometricJacobian, JacobianSolver};
use crate::math::algebra::vector::DynamicVector;
use crate::spatial::frame::FrameId;
use crate::kinematics::inverse::{
    result::IKResult,
    solver::{compute_pose_error, IKGoal},
    IKSolver,
};

pub struct JacobianTransposeSolver {
    jacobian: GeometricJacobian,
    fk: ForwardKinematics,
    end_effector: FrameId,
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
            end_effector,
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
    fn solve(&self, q0: &[f64], goal: IKGoal) -> IKResult {
        let mut q = DynamicVector::from_column_slice(q0);
        let mut error_history = if self.track_history {
            Some(Vec::with_capacity(self.max_iters))
        } else {
            None
        };

        for iteration in 0..self.max_iters {
            let fk_result = self.fk.evaluate(q.as_slice());
            let jacobian = self.jacobian.evaluate(q.as_slice());

            let ee_pose = fk_result.pose(&self.end_effector)
                .expect("target frame not found in FK result");
            let (error_vec, magnitude) = match &goal {
                IKGoal::Position(target_pos) => {
                    let p = ee_pose.translation();
                    let error = *target_pos - p;
                    let mag = error.magnitude();
                    (DynamicVector::from(error), mag)
                }
                IKGoal::Pose(target_pose) => {
                    let error = compute_pose_error(ee_pose, target_pose);
                    let mag = error.magnitude();
                    (error, mag)
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

            let dq = match &goal {
                IKGoal::Position(_) => {
                    let j_lin = jacobian.linear();
                    self.alpha * (j_lin.transpose() * error_vec)
                }
                IKGoal::Pose(_) => {
                    let j_full = jacobian.full();
                    self.alpha * (j_full.transpose() * error_vec)
                }
            };
            q += dq;
        }

        // Último error después de agotar iteraciones
        let fk_result = self.fk.evaluate(q.as_slice());
        let final_error = match &goal {
            IKGoal::Position(target_pos) => {
                let p = fk_result.pose(&self.end_effector)
                    .expect("target frame not found").translation();
                (*target_pos - p).magnitude()
            }
            IKGoal::Pose(target_pose) => {
                let current = fk_result.pose(&self.end_effector)
                    .expect("target frame not found");
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
