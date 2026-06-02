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

