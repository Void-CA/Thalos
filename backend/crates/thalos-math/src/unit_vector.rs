use crate::{Vector3, MathError};
use std::ops::Deref;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnitVector3(Vector3);

impl UnitVector3 {
    pub fn new(vector: Vector3) -> Result<Self, MathError> {
        Ok(Self(vector.normalized()?))
    }

    pub fn into_inner(self) -> Vector3 {
        self.0
    }

    pub fn z_axis() -> Self {
        Self(Vector3::z_axis())
    }

    pub fn y_axis() -> Self {
        Self(Vector3::y_axis())
    }

    pub fn x_axis() -> Self {
        Self(Vector3::x_axis())
    }
}

impl Deref for UnitVector3 {
    type Target = Vector3;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}


impl std::fmt::Display for UnitVector3 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "{:}", self.into_inner());
    }
}