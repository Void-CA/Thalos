use std::ops::Mul;

use crate::math::geometry::rotations::Quaternion;
use crate::math::geometry::vectors::{UnitVector3, Vector3};
use crate::math::traits::products::Cross;

#[derive(Debug, Clone, Copy)]
pub struct UnitQuaternion {
    q: Quaternion,
}

impl UnitQuaternion {
    /// Construye un `UnitQuaternion` a partir de cualquier cuaternión,
    /// normalizándolo. Si la norma es menor que [`EPS`], retorna la identidad.
    pub fn new(q: Quaternion) -> Self {
        Self { q: q.normalize() }
    }

    pub fn try_new(q: Quaternion) -> Option<Self> {

        if q.norm_squared()
            < crate::math::constants::EPS
                * crate::math::constants::EPS
        {
            None
        } else {
            Some(Self::new(q))
        }
    }

    /// Cuaternión unitario identidad: representa la rotación nula (ángulo 0).
    pub fn identity() -> Self {
        Self { q: Quaternion::identity() }
    }

    /// Crea un cuaternión unitario a partir de un eje y un ángulo (en radianes).
    pub fn from_axis_angle(axis: UnitVector3, angle: f64) -> Self {
        let half = angle * 0.5;
        let s = half.sin();

        Self {
            q: Quaternion {
                w: half.cos(),
                x: axis.x * s,
                y: axis.y * s,
                z: axis.z * s,
            },
        }
    }

    /// Aplica la rotación a un vector `v` en ℝ³.
    ///
    /// Usa la fórmula vectorial de Rodrigues (evita construir la matriz 3x3):
    ///
    ///   v' = v + 2w(q_vec × v) + 2(q_vec × (q_vec × v))
    pub fn rotate_vector(&self, v: Vector3) -> Vector3 {
        let q_vec = Vector3::new(self.q.x, self.q.y, self.q.z);
        let uv = q_vec.cross(v);
        let uuv = q_vec.cross(uv);

        v + (uv * (2.0 * self.q.w)) + (uuv * 2.0)
    }

    pub fn to_euler(&self) -> (f64, f64, f64) {
        let q = self.q;

        // Roll (X)
        let sinr_cosp = 2.0 * (q.w * q.x + q.y * q.z);
        let cosr_cosp = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
        let roll = sinr_cosp.atan2(cosr_cosp);

        // Pitch (Y) — con protección para singularidades (gimbal lock)
        let sinp = 2.0 * (q.w * q.y - q.z * q.x);
        let pitch = if sinp.abs() >= 1.0 {
            sinp.signum() * std::f64::consts::FRAC_PI_2
        } else {
            sinp.asin()
        };

        // Yaw (Z)
        let siny_cosp = 2.0 * (q.w * q.z + q.x * q.y);
        let cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
        let yaw = siny_cosp.atan2(cosy_cosp);

        (roll, pitch, yaw)
    }

    /// Crea desde ángulos Euler en orden ZYX: roll, pitch, yaw (radianes).
    pub fn from_euler(roll: f64, pitch: f64, yaw: f64) -> Self {
        let cy = (yaw * 0.5).cos();
        let sy = (yaw * 0.5).sin();
        let cp = (pitch * 0.5).cos();
        let sp = (pitch * 0.5).sin();
        let cr = (roll * 0.5).cos();
        let sr = (roll * 0.5).sin();

        Self::new(Quaternion {
            w: cr * cp * cy + sr * sp * sy,
            x: sr * cp * cy - cr * sp * sy,
            y: cr * sp * cy + sr * cp * sy,
            z: cr * cp * sy - sr * sp * cy,
        })
    }

    pub fn inverse(&self) -> Self {
    Self {
        q: self.q.conjugate()
    }

}
}

/// Composición de rotaciones: multiplicar dos cuaterniones unitarios
/// equivale a componer sus rotaciones.
///
/// Internamente usa el producto de Hamilton y re-normaliza para
/// mantener la invariante de norma = 1.
impl Mul for UnitQuaternion {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self {
        Self::new(self.q * rhs.q)
    }
}

#[cfg(test)]
mod unit_quaternion_tests {
    use super::*;
    use crate::math::constants::EPS;
    use std::f64::consts::PI;

    // ─── Helpers ───────────────────────────────────────────────

    fn approx_axis(axis: &UnitVector3, angle: f64, expected: (f64, f64, f64), tol: f64) {
        let q = UnitQuaternion::from_axis_angle(*axis, angle);
        let (r, p, y) = q.to_euler();
        assert!(
            (r - expected.0).abs() < tol
                && (p - expected.1).abs() < tol
                && (y - expected.2).abs() < tol,
            "from_axis_angle({:?}, {}) → euler ({:.6}, {:.6}, {:.6}), expected ({:.6}, {:.6}, {:.6})",
            axis, angle, r, p, y,
            expected.0, expected.1, expected.2,
        );
    }

