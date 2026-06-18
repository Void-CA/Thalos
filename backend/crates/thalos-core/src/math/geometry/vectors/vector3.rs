use crate::math::{
    constants,
    error::MathError
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vector3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vector3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    pub fn magnitude(&self) -> f64 {
        (self.x * self.x +
         self.y * self.y +
         self.z * self.z).sqrt()
    }

    pub fn norm(&self) -> f64 {
        self.magnitude()
    }
    
    pub fn normalized(&self) -> Result<Self, MathError> {
        let mag = self.magnitude();
        if mag.abs() < constants::EPS {
            return Err(MathError::ZeroVectorNormalization);
        }
        
        Ok(Self {
            x: self.x / mag,
            y: self.y / mag,
            z: self.z / mag,
        })
    }

    pub fn z_axis() -> Self {
        Self { x: 0.0, y: 0.0, z: 1.0 }
    }

    pub fn y_axis() -> Self {
        Self { x: 0.0, y: 1.0, z: 0.0 }
    }

    pub fn x_axis() -> Self {
        Self { x: 1.0, y: 0.0, z: 0.0 }
    }

}
