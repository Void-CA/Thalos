use crate::math::{
    constants, geometry::vectors::Vector3, 
    traits::products::Cross
};

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

    /// Invariante deseada: quaternion unitario
    pub fn normalize(&self) -> Self {
        let mag = (self.w * self.w
            + self.x * self.x
            + self.y * self.y
            + self.z * self.z).sqrt();

        if mag < constants::EPS {
            return Self::identity();
        }

        Self {
            w: self.w / mag,
            x: self.x / mag,
            y: self.y / mag,
            z: self.z / mag,
        }
    }

    pub fn conjugate(&self) -> Self {
        Self {
            w: self.w,
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }

    pub fn inverse(&self) -> Self {
        // para unitarios: inverse = conjugate
        self.conjugate().normalize()
    }

    pub fn from_axis_angle(axis: Vector3, angle: f64) -> Self {
        let axis = axis.normalized().unwrap_or(Vector3::new(1.0, 0.0, 0.0));

        let half = angle * 0.5;
        let s = half.sin();

        Self {
            w: half.cos(),
            x: axis.x * s,
            y: axis.y * s,
            z: axis.z * s,
        }
        .normalize()
    }

    /// Rotación de vector (SO(3))
    pub fn rotate_vector(&self, v: Vector3) -> Vector3 {
        let q = self.normalize(); // idealmente esto NO debería ser necesario en runtime

        let q_vec = Vector3::new(q.x, q.y, q.z);

        let uv = q_vec.cross(v);
        let uuv = q_vec.cross(uv);

        v + (uv * (2.0 * q.w)) + (uuv * 2.0)
    }
}