    // ─── Tests de Euler ────────────────────────────────────────

    #[test]
    fn identity_euler_angles_are_zero() {
        let q = UnitQuaternion::new(Quaternion::identity());
        let (roll, pitch, yaw) = q.to_euler();

        assert!(roll.abs() < EPS);
        assert!(pitch.abs() < EPS);
        assert!(yaw.abs() < EPS);
    }

    #[test]
    fn from_euler_to_euler_roundtrip() {
        let original = (PI / 6.0, PI / 4.0, PI / 3.0);

        let q = UnitQuaternion::from_euler(original.0, original.1, original.2);
        let converted = q.to_euler();

        assert!(
            (original.0 - converted.0).abs() < EPS,
            "roll: {} vs {}", original.0, converted.0
        );
        assert!(
            (original.1 - converted.1).abs() < EPS,
            "pitch: {} vs {}", original.1, converted.1
        );
        assert!(
            (original.2 - converted.2).abs() < EPS,
            "yaw: {} vs {}", original.2, converted.2
        );
    }

    #[test]
    fn from_euler_angles_are_deterministic() {
        let q1 = UnitQuaternion::from_euler(PI / 2.0, 0.0, 0.0);
        let q2 = UnitQuaternion::from_euler(PI / 2.0, 0.0, 0.0);

        assert!((q1.q.w - q2.q.w).abs() < EPS);
        assert!((q1.q.x - q2.q.x).abs() < EPS);
        assert!((q1.q.y - q2.q.y).abs() < EPS);
        assert!((q1.q.z - q2.q.z).abs() < EPS);
    }

    #[test]
    fn scara_wrist_rotation_only_z() {
        // Rotación de 90° solo en Z
        let q = UnitQuaternion::from_euler(0.0, 0.0, PI / 2.0);
        let (roll, pitch, yaw) = q.to_euler();

        assert!(roll.abs() < EPS);
        assert!(pitch.abs() < EPS);
        assert!((yaw - PI / 2.0).abs() < EPS);

        // Verificar rotación de vector
        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = q.rotate_vector(v);

        assert!(rotated.x.abs() < EPS);
        assert!((rotated.y - 1.0).abs() < EPS);
        assert!(rotated.z.abs() < EPS);
    }

    #[test]
    fn complex_euler_rotation() {
        let q = UnitQuaternion::from_euler(PI / 4.0, PI / 6.0, PI / 3.0);
        let (r, p, y) = q.to_euler();

        assert!((r - PI / 4.0).abs() < 1e-6);
        assert!((p - PI / 6.0).abs() < 1e-6);
        assert!((y - PI / 3.0).abs() < 1e-6);
    }

    // ─── Tests de rotate_vector ────────────────────────────────

    #[test]
    fn identity_rotation_does_not_change_vector() {
        let q = UnitQuaternion::new(Quaternion::identity());
        let v = Vector3::new(1.0, 2.0, 3.0);
        let rotated = q.rotate_vector(v);

        assert!((rotated.x - 1.0).abs() < EPS);
        assert!((rotated.y - 2.0).abs() < EPS);
        assert!((rotated.z - 3.0).abs() < EPS);
    }

