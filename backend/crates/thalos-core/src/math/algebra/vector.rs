use nalgebra::DVector;
use crate::math::geometry::vectors::Vector3;

pub type DynamicVector = DVector<f64>;

impl From<Vector3> for DynamicVector {
    fn from(v: Vector3) -> Self {
        DynamicVector::from_vec(vec![
            v.x,
            v.y,
            v.z,
        ])
    }
}