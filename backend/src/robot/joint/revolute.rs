use crate::{
    math::geometry::{spatial::Transform3D, vectors::UnitVector3}, 
    robot::joint::joint::{JointId, JointLimits}};


pub struct RevoluteJoint {
    pub id: JointId,
    pub axis: UnitVector3,
    pub limits: JointLimits,
    pub origin: Transform3D
}

impl RevoluteJoint {
    pub fn new(id: JointId, axis: UnitVector3, limits: JointLimits, origin: Transform3D) -> Self {
        Self {
            id,
            axis,
            limits,
            origin
        }
    }
}