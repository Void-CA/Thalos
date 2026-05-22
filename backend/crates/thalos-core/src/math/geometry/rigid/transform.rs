use crate::math::geometry::{rotations::Quaternion, vectors::Vector3};


#[derive(Debug, Clone)]
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

    pub fn compose(&self, other: &Self) -> Self {
        let translation = self.translation + self.rotation.rotate_vector(other.translation);
        let rotation = self.rotation * other.rotation;

        Self {
            translation,
            rotation,
        }
    }
}

pub struct Transform<From, To> {
    pub inner: Transform3D,
    pub _marker: std::marker::PhantomData<(From, To)>
}