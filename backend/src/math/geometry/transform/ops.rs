use std::ops;
use crate::math::geometry::transform::Transform;

impl ops::Mul for Transform {
    type Output = Transform;

    fn mul(self, rhs: Self) -> Self::Output {
        let new_translation = self.translation + self.rotation.rotate_vector(rhs.translation);
        let new_rotation = self.rotation * rhs.rotation;

        Self {
            translation: new_translation,
            rotation: new_rotation,
        }
    }
}