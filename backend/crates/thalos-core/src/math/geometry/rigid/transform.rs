use crate::math::geometry::{
    rotations::UnitQuaternion,
    vectors::Vector3,
};

/// Transformación rígida 3D (traslación + rotación).
///
/// La rotación está representada con un [`UnitQuaternion`] para garantizar
/// que sea una rotación válida en SO(3) (norma = 1).
///
/// La traslación es un [`Vector3`] cualquiera.
#[derive(Debug, Clone)]
pub struct Transform3D {
    pub translation: Vector3,
    pub rotation: UnitQuaternion,
}

impl Transform3D {
    pub fn from_translation(translation: Vector3) -> Self {
        Self {
            translation,
            rotation: UnitQuaternion::identity(),
        }
    }

    pub fn from_rotation(rotation: UnitQuaternion) -> Self {
        Self {
            translation: Vector3::zero(),
            rotation,
        }
    }

    pub fn identity() -> Self {
        Self {
            translation: Vector3::zero(),
            rotation: UnitQuaternion::identity(),
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

/// Transformación rígida genérica con tipos de marco (frame) para type safety.
///
/// `Transform<From, To>` envuelve un [`Transform3D`] y usa `PhantomData`
/// para asegurar en tiempo de compilación que las transformaciones
/// se componen entre marcos compatibles.
pub struct Transform<From, To> {
    pub inner: Transform3D,
    pub _marker: std::marker::PhantomData<(From, To)>,
}
