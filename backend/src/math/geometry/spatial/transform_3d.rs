use crate::math::geometry::{rotations::Quaternion, vectors::Vector3};

pub struct Transform3D {
    pub translation: Vector3,
    pub rotation: Quaternion,
}

impl Transform3D {
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