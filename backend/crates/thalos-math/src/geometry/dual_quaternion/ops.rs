use std::ops::Mul;
use crate::Quaternion;
use super::model::DualQuaternion;

impl Mul for DualQuaternion {
    type Output = Self;

    /// Dual quaternion multiplication: (a_r + ε a_d)(b_r + ε b_d)
    /// = a_r * b_r + ε (a_r * b_d + a_d * b_r)
    fn mul(self, rhs: Self) -> Self {
        Self {
            real: self.real * rhs.real,
            dual: self.real * rhs.dual + self.dual * rhs.real,
        }
    }
}

impl Mul<Quaternion> for DualQuaternion {
    type Output = Self;

    /// Multiply dual quaternion by a pure rotation quaternion on the right.
    fn mul(self, rhs: Quaternion) -> Self {
        Self {
            real: self.real * rhs,
            dual: self.dual * rhs,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::EPS;

    #[test]
    fn multiplication_with_identity() {
        let dq = DualQuaternion::from_rotation_translation(
            Quaternion::identity(),
            [1.0, 2.0, 3.0],
        );
        let id = DualQuaternion::identity();
        let r = dq * id;
        let t = r.translation();
        assert!((t[0] - 1.0).abs() < EPS);
        assert!((t[1] - 2.0).abs() < EPS);
        assert!((t[2] - 3.0).abs() < EPS);
    }
}
