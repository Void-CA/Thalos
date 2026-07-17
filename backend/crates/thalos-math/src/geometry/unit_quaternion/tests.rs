use super::*;
use crate::{constants::EPS, Quaternion, UnitVector3, Vector3};

fn uq(w: f64, x: f64, y: f64, z: f64) -> UnitQuaternion {
        let q = Quaternion::new(w, x, y, z);
        let norm = q.norm();
        UnitQuaternion {
            q: Quaternion::new(w / norm, x / norm, y / norm, z / norm),
        }
    }

    #[test]
    fn unit_norm_invariant() {
        let uq = uq(0.707, 0.707, 0.0, 0.0);
        assert!((uq.inner().norm() - 1.0).abs() < 1e-3);
    }

    #[test]
    fn euler_roundtrip() {
        let original = (0.3, -0.5, 0.8);
        let q = UnitQuaternion::from_euler_angles(original.0, original.1, original.2);
        let result = q.to_euler_angles();
        assert!((result.0 - original.0).abs() < EPS);
        assert!((result.1 - original.1).abs() < EPS);
        assert!((result.2 - original.2).abs() < EPS);
    }

    #[test]
    fn rotate_vector_preserves_length() {
        let q = uq(0.707, 0.0, 0.707, 0.0);
        let v = Vector3::new(1.0, 0.0, 0.0);
        let r = q.rotate_vector(v);
        assert!((r.magnitude() - 1.0).abs() < EPS);
    }

    #[test]
    fn slerp_identity_at_t0() {
        let a = uq(1.0, 0.0, 0.0, 0.0);
        let b = uq(0.0, 1.0, 0.0, 0.0);
        let r = a.slerp(&b, 0.0);
        assert!((r.inner().w - 1.0).abs() < EPS);
    }

    #[test]
    fn slerp_identity_at_t1() {
        let a = uq(1.0, 0.0, 0.0, 0.0);
        let b = uq(0.0, 1.0, 0.0, 0.0);
        let r = a.slerp(&b, 1.0);
        assert!((r.inner().w - 0.0).abs() < EPS);
        assert!((r.inner().x - 1.0).abs() < EPS);
    }

    #[test]
    fn from_axis_angle_roundtrip() {
        let axis = UnitVector3::new_normalize(Vector3::new(1.0, 0.0, 0.0));
        let q = UnitQuaternion::from_axis_angle(axis, 0.5);
        let (roll, pitch, yaw) = q.to_euler_angles();
        assert!((roll - 0.5).abs() < EPS);
        assert!((pitch).abs() < EPS);
        assert!((yaw).abs() < EPS);
    }

    #[test]
    fn rotation_between_parallel_vectors() {
        let a = Vector3::new(1.0, 0.0, 0.0);
        let b = Vector3::new(2.0, 0.0, 0.0);
        let q = UnitQuaternion::rotation_between(a, b);
        let rotated = q.rotate_vector(a);
        assert!((rotated - Vector3::new(1.0, 0.0, 0.0)).magnitude() < EPS);
    }

    #[test]
    fn rotation_between_orthogonal_vectors() {
        let a = Vector3::new(1.0, 0.0, 0.0);
        let b = Vector3::new(0.0, 1.0, 0.0);
        let q = UnitQuaternion::rotation_between(a, b);
        let rotated = q.rotate_vector(a);
        assert!((rotated - b).magnitude() < EPS,
            "rotated ({:.4}, {:.4}, {:.4}) != target ({:.4}, {:.4}, {:.4})",
            rotated.x, rotated.y, rotated.z, b.x, b.y, b.z);
    }