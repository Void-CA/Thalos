use crate::Quaternion;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DualQuaternion {
    pub real: Quaternion,
    pub dual: Quaternion,
}

impl DualQuaternion {
    pub fn new(real: Quaternion, dual: Quaternion) -> Self {
        Self { real, dual }
    }

    /// Identity transform (zero rotation, zero translation).
    pub fn identity() -> Self {
        Self {
            real: Quaternion::identity(),
            dual: Quaternion::new(0.0, 0.0, 0.0, 0.0),
        }
    }

    /// Create a dual quaternion from a rotation + translation.
    pub fn from_rotation_translation(rotation: Quaternion, translation: [f64; 3]) -> Self {
        let q = rotation;
        // t * q  where t is pure quaternion (0, tx, ty, tz)
        let dual = Quaternion::new(
            -0.5 * (translation[0] * q.x + translation[1] * q.y + translation[2] * q.z),
             0.5 * (translation[0] * q.w + translation[1] * q.z - translation[2] * q.y),
             0.5 * (-translation[0] * q.z + translation[1] * q.w + translation[2] * q.x),
             0.5 * (translation[0] * q.y - translation[1] * q.x + translation[2] * q.w),
        );
        Self { real: q, dual }
    }

    /// Extract the translation vector from the dual quaternion.
    pub fn translation(&self) -> [f64; 3] {
        let q = self.real;
        let q_d = self.dual;
        let conj = Quaternion::new(q.w, -q.x, -q.y, -q.z);
        let t = q_d * conj;
        [2.0 * t.x, 2.0 * t.y, 2.0 * t.z]
    }
}

impl std::fmt::Display for DualQuaternion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({}, {})", self.real, self.dual)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::EPS;

    #[test]
    fn identity_has_zero_translation() {
        let dq = DualQuaternion::identity();
        let t = dq.translation();
        assert!(t[0].abs() < EPS);
        assert!(t[1].abs() < EPS);
        assert!(t[2].abs() < EPS);
    }

    #[test]
    fn translation_roundtrip() {
        let rot = Quaternion::identity();
        let trans = [1.0, 2.0, 3.0];
        let dq = DualQuaternion::from_rotation_translation(rot, trans);
        let t = dq.translation();
        assert!((t[0] - 1.0).abs() < EPS);
        assert!((t[1] - 2.0).abs() < EPS);
        assert!((t[2] - 3.0).abs() < EPS);
    }
}
