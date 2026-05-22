use crate::math::algebra::DynamicMatrix;

pub trait JacobianSolver {
    fn evaluate(&self, q: &[f64]) -> Jacobian;
}


pub struct Jacobian {
    linear: DynamicMatrix,
    angular: DynamicMatrix,
}

impl Jacobian {

    pub fn new(
        linear: DynamicMatrix,
        angular: DynamicMatrix,
    ) -> Self {

        Self {
            linear,
            angular,
        }
    }

    pub fn linear(&self) -> &DynamicMatrix {
        &self.linear
    }

    pub fn angular(&self) -> &DynamicMatrix {
        &self.angular
    }
}