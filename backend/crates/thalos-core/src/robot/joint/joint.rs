use crate::math::geometry::rigid::{Transform3D, transform};

use crate::math::geometry::vectors::UnitVector3;
use crate::robot::joint::{
    prismatic::PrismaticJoint, 
    revolute::RevoluteJoint,
    kind::JointKind
};


pub type JointId = u32;

#[derive(Debug, Clone, Copy)]
pub struct JointLimits {
    pub min: f64,
    pub max: f64,
}

impl JointLimits {
    pub fn new(min: f64, max: f64) -> Self {
        Self { min, max }
    }
}


#[derive(Debug, Clone)]
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

    pub fn axis(&self) -> UnitVector3 {
        match self {
            JointType::Revolute(j) => j.axis,
            JointType::Prismatic(j) => j.direction,
        }
    }

    pub fn kind(&self) -> JointKind {
        match self {
            JointType::Revolute(_) => JointKind::Revolute,
            JointType::Prismatic(_) => JointKind::Prismatic,
        }
    }

    pub fn axis_world(
        &self,
        transform: &Transform3D,
    ) -> UnitVector3 {

        let axis_local = self.axis();

        let rotated =
            transform
                .rotation
                .rotate_vector(axis_local.into_inner());

        UnitVector3::new(rotated).unwrap()
    }
}

