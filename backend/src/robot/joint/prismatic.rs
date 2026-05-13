use crate::robot::joint::joint::JointLimits;
use crate::math::geometry::
    vectors::UnitVector3;


pub struct PrismaticJoint {
    pub direction: UnitVector3,
    pub distance_limits: JointLimits,
}
