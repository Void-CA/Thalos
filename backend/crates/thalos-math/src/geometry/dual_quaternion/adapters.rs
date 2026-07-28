use super::model::DualQuaternion;
use crate::{Quaternion, Transform3D, UnitQuaternion, Vector3};

impl From<Transform3D> for DualQuaternion {
    fn from(t: Transform3D) -> Self {
        let rotation = t.rotation;
        let translation = [t.translation.x, t.translation.y, t.translation.z];
        Self::from_rotation_translation(rotation.into_inner(), translation)
    }
}

impl From<DualQuaternion> for Transform3D {
    fn from(dq: DualQuaternion) -> Self {
        let uq = UnitQuaternion::from_quaternion_unchecked(dq.real);
        let [x, y, z] = dq.translation();
        Transform3D::from_translation_rotation(Vector3::new(x, y, z), uq)
    }
}
