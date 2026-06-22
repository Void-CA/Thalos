use std::ops::Mul;
use crate::{Quaternion, UnitVector3, Vector3, traits::Cross, MathError};

#[derive(Debug, Clone, Copy)]
pub struct UnitQuaternion {
    q: Quaternion,
}

impl UnitQuaternion {
    pub fn new(q: Quaternion) -> Result<Self, MathError> {
        if !q.is_unit() {
            return Err(MathError::QuaternionNotUnit {
                norm_sq: q.norm_squared(),
            });
        }
        Ok(Self { q })
    }

    pub fn from_quaternion_unchecked(q: Quaternion) -> Self {
        Self { q }
    }

    pub fn inner(&self) -> &Quaternion {
        &self.q
    }

    pub fn into_inner(self) -> Quaternion {
        self.q
    }

    pub fn identity() -> Self {
        Self { q: Quaternion::identity() }
    }

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

        // Pitch (Y) — gimbal lock protection
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

    pub fn from_euler(roll: f64, pitch: f64, yaw: f64) -> Self {
        let cy = (yaw * 0.5).cos();
        let sy = (yaw * 0.5).sin();
        let cp = (pitch * 0.5).cos();
        let sp = (pitch * 0.5).sin();
        let cr = (roll * 0.5).cos();
        let sr = (roll * 0.5).sin();

        Self {
            q: Quaternion {
                w: cr * cp * cy + sr * sp * sy,
                x: sr * cp * cy - cr * sp * sy,
                y: cr * sp * cy + sr * cp * sy,
                z: cr * cp * sy - sr * sp * cy,
            },
        }
    }

    pub fn inverse(&self) -> Self {
        Self { q: self.q.conjugate() }
    }
}

impl Mul for UnitQuaternion {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self {
        Self { q: self.q * rhs.q }
    }
}

#[cfg(test)]
mod unit_quaternion_tests {
    use super::*;
    use crate::constants::EPS;
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

    // ─── Tests de construcción ─────────────────────────────────

    #[test]
    fn new_accepts_unit_quaternion() {
        let q = Quaternion::identity();
        assert!(UnitQuaternion::new(q).is_ok());
    }

    #[test]
    fn new_rejects_non_unit_quaternion() {
        let q = Quaternion::new(2.0, 0.0, 0.0, 0.0);
        let result = UnitQuaternion::new(q);
        assert!(result.is_err(), "should reject non-unit quaternion");

        let err = result.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("norm"), "error should mention norm²");
    }

    #[test]
    fn from_quaternion_unchecked_does_not_validate() {
        let q = Quaternion::new(2.0, 0.0, 0.0, 0.0);
        let uq = UnitQuaternion::from_quaternion_unchecked(q);
        assert!((uq.inner().norm() - 2.0).abs() < EPS);
    }

    #[test]
    fn inner_and_into_inner_roundtrip() {
        let uq = UnitQuaternion::identity();
        assert!(uq.inner().is_unit());
        let q: Quaternion = uq.into_inner();
        assert!(q.is_unit());
    }

    // ─── Tests de Euler ────────────────────────────────────────

    #[test]
    fn identity_euler_angles_are_zero() {
        let q = UnitQuaternion::identity();
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

        assert!((original.0 - converted.0).abs() < EPS, "roll mismatch");
        assert!((original.1 - converted.1).abs() < EPS, "pitch mismatch");
        assert!((original.2 - converted.2).abs() < EPS, "yaw mismatch");
    }

    #[test]
    fn from_euler_preserves_invariant() {
        let q = UnitQuaternion::from_euler(PI / 3.0, PI / 4.0, PI / 6.0);
        assert!(q.inner().is_unit(), "from_euler should produce unit quaternion");
    }

    #[test]
    fn from_euler_angles_are_deterministic() {
        let q1 = UnitQuaternion::from_euler(PI / 2.0, 0.0, 0.0);
        let q2 = UnitQuaternion::from_euler(PI / 2.0, 0.0, 0.0);

        assert!((q1.inner().w - q2.inner().w).abs() < EPS);
        assert!((q1.inner().x - q2.inner().x).abs() < EPS);
        assert!((q1.inner().y - q2.inner().y).abs() < EPS);
        assert!((q1.inner().z - q2.inner().z).abs() < EPS);
    }

    #[test]
    fn scara_wrist_rotation_only_z() {
        let q = UnitQuaternion::from_euler(0.0, 0.0, PI / 2.0);
        let (roll, pitch, yaw) = q.to_euler();

        assert!(roll.abs() < EPS);
        assert!(pitch.abs() < EPS);
        assert!((yaw - PI / 2.0).abs() < EPS);

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
        let q = UnitQuaternion::identity();
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
            "rotation should preserve squared length"
        );
    }

    // ─── Tests de composición ──────────────────────────────────

    #[test]
    fn composing_rotations_is_multiplication() {
        let qx = UnitQuaternion::from_euler(PI / 6.0, 0.0, 0.0);
        let qz = UnitQuaternion::from_euler(0.0, 0.0, PI / 3.0);
        let composed = qz * qx;

        let v = Vector3::new(1.0, 0.0, 0.0);
        let rotated = composed.rotate_vector(v);

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
    fn composition_preserves_invariant() {
        let q1 = UnitQuaternion::from_euler(0.2, 0.3, 0.5);
        let q2 = UnitQuaternion::from_euler(0.1, 0.4, 0.6);
        let composed = q1 * q2;
        assert!(
            composed.inner().is_unit(),
            "product of unit quaternions should be unit"
        );
    }

    #[test]
    fn identity_is_multiplicative_neutral() {
        let q = UnitQuaternion::from_euler(0.2, 0.3, 0.5);
        let id = UnitQuaternion::identity();

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

        let q_inv = q.inverse();
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

    #[test]
    fn inverse_has_the_same_norm() {
        let q = UnitQuaternion::from_euler(0.3, 0.5, 0.7);
        let inv = q.inverse();
        assert!(
            (q.inner().norm() - inv.inner().norm()).abs() < EPS,
            "inverse should preserve norm"
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

    #[test]
    fn from_axis_angle_preserves_invariant() {
        let axis = UnitVector3::new(Vector3::new(0.0, 0.0, 1.0)).unwrap();
        let q = UnitQuaternion::from_axis_angle(axis, PI / 3.0);
        assert!(
            q.inner().is_unit(),
            "from_axis_angle should produce unit quaternion"
        );
    }

    #[test]
    fn product_preserves_invariant_after_many_compositions() {
        let axis = UnitVector3::new(Vector3::new(0.0, 0.0, 1.0)).unwrap();
        let step = UnitQuaternion::from_axis_angle(axis, 0.001);
        let mut q = UnitQuaternion::identity();

        for _ in 0..1000 {
            q = q * step;
        }

        assert!(
            q.inner().is_unit(),
            "after 1000 compositions, product should still be unit. norm = {}",
            q.inner().norm()
        );
    }
}
