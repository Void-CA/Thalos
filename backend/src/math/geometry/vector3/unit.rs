use super::vector3::Vector3;
use crate::math::error::MathError;

#[derive(Debug, Clone, Copy)]
pub struct UnitVector3(Vector3);

impl UnitVector3 {
    pub fn new(vector: Vector3) -> Result<Self, MathError> {
        Ok(Self(vector.normalized()?))
    }

    pub fn into_inner(self) -> Vector3 {
        self.0
    }
}

impl std::ops::Deref for UnitVector3 {
    type Target = Vector3;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}