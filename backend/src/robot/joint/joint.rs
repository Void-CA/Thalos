use crate::math::geometry::{
    transform::Transform,
    vector3::Vector3
};


#[derive(Debug, Clone, Copy)]
pub struct JointLimits {
    pub min: f64,
    pub max: f64,
}

pub trait Joint {
    fn transform(&self, q : f64) -> Transform;
    fn limits(&self) -> JointLimits;
    fn axis(&self) -> Vector3;
}
