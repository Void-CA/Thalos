use crate::kinematics::forward::ForwardKinematics;
use crate::kinematics::jacobian::{GeometricJacobian, JacobianSolver};
use crate::math::algebra::vector::DynamicVector;
use crate::math::geometry::vectors::Vector3;


pub struct IKSolver {
    jacobian: GeometricJacobian,
    fk: ForwardKinematics,
    max_iters: usize,
    tolerance: f64,
    alpha: f64,
}

impl IKSolver {
    pub fn solve(&self, q0: &[f64], target: Vector3) -> Vec<f64> {
        let mut q = DynamicVector::from_column_slice(q0);

        for _ in 0..self.max_iters {

            let fk_result = self.fk.evaluate(q.as_slice());

            let p = fk_result.ee_position().unwrap();

            let error = target - p;

            if error.magnitude() < self.tolerance {
                break;
            }

            let error_vec: DynamicVector = error.into();

            let jacobian = self.jacobian.evaluate(q.as_slice());

            let dq =
                self.alpha
                * jacobian.position().transpose()
                * error_vec;

            q += dq;
        }

        q.as_slice().to_vec()
    }

}