use crate::math::geometry::spatial::Transform3D;
use crate::robot::joint::joint::{JointLimits, JointId};
use crate::math::geometry::
    vectors::UnitVector3;

pub struct PrismaticJoint {
    pub id: JointId,
    pub direction: UnitVector3,
    pub distance_limits: JointLimits,
    pub origin: Transform3D
}

impl PrismaticJoint {
    pub fn new(id: JointId, direction: UnitVector3, distance_limits: JointLimits, origin: Transform3D) -> Self {
        Self {
            id,
            direction,
            distance_limits,
            origin  
        }
    }
}
