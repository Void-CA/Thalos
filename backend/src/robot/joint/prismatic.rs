use crate::robot::joint::joint::JointLimits;
use crate::math::geometry::
    vectors::Vector3;


pub struct PrismaticJoint {
    axis: Vector3,
    distance_limits: JointLimits,
}
