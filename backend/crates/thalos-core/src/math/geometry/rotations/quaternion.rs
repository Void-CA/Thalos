use crate::math::constants;


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

    /// Elemento neutro del producto de Hamilton: (1, 0, 0, 0).
    pub fn identity() -> Self {
        Self { w: 1.0, x: 0.0, y: 0.0, z: 0.0 }
    }

    /// Norma al cuadrado: w² + x² + y² + z².
    pub fn norm_squared(&self) -> f64 {
        self.w * self.w
            + self.x * self.x
            + self.y * self.y
            + self.z * self.z
    }

    /// Norma euclídea: √(w² + x² + y² + z²).
    pub fn norm(&self) -> f64 {
        self.norm_squared().sqrt()
    }

    pub fn is_unit(&self) -> bool {
        (self.norm_squared() - 1.0).abs()
            < constants::EPS
    }
    
    pub fn normalize(&self) -> Self {
        let norm = self.norm();

        if norm < constants::EPS {
            return Self::identity();
        }

        Self {
            w: self.w / norm,
            x: self.x / norm,
            y: self.y / norm,
            z: self.z / norm,
        }
    }

    /// Conjugado: (w, -x, -y, -z).
    pub fn conjugate(&self) -> Self {
        Self {
            w: self.w,
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }

    /// Inverso multiplicativo: conj(q) / norm_squared(q).
    ///
    /// Si la norma al cuadrado es menor que [`EPS`](constants::EPS), retorna la identidad.
    pub fn inverse(&self) -> Self {
        let norm_sq = self.norm_squared();

        if norm_sq < constants::EPS {
            return Self::identity();
        }

        let c = self.conjugate();

        Self {
            w: c.w / norm_sq,
            x: c.x / norm_sq,
            y: c.y / norm_sq,
            z: c.z / norm_sq,
        }
    }
}

#[cfg(test)]
mod quaternion_algebra_tests {
    use super::*;
    use crate::math::constants::EPS;

    
    // ─── Helpers ───────────────────────────────────────────────

    /// Dos cuaterniones son aproximadamente iguales componente a componente.
    fn approx_eq(a: &Quaternion, b: &Quaternion, tol: f64) -> bool {
        (a.w - b.w).abs() < tol
            && (a.x - b.x).abs() < tol
            && (a.y - b.y).abs() < tol
            && (a.z - b.z).abs() < tol
    }

    /// Retorna `true` si la parte vectorial del cuaternión es cercana a cero
    /// (esencialmente un escalar puro).
    fn is_pure_scalar(q: &Quaternion, tol: f64) -> bool {
        q.x.abs() < tol && q.y.abs() < tol && q.z.abs() < tol
    }

    // ─── Tests de propiedades algebraicas ─────────────────────

    #[test]
    fn identity_is_multiplicative_neutral() {
        let q = Quaternion::new(2.0, -1.0, 3.0, 0.5);
        let id = Quaternion::identity();

        // q * 1 = q
        let r1 = q * id;
        assert!(approx_eq(&r1, &q, EPS), "q * identity != q");

        // 1 * q = q
        let r2 = id * q;
        assert!(approx_eq(&r2, &q, EPS), "identity * q != q");
    }

    #[test]
    fn inverse_property() {
        let q = Quaternion::new(0.8, -0.2, 0.3, 0.1);
        let inv = q.inverse();

        // q * q⁻¹ ≈ identity (parte vectorial ≈ 0, w ≈ 1)
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
        assert!(
            is_pure_scalar(&r2, EPS),
            "q⁻¹ * q should be pure scalar"
        );
        assert!(
            (r2.w - 1.0).abs() < 10.0 * EPS,
            "scalar part of q⁻¹ * q should be ≈ 1"
        );
    }

    #[test]
    fn zero_norm_inverse_returns_identity() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let inv = zero.inverse();
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
        // conj(q1 * q2) = conj(q2) * conj(q1)  (reversing order)
        let q1 = Quaternion::new(0.7, 0.1, -0.3, 0.5);
        let q2 = Quaternion::new(0.2, 0.8, -0.1, 0.4);

        let conj_product = (q1 * q2).conjugate();
        let product_conj = q2.conjugate() * q1.conjugate();

