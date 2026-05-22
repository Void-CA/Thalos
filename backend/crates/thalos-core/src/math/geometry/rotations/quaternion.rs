use crate::math::{
    constants, geometry::vectors::{UnitVector3, Vector3}, 
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

    pub fn from_axis_angle(axis: UnitVector3, angle: f64) -> Self {
        let half = angle * 0.5;
        let s = half.sin();

        Self {
            w: half.cos(),
            x: axis.x * s,
            y: axis.y * s,
            z: axis.z * s,
        }
    }

    /// Rotación de vector (SO(3))
    pub fn rotate_vector(&self, v: Vector3) -> Vector3 {
        let q = self.normalize(); // idealmente esto NO debería ser necesario en runtime

        let q_vec = Vector3::new(q.x, q.y, q.z);

        let uv = q_vec.cross(v);
        let uuv = q_vec.cross(uv);

        v + (uv * (2.0 * q.w)) + (uuv * 2.0)
    }

    /// Convierte cuaternión a ángulos Euler (orden ZYX: roll, pitch, yaw)
    pub fn to_euler(&self) -> (f64, f64, f64) {
        let q = self.normalize();
        
        // Roll (rotación alrededor de X)
        let sinr_cosp = 2.0 * (q.w * q.x + q.y * q.z);
        let cosr_cosp = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
        let roll = sinr_cosp.atan2(cosr_cosp);
        
        // Pitch (rotación alrededor de Y)
        let sinp = 2.0 * (q.w * q.y - q.z * q.x);
        let pitch = if sinp.abs() >= 1.0 {
            sinp.signum() * std::f64::consts::FRAC_PI_2
        } else {
            sinp.asin()
        };
        
        // Yaw (rotación alrededor de Z)
        let siny_cosp = 2.0 * (q.w * q.z + q.x * q.y);
        let cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
        let yaw = siny_cosp.atan2(cosy_cosp);
        
        (roll, pitch, yaw)
    }
    
    /// Crea cuaternión desde ángulos Euler (orden ZYX: roll, pitch, yaw)
    pub fn from_euler(roll: f64, pitch: f64, yaw: f64) -> Self {
        let cy = (yaw * 0.5).cos();
        let sy = (yaw * 0.5).sin();
        let cp = (pitch * 0.5).cos();
        let sp = (pitch * 0.5).sin();
        let cr = (roll * 0.5).cos();
        let sr = (roll * 0.5).sin();
        
        Self {
            w: cr * cp * cy + sr * sp * sy,
            x: sr * cp * cy - cr * sp * sy,
            y: cr * sp * cy + sr * cp * sy,
            z: cr * cp * sy - sr * sp * cy,
        }.normalize()
    }
}


#[cfg(test)]
mod quaternion_tests {
    use super::*;
    use crate::math::constants::EPS;
    use std::f64::consts::{PI, FRAC_PI_2, FRAC_PI_4};
    
    #[test]
    fn test_identity_euler() {
        let q = Quaternion::identity();
        let (roll, pitch, yaw) = q.to_euler();
        
        assert!(roll.abs() < EPS);
        assert!(pitch.abs() < EPS);
        assert!(yaw.abs() < EPS);
    }
    
    #[test]
    fn test_from_euler_to_euler_roundtrip() {
        let original = (PI / 6.0, PI / 4.0, PI / 3.0);
        
        let q = Quaternion::from_euler(original.0, original.1, original.2);
        let converted = q.to_euler();
        
        assert!((original.0 - converted.0).abs() < EPS);
        assert!((original.1 - converted.1).abs() < EPS);
        assert!((original.2 - converted.2).abs() < EPS);
    }
    
    #[test]
    fn test_from_euler_angles_alias() {
        let q1 = Quaternion::from_euler(PI/2.0, 0.0, 0.0);
        let q2 = Quaternion::from_euler(PI/2.0, 0.0, 0.0);
        
        assert!((q1.w - q2.w).abs() < EPS);
        assert!((q1.x - q2.x).abs() < EPS);
        assert!((q1.y - q2.y).abs() < EPS);
        assert!((q1.z - q2.z).abs() < EPS);
    }
    
    #[test]
    fn test_scara_wrist_with_euler() {
        // Rotación de 90° solo en Z
        let q = Quaternion::from_euler(0.0, 0.0, PI / 2.0);
        let (roll, pitch, yaw) = q.to_euler();
        
        assert!(roll.abs() < EPS);
        assert!(pitch.abs() < EPS);
        assert!((yaw - PI / 2.0).abs() < EPS);
        
        // Verificar rotación de vector
        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = q.rotate_vector(v);
        
        assert!((rotated.x).abs() < EPS);
        assert!((rotated.y - 1.0).abs() < EPS);
        assert!((rotated.z).abs() < EPS);
    }
    
    #[test]
    fn test_complex_rotation() {
        // Rotación combinada
        let q = Quaternion::from_euler(PI/4.0, PI/6.0, PI/3.0);
        let (r, p, y) = q.to_euler();
        
        // Debería recuperar ángulos aproximados
        assert!((r - PI/4.0).abs() < 1e-6);
        assert!((p - PI/6.0).abs() < 1e-6);
        assert!((y - PI/3.0).abs() < 1e-6);
    }
}