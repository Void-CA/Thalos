use crate::{
    math::geometry::vectors::UnitVector3, 
    robot::joint::joint::JointLimits};


pub struct RevoluteJoint {
    pub axis: UnitVector3,
    pub limits: JointLimits,
}
