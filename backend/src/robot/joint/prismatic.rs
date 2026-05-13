use crate::robot::joint::joint::Joint;

struct PrismaticJoint {
    axis: Vector3,
    distance_limits: (f64, f64),
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