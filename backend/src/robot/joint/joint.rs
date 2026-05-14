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
    pub fn motion(&self, q: f64) -> Transform3D {
        match self {
            JointType::Revolute(rev) => {
                let rotation = Quaternion::from_axis_angle(rev.axis, q);

                Transform3D::from_rotation(rotation)
            }

            JointType::Prismatic(pris) => {
                Transform3D::from_translation(
                    pris.direction.into_inner() * q
                )
            }
        }
    }

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
}

