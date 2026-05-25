use std::ops::Mul;
use super::Quaternion;

/// Producto de Hamilton (producto de cuaterniones como anillo).
///
/// NOTA: este es un producto puramente algebraico. NO normaliza.
/// Si necesitás que el resultado sea un cuaternión unitario,
/// normalizalo explícitamente o usá [`UnitQuaternion`](super::UnitQuaternion).
impl Mul for Quaternion {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self {
        Self {
            w: self.w * rhs.w - self.x * rhs.x - self.y * rhs.y - self.z * rhs.z,
            x: self.w * rhs.x + self.x * rhs.w + self.y * rhs.z - self.z * rhs.y,
            y: self.w * rhs.y - self.x * rhs.z + self.y * rhs.w + self.z * rhs.x,
            z: self.w * rhs.z + self.x * rhs.y - self.y * rhs.x + self.z * rhs.w,
        }
    }
}
