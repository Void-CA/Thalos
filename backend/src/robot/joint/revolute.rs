use crate::math::geometry::{
    vector3::Vector3,
    transform::Transform,
    quaternion::Quaternion
};

use crate::robot::joint::joint::{Joint, JointLimits};

struct RevoluteJoint {
    axis: Vector3,
    angle_limits: JointLimits,
    offset: Transform,
}

impl Joint for RevoluteJoint {
    fn axis(&self) -> Vector3 {
        self.axis
    }

    fn limits(&self) -> JointLimits {
        self.angle_limits
    }

    fn transform(&self, q : f64) -> Transform {
        let rotation = Transform::from_rotation(Quaternion::from_axis_angle(self.axis, q));
        self.offset * rotation
    }
    
}