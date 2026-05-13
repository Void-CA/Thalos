use std::{marker::PhantomData, ops::Mul};
use crate::math::geometry::spatial::Transform;

impl<A, B, C> Mul<Transform<B, C>> for Transform<A, B> {
    type Output = Transform<A, C>;

    fn mul(self, rhs: Transform<B, C>) -> Self::Output {
        let translation = self.translation + self.rotation.rotate_vector(rhs.translation);
        let rotation = self.rotation * rhs.rotation;

        Transform {
            translation,
            rotation,
            _marker: PhantomData,
        }
    }
}