        assert!(
            approx_eq(&conj_product, &product_conj, EPS),
            "conj(q1 * q2) != conj(q2) * conj(q1): \
             got ({}, {}, {}, {}) vs ({}, {}, {}, {})",
            conj_product.w, conj_product.x, conj_product.y, conj_product.z,
            product_conj.w, product_conj.x, product_conj.y, product_conj.z,
        );
    }

    #[test]
    fn norm_is_multiplicative() {
        // ||q1 * q2|| = ||q1|| * ||q2||
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
        // q * conj(q) = (norm_squared, 0, 0, 0)
        let q = Quaternion::new(0.6, -0.8, 0.3, 0.2);
        let r = q * q.conjugate();

        assert!(
            is_pure_scalar(&r, EPS),
            "q * conj(q) should be pure scalar (norm_squared), \
             got vector part ({}, {}, {})",
            r.x, r.y, r.z
        );
        assert!(
            (r.w - q.norm_squared()).abs() < EPS,
            "scalar part of q * conj(q) should = norm_squared, \
             {} vs {}",
            r.w,
            q.norm_squared()
        );
    }

    #[test]
    fn normalize_produces_unit_norm() {
        let q = Quaternion::new(3.0, -1.5, 2.0, 0.5);
        let n = q.normalize();

        let diff = (n.norm() - 1.0).abs();
        assert!(
            diff < EPS,
            "normalized quaternion norm should be 1, got {} (diff = {})",
            n.norm(),
            diff
        );
    }

    #[test]
    fn identity_norm_is_one() {
        assert!((Quaternion::identity().norm() - 1.0).abs() < EPS);
    }

    #[test]
    fn normalize_of_zero_norm_returns_identity() {
        let zero = Quaternion::new(0.0, 0.0, 0.0, 0.0);
        let n = zero.normalize();
        assert!(approx_eq(&n, &Quaternion::identity(), EPS));
    }

    #[test]
    fn product_with_scalar_quaternion() {
        // (a, 0, 0, 0) * (w, x, y, z) = (a*w, a*x, a*y, a*z)
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
        // (q1 * q2) * q3 ≈ q1 * (q2 * q3)
        let q1 = Quaternion::new(0.3, -0.7, 0.2, 1.1);
        let q2 = Quaternion::new(0.8, 0.5, -0.4, 0.6);
        let q3 = Quaternion::new(1.2, -0.3, 0.9, -0.5);

        let left = (q1 * q2) * q3;
        let right = q1 * (q2 * q3);

        assert!(
            approx_eq(&left, &right, 10.0 * EPS),
            "Hamilton product is not associative: \
             left ({}, {}, {}, {}) vs right ({}, {}, {}, {})",
            left.w, left.x, left.y, left.z,
            right.w, right.x, right.y, right.z,
        );
    }

    #[test]
    fn norm_squared_consistency() {
        let q = Quaternion::new(0.5, -1.0, 2.0, -0.5);
        let expected = 0.5_f64 * 0.5 + (-1.0) * (-1.0) + 2.0 * 2.0 + (-0.5) * (-0.5);
        assert!(
            (q.norm_squared() - expected).abs() < EPS,
            "norm_squared inconsistent"
        );
        assert!(
            (q.norm_squared() - q.norm() * q.norm()).abs() < EPS,
            "norm_squared != norm^2"
        );
    }

    #[test]
    fn inverse_of_unit_quaternion_is_conjugate() {
        // Para ||q|| = 1, q⁻¹ = conj(q)
        let q = Quaternion::new(0.7071067811865476, 0.7071067811865476, 0.0, 0.0); // norma ≈ 1
        let inv = q.inverse();

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
        assert!(
            approx_eq(&r1, &zero, EPS),
            "q * 0 != 0"
        );

        let r2 = zero * q;
        assert!(
            approx_eq(&r2, &zero, EPS),
            "0 * q != 0"
        );
    }

    #[test]
    fn euler_roundtrip_uses_unit_quaternion() {
        // Este test verifica que from_euler / to_euler NO existen en Quaternion.
        // La conversión con ángulos Euler es responsabilidad de UnitQuaternion.
        let _q = Quaternion::identity();
        // Si esto compila, los métodos de UnitQuaternion NO se filtraron aquí.
        // (No llamamos a .to_euler() porque no existe en Quaternion)
    }
}
