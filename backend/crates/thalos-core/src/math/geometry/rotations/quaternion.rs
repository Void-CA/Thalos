use crate::math::{constants, error::MathError};

#[derive(Debug, Clone, Copy)]
pub struct Quaternion {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Quaternion {
    pub fn new(w: f64, x: f64, y: f64, z: f64) -> Self {
        Self { w, x, y, z }
    }
    pub fn identity() -> Self {
        Self { w: 1.0, x: 0.0, y: 0.0, z: 0.0 }
    }
    pub fn norm_squared(&self) -> f64 {
        self.w * self.w
            + self.x * self.x
            + self.y * self.y
            + self.z * self.z
    }
    pub fn norm(&self) -> f64 {
        self.norm_squared().sqrt()
    }
    pub fn is_unit(&self) -> bool {
        (self.norm_squared() - 1.0).abs() < constants::EPS
    }
    pub fn normalize(&self) -> Result<Self, MathError> {
        let norm = self.norm();

        if norm < constants::EPS {
            return Err(MathError::ZeroQuaternionNormalization);
        }

        Ok(Self {
            w: self.w / norm,
            x: self.x / norm,
            y: self.y / norm,
            z: self.z / norm,
        })
    }
    pub fn normalize_or_identity(&self) -> Self {
        self.normalize().unwrap_or_else(|_| Self::identity())
    }
    pub fn conjugate(&self) -> Self {
        Self {
            w: self.w,
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }
    pub fn inverse(&self) -> Result<Self, MathError> {
        let norm_sq = self.norm_squared();

        if norm_sq < constants::EPS {
            return Err(MathError::ZeroQuaternionInverse { norm_sq });
        }

        let c = self.conjugate();

        Ok(Self {
            w: c.w / norm_sq,
            x: c.x / norm_sq,
            y: c.y / norm_sq,
            z: c.z / norm_sq,
        })
    }
    pub fn inverse_or_identity(&self) -> Self {
        self.inverse().unwrap_or_else(|_| Self::identity())
    }
}

#[cfg(test)]
mod quaternion_algebra_tests {
    use super::*;
    use crate::math::constants::EPS;

    // ─── Helpers ───────────────────────────────────────────────

    fn approx_eq(a: &Quaternion, b: &Quaternion, tol: f64) -> bool {
        (a.w - b.w).abs() < tol
            && (a.x - b.x).abs() < tol
            && (a.y - b.y).abs() < tol
            && (a.z - b.z).abs() < tol
    }

    fn is_pure_scalar(q: &Quaternion, tol: f64) -> bool {
        q.x.abs() < tol && q.y.abs() < tol && q.z.abs() < tol
    }

    // ─── Tests de propiedades algebraicas ─────────────────────

    #[test]
    fn identity_is_multiplicative_neutral() {
        let q = Quaternion::new(2.0, -1.0, 3.0, 0.5);
        let id = Quaternion::identity();

        let r1 = q * id;
        assert!(approx_eq(&r1, &q, EPS), "q * identity != q");

        let r2 = id * q;
        assert!(approx_eq(&r2, &q, EPS), "identity * q != q");
    }

    #[test]
    fn inverse_property() {
        let q = Quaternion::new(0.8, -0.2, 0.3, 0.1);
        let inv = q.inverse().unwrap();

        // q * q⁻¹ ≈ identity
        let r1 = q * inv;
        assert!(
            is_pure_scalar(&r1, EPS),
            "q * q⁻¹ should be pure scalar, got ({}, {}, {}, {})",
            r1.w, r1.x, r1.y, r1.z
        );
        assert!(
            (r1.w - 1.0).abs() < 10.0 * EPS,
            "scalar part of q * q⁻¹ should be ≈ 1, got {}",
            r1.w
        );

        // q⁻¹ * q ≈ identity
        let r2 = inv * q;
        assert!(is_pure_scalar(&r2, EPS), "q⁻¹ * q should be pure scalar");
        assert!(
            (r2.w - 1.0).abs() < 10.0 * EPS,
            "scalar part of q⁻¹ * q should be ≈ 1"
        );
    }

    #[test]
    fn zero_norm_inverse_returns_error() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let result = zero.inverse();
        assert!(result.is_err(), "inverse of zero should error");
    }

    #[test]
    fn zero_norm_inverse_or_identity_returns_identity() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let inv = zero.inverse_or_identity();
        assert!(approx_eq(&inv, &Quaternion::identity(), EPS));
    }

    #[test]
    fn conjugate_definition() {
        let q = Quaternion::new(1.0, 2.0, 3.0, 4.0);
        let conj = q.conjugate();

        assert_eq!(conj.w, 1.0);
        assert_eq!(conj.x, -2.0);
        assert_eq!(conj.y, -3.0);
        assert_eq!(conj.z, -4.0);
    }

    #[test]
    fn double_conjugate_is_identity_on_algebra() {
        let q = Quaternion::new(0.5, -1.2, 3.7, 0.0);
        assert!(approx_eq(&q.conjugate().conjugate(), &q, EPS));
    }

    #[test]
    fn conjugate_of_product() {
        let q1 = Quaternion::new(0.7, 0.1, -0.3, 0.5);
        let q2 = Quaternion::new(0.2, 0.8, -0.1, 0.4);

        let conj_product = (q1 * q2).conjugate();
        let product_conj = q2.conjugate() * q1.conjugate();

        assert!(
            approx_eq(&conj_product, &product_conj, EPS),
            "conj(q1 * q2) != conj(q2) * conj(q1)"
        );
    }

