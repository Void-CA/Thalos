use crate::math::geometry::
{
    quaternion::Quaternion, 
    vector3::Vector3
};


pub struct Transform {
    translation: Vector3,
    rotation: Quaternion,
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