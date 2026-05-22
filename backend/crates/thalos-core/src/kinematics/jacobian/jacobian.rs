use crate::math::algebra::DynamicMatrix;

pub trait JacobianSolver {
    fn evaluate(&self, q: &[f64]) -> Jacobian;
}

pub struct Jacobian {
    matrix: DynamicMatrix,
}

impl Jacobian {
    pub fn new(matrix: DynamicMatrix) -> Self {
        Self { matrix }
    }

    pub fn matrix(&self) -> &DynamicMatrix {
        &self.matrix
    }

    pub fn rows(&self) -> usize {
        self.matrix.nrows()
    }

    pub fn cols(&self) -> usize {
        self.matrix.ncols()
    }
}

impl std::ops::Deref for Jacobian {
    type Target = DynamicMatrix;

    fn deref(&self) -> &Self::Target {
        &self.matrix
    }
}

impl std::ops::DerefMut for Jacobian {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.matrix
    }
}