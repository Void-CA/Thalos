use crate::math::algebra::DynamicMatrix;

pub type JacobianMatrix = DynamicMatrix;

pub trait Jacobian {
    fn evaluate(&self, q: &[f64]) -> JacobianMatrix;
}   