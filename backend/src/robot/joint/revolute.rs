use crate::{
    math::geometry::vectors::UnitVector3, 
    robot::joint::joint::JointLimits};


pub struct RevoluteJoint {
    axis: UnitVector3,
    limits: JointLimits,
}
