use crate::math::{error::MathError, traits::products::{Cross, Dot}};

#[derive(Debug, Clone, Copy)]
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

    pub fn normalized(&self) -> Result<Self, MathError> {
        let mag = self.magnitude();
        if mag.abs() < f64::EPSILON {
            return Err(MathError::ZeroVectorNormalization);
        }
        
        Ok(Self {
            x: self.x / mag,
            y: self.y / mag,
            z: self.z / mag,
        })
    }
}


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

impl Dot for Vector3 {
    type Output = f64;

    fn dot(self, rhs: Vector3) -> Self::Output {
        self.x * rhs.x + self.y * rhs.y + self.z * rhs.z
    }
}

impl Cross for Vector3 {
    type Output = Vector3;

    fn cross(self, rhs: Vector3) -> Self::Output {
        Vector3 {
            x: self.y * rhs.z - self.z * rhs.y,
            y: self.z * rhs.x - self.x * rhs.z,
            z: self.x * rhs.y - self.y * rhs.x,
        }
    }
    
}