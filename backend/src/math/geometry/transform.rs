use crate::math::geometry::
{
    quaternion::Quaternion, 
    vector3::Vector3
};


struct Transform {
    translation: Vector3,
    rotation: Quaternion,
}

impl Transform {
    fn from_translation(translation: Vector3) -> Self {
        Self {
            translation,
            rotation: Quaternion::identity(),
        }
    }

    fn from_rotation(rotation: Quaternion) -> Self {
        Self {
            translation: Vector3::zero(),
            rotation,
        }
    }

    fn identity() -> Self {
        Self {
            translation: Vector3::zero(),
            rotation: Quaternion::identity(),
        }
    }
}