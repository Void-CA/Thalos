use nalgebra::DVector;
pub type DynamicVector = DVector<f64>;

/// Convert a 3D vector into a 3-element dynamic vector.
pub fn vector_to_dynamic(v: crate::math::geometry::vectors::Vector3) -> DynamicVector {
    DynamicVector::from_vec(vec![v.x, v.y, v.z])
}