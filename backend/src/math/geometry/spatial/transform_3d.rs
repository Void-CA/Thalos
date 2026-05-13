use crate::math::geometry::{rotations::Quaternion, vectors::Vector3};

pub struct Transform3D {
    translation: Vector3,
    rotation: Quaternion,
}