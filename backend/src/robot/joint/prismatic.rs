use crate::robot::joint::joint::{Joint, JointLimits};
use crate::math::geometry::{
    vectors::Vector3,
    spatial::Transform
}

struct PrismaticJoint {
    axis: Vector3,
    distance_limits: JointLimits,
    offset: Transform,
}

impl Joint for PrismaticJoint {
    fn axis(&self) -> Vector3 {
        self.axis
    }

    fn limits(&self) -> JointLimits {
        self.distance_limits
    }

    fn transform(&self, q : f64) -> Transform {
        let translation = self.axis * q;
        self.offset * Transform::from_translation(translation)
    }
}