    #[test]
    fn rotation_x_90_degrees() {
        let axis = UnitVector3::new(Vector3::new(1.0, 0.0, 0.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI / 2.0);
        let v = Vector3::new(0.0, 1.0, 0.0);
        let rotated = q.rotate_vector(v);

        assert!(rotated.x.abs() < EPS);
        assert!(rotated.y.abs() < EPS);
        assert!((rotated.z - 1.0).abs() < EPS);
    }

    #[test]
    fn rotation_y_90_degrees() {
        let axis = UnitVector3::new(Vector3::new(0.0, 1.0, 0.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI / 2.0);
        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = q.rotate_vector(v);

        assert!(rotated.x.abs() < EPS);
        assert!(rotated.y.abs() < EPS);
        assert!((rotated.z + 1.0).abs() < EPS);
    }

    #[test]
    fn rotation_z_90_degrees() {
        let axis = UnitVector3::new(Vector3::new(0.0, 0.0, 1.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI / 2.0);
        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = q.rotate_vector(v);

        assert!(rotated.x.abs() < EPS);
        assert!((rotated.y - 1.0).abs() < EPS);
        assert!(rotated.z.abs() < EPS);
    }

    #[test]
    fn rotation_360_degrees_returns_to_original() {
        let axis = UnitVector3::new(Vector3::new(0.0, 0.0, 1.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, 2.0 * PI);
        let v = Vector3::new(1.0, 2.0, 3.0);
        let rotated = q.rotate_vector(v);

        assert!((rotated.x - 1.0).abs() < EPS);
        assert!((rotated.y - 2.0).abs() < EPS);
        assert!((rotated.z - 3.0).abs() < EPS);
    }

    #[test]
    fn rotation_preserves_length() {
        let axis = UnitVector3::new(Vector3::new(1.0, 2.0, 3.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI / 3.0);
        let v = Vector3::new(4.0, -5.0, 6.0);
        let rotated = q.rotate_vector(v);

        let original_sq = v.x * v.x + v.y * v.y + v.z * v.z;
        let rotated_sq = rotated.x * rotated.x + rotated.y * rotated.y + rotated.z * rotated.z;
        assert!(
            (rotated_sq - original_sq).abs() < EPS,
            "rotation should preserve squared length: {} vs {}",
            rotated_sq,
            original_sq
        );
    }

    // ─── Tests de composición ──────────────────────────────────

    #[test]
    fn composing_rotations_is_multiplication() {
        // Rotar 30° en X y luego 60° en Z = componer los cuaterniones
        let qx = UnitQuaternion::from_euler(PI / 6.0, 0.0, 0.0);
        let qz = UnitQuaternion::from_euler(0.0, 0.0, PI / 3.0);
        let composed = qz * qx;

        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = composed.rotate_vector(v);

        // Verificar que la composición produce el resultado esperado
        // (primero rotación X, luego Z)
        let expected_after_x = qx.rotate_vector(v);
        let expected = qz.rotate_vector(expected_after_x);

        assert!(
            (rotated.x - expected.x).abs() < EPS
                && (rotated.y - expected.y).abs() < EPS
                && (rotated.z - expected.z).abs() < EPS,
            "rotation composition via multiplication failed: \
             got ({:.6}, {:.6}, {:.6}), expected ({:.6}, {:.6}, {:.6})",
            rotated.x, rotated.y, rotated.z,
            expected.x, expected.y, expected.z,
        );
    }

    #[test]
    fn identity_is_multiplicative_neutral() {
        let q = UnitQuaternion::from_euler(0.2, 0.3, 0.5);
        let id = UnitQuaternion::new(Quaternion::identity());

        let r1 = q * id;
        let r2 = id * q;

        let v = Vector3::new(1.0, 2.0, 3.0);
        let v1 = r1.rotate_vector(v);
        let v2 = r2.rotate_vector(v);
        let vq = q.rotate_vector(v);

        assert!((v1.x - vq.x).abs() < EPS);
        assert!((v1.y - vq.y).abs() < EPS);
        assert!((v1.z - vq.z).abs() < EPS);
        assert!((v2.x - vq.x).abs() < EPS);
        assert!((v2.y - vq.y).abs() < EPS);
        assert!((v2.z - vq.z).abs() < EPS);
    }

    #[test]
    fn inverse_rotation_undoes_original() {
        let axis = UnitVector3::new(Vector3::new(0.0, 1.0, 0.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI / 4.0);

        // Construimos la inversa como from_axis_angle(mismo_eje, -angulo)
        let q_inv = UnitQuaternion::from_axis_angle(axis, -PI / 4.0);
        let composed = q * q_inv;

        let v = Vector3::new(1.0, 2.0, 3.0);
        let rotated = composed.rotate_vector(v);

        assert!(
            (rotated.x - v.x).abs() < EPS
                && (rotated.y - v.y).abs() < EPS
                && (rotated.z - v.z).abs() < EPS,
            "inverse rotation did not undo original: \
             got ({:.6}, {:.6}, {:.6}), expected ({:.6}, {:.6}, {:.6})",
            rotated.x, rotated.y, rotated.z,
            v.x, v.y, v.z,
        );
    }

    // ─── Tests de from_axis_angle ──────────────────────────────

    #[test]
    fn axis_angle_x_90() {
        let axis = UnitVector3::new(Vector3::new(1.0, 0.0, 0.0)).unwrap();
        approx_axis(&axis, PI / 2.0, (PI / 2.0, 0.0, 0.0), EPS);
    }

    #[test]
    fn axis_angle_y_45() {
        let axis = UnitVector3::new(Vector3::new(0.0, 1.0, 0.0)).unwrap();
        approx_axis(&axis, PI / 4.0, (0.0, PI / 4.0, 0.0), EPS);
    }

    #[test]
    fn axis_angle_z_180() {
        let axis = UnitVector3::new(Vector3::new(0.0, 0.0, 1.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI);
        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = q.rotate_vector(v);

        assert!((rotated.x + 1.0).abs() < EPS);
        assert!(rotated.y.abs() < EPS);
        assert!(rotated.z.abs() < EPS);
    }
}
