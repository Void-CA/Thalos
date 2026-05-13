use std::ops;

use crate::math::geometry::
{
    quaternion::Quaternion, 
    vector3::Vector3
};


pub struct Transform {
    pub translation: Vector3,
    pub rotation: Quaternion,
}

impl Transform {
    pub fn from_translation(translation: Vector3) -> Self {
        Self {
            translation,
            rotation: Quaternion::identity(),
        }
    }

    pub fn from_rotation(rotation: Quaternion) -> Self {
        Self {
            translation: Vector3::zero(),
            rotation,
        }
    }

    pub fn identity() -> Self {
        Self {
            translation: Vector3::zero(),
            rotation: Quaternion::identity(),
        }
    }
}

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