use crate::math::{error::MathError, geometry::vector3::Vector3};

#[derive(Debug, Clone, Copy)]
pub struct Quaternion {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Quaternion {
    pub fn identity() -> Self {
        Self { w: 1.0, x: 0.0, y: 0.0, z: 0.0 }
    }

    pub fn from_axis_angle(axis: Vector3, angle: f64) -> Result<Self, MathError> {
        let axis = axis.normalize()?;

        let half_angle = angle / 2.0;
        let sin_half_angle = half_angle.sin();

        Ok(Self {
            w: half_angle.cos(),
            x: axis.x * sin_half_angle,
            y: axis.y * sin_half_angle,
            z: axis.z * sin_half_angle,
        })
    }
}