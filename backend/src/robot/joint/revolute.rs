use crate::{
    math::geometry::vectors::UnitVector3, 
    robot::joint::joint::{JointId, JointLimits}};


pub struct RevoluteJoint {
    pub id: JointId,
    pub axis: UnitVector3,
    pub limits: JointLimits,
}

impl RevoluteJoint {
    pub fn new(id: JointId, axis: UnitVector3, limits: JointLimits) -> Self {
        Self {
            id,
            axis,
            limits,
        }
    }
}