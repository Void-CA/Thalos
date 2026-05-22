use nalgebra::{DMatrix, MatrixView};

pub type DynamicMatrix = DMatrix<f64>;

pub type MatrixSlice<'a> = MatrixView<'a, f64, nalgebra::Dyn, nalgebra::Dyn>;