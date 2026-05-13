use std::{marker::PhantomData, ops::Mul};
use crate::math::geometry::spatial::{Transform, Transform3D};

impl<A, B, C> Mul<Transform<B, C>> for Transform<A, B> {
    type Output = Transform<A, C>;

    fn mul(self, rhs: Transform<B, C>) -> Self::Output {
        let translation = self.inner.translation + self.inner.rotation.rotate_vector(rhs.inner.translation);
        let rotation = self.inner.rotation * rhs.inner.rotation;

        Transform {
            inner: Transform3D {
                translation,
                rotation,
            },
            _marker: PhantomData,
        }
    }
}