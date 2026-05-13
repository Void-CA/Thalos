use crate::math::
    geometry::transform::Transform
;

pub mod products;



pub trait Transformable {
    fn transform(&self, t: &Transform) -> Self;
} 