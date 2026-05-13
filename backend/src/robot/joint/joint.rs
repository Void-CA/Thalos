use crate::{math::geometry::{
    spatial::Transform,
    vectors::Vector3
}};

use crate::robot::joint::{
    prismatic::PrismaticJoint, 
    revolute::RevoluteJoint
};



#[derive(Debug, Clone, Copy)]
pub struct JointLimits {
    pub min: f64,
    pub max: f64,
}

pub enum JointType {
    Revolute(RevoluteJoint),
    Prismatic(PrismaticJoint),
}