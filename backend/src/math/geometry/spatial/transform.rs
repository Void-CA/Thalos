use std::{marker::PhantomData, ops};

use crate::math::geometry::
{
    rotations::Quaternion, 
    vectors::Vector3
};


pub struct Transform<From, To> {
    pub translation: Vector3,
    pub rotation: Quaternion,
    pub _marker: PhantomData<(From, To)>,
}

impl<From, To> Transform<From, To> {
    pub fn from_translation(translation: Vector3) -> Self {
        Self {
            translation,
            rotation: Quaternion::identity(),
            _marker: PhantomData,
        }
    }

    pub fn from_rotation(rotation: Quaternion) -> Self {
        Self {
            translation: Vector3::zero(),
            rotation,
            _marker: PhantomData,
        }
    }

    pub fn identity() -> Self {
        Self {
            translation: Vector3::zero(),
            rotation: Quaternion::identity(),
            _marker: PhantomData,
        }
    }
}
