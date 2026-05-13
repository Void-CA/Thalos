use crate::math::geometry::spatial::Transform;

pub struct Link<From, To> {
    pub transform: Transform<From, To>,
}