    #[test]
    fn norm_is_multiplicative() {
        let q1 = Quaternion::new(2.0, -0.5, 1.5, 0.3);
        let q2 = Quaternion::new(0.7, 1.2, -0.8, 0.1);

        let norm_product = (q1 * q2).norm();
        let product_norm = q1.norm() * q2.norm();

        assert!(
            (norm_product - product_norm).abs() < 10.0 * EPS,
            "norm(q1 * q2) != norm(q1) * norm(q2): {} vs {}",
            norm_product,
            product_norm
        );
    }

    #[test]
    fn q_times_conjugate_gives_scalar() {
        let q = Quaternion::new(0.6, -0.8, 0.3, 0.2);
        let r = q * q.conjugate();

        assert!(
            is_pure_scalar(&r, EPS),
            "q * conj(q) should be pure scalar, got vector part ({}, {}, {})",
            r.x, r.y, r.z
        );
        assert!(
            (r.w - q.norm_squared()).abs() < EPS,
            "scalar part should = norm_squared, {} vs {}",
            r.w,
            q.norm_squared()
        );
    }

    #[test]
    fn normalize_produces_unit_norm() {
        let q = Quaternion::new(3.0, -1.5, 2.0, 0.5);
        let n = q.normalize().unwrap();

        let diff = (n.norm() - 1.0).abs();
        assert!(
            diff < EPS,
            "normalized quaternion norm should be 1, got {} (diff = {})",
            n.norm(),
            diff
        );
    }

    #[test]
    fn normalize_of_zero_returns_error() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let result = zero.normalize();
        assert!(result.is_err(), "normalize of zero should error");
    }

    #[test]
    fn normalize_or_identity_of_zero_returns_identity() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let n = zero.normalize_or_identity();
        assert!(approx_eq(&n, &Quaternion::identity(), EPS));
    }

    #[test]
    fn identity_norm_is_one() {
        assert!((Quaternion::identity().norm() - 1.0).abs() < EPS);
    }

    #[test]
    fn product_with_scalar_quaternion() {
        let scalar = Quaternion::new(3.0, 0.0, 0.0, 0.0);
        let q = Quaternion::new(0.5, -0.2, 0.1, 0.4);
        let r = scalar * q;

        assert!(
            (r.w - 3.0 * 0.5).abs() < EPS
                && (r.x - 3.0 * -0.2).abs() < EPS
                && (r.y - 3.0 * 0.1).abs() < EPS
                && (r.z - 3.0 * 0.4).abs() < EPS,
            "scalar multiplication in Hamilton product failed"
        );
    }

    #[test]
    fn associativity_of_product() {
        let q1 = Quaternion::new(0.3, -0.7, 0.2, 1.1);
        let q2 = Quaternion::new(0.8, 0.5, -0.4, 0.6);
        let q3 = Quaternion::new(1.2, -0.3, 0.9, -0.5);

        let left = (q1 * q2) * q3;
        let right = q1 * (q2 * q3);

        assert!(
            approx_eq(&left, &right, 10.0 * EPS),
            "Hamilton product is not associative"
        );
    }

    #[test]
    fn norm_squared_consistency() {
        let q = Quaternion::new(0.5, -1.0, 2.0, -0.5);
        let expected = 0.5_f64 * 0.5 + (-1.0) * (-1.0) + 2.0 * 2.0 + (-0.5) * (-0.5);
        assert!((q.norm_squared() - expected).abs() < EPS);
        assert!((q.norm_squared() - q.norm() * q.norm()).abs() < EPS);
    }

    #[test]
    fn inverse_of_unit_quaternion_is_conjugate() {
        let q = Quaternion::new(0.7071067811865476, 0.7071067811865476, 0.0, 0.0);
        let inv = q.inverse().unwrap();

        assert!(
            approx_eq(&inv, &q.conjugate(), EPS),
            "for unit quaternion, inverse should equal conjugate"
        );
    }

    #[test]
    fn product_with_zero() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let q = Quaternion::new(1.0, 2.0, 3.0, 4.0);

        let r1 = q * zero;
        assert!(approx_eq(&r1, &zero, EPS), "q * 0 != 0");

        let r2 = zero * q;
        assert!(approx_eq(&r2, &zero, EPS), "0 * q != 0");
    }

    #[test]
    fn error_messages_are_descriptive() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);

        let inv_err = zero.inverse().unwrap_err();
        let msg = inv_err.to_string();
        assert!(
            msg.contains("norm"),
            "inverse error should mention norm, got: {}",
            msg
        );

        let norm_err = zero.normalize().unwrap_err();
        let msg = norm_err.to_string();
        assert!(
            msg.contains("normalize"),
            "normalize error should mention normalize, got: {}",
            msg
        );
    }

    #[test]
    fn is_unit_detects_unit_quaternions() {
        let id = Quaternion::identity();
        assert!(id.is_unit());

        let q = Quaternion::new(0.7071067811865476, 0.7071067811865476, 0.0, 0.0);
        assert!(q.is_unit());

        let not_unit = Quaternion::new(2.0, 0.0, 0.0, 0.0);
        assert!(!not_unit.is_unit());
    }
}
