use crate::math::geometry::{
    rotations::quaternion::Quaternion,
    spatial::Transform3D
};

use crate::robot::joint::{
    prismatic::PrismaticJoint, 
    revolute::RevoluteJoint
};


pub type JointId = u32;

#[derive(Debug, Clone, Copy)]
pub struct JointLimits {
    pub min: f64,
    pub max: f64,
}

pub enum JointType {
    Revolute(RevoluteJoint),
    Prismatic(PrismaticJoint),
}

impl JointType {
    pub fn limits(&self) -> JointLimits {
        match self {
            JointType::Revolute(rev) => rev.limits,
            JointType::Prismatic(pris) => pris.distance_limits,
        }
    }

    pub fn id(&self) -> JointId {
        match self {
            JointType::Revolute(rev) => rev.id,
            JointType::Prismatic(pris) => pris.id,
        }
    }

    pub fn motion(&self, q: f64) -> Transform3D {
        match self {
            JointType::Revolute(j) => j.motion(q),
            JointType::Prismatic(j) => j.motion(q),
        }
    }

    pub fn origin(&self) -> &Transform3D {
        match self {
            JointType::Revolute(j) => &j.origin,
            JointType::Prismatic(j) => &j.origin,
        }
    }
}

