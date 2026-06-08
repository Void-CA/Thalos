use crate::math::geometry::rigid::Transform3D;

use crate::math::geometry::vectors::UnitVector3;
use crate::robot::joint::{
    fixed::FixedJoint,
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

    /// Recorta un valor al rango [min, max].
    /// Para prismáticos con topes duros.
    pub fn clamp(&self, value: f64) -> f64 {
        value.clamp(self.min, self.max)
    }

    /// Normaliza un valor angular al rango [min, max] usando wrapping
    /// modular. Para revolutos continuos como [-π, π].
    ///
    /// Si el rango es inválido (min >= max), cae a [`clamp`] para evitar
    /// NaN en la operación `%`.
    pub fn wrap(&self, value: f64) -> f64 {
        let range = self.max - self.min;
        if range <= 0.0 {
            return self.clamp(value);
        }
        let mut wrapped = (value - self.min) % range;
        if wrapped < 0.0 {
            wrapped += range;
        }
        wrapped + self.min
    }
}


#[derive(Debug, Clone)]
pub enum JointType {
    Revolute(RevoluteJoint),
    Prismatic(PrismaticJoint),
    Fixed(FixedJoint),
}

impl JointType {
    /// Número de grados de libertad que aporta este joint.
    ///
    /// - `Revolute`, `Prismatic` → 1
    /// - `Fixed` → 0
    pub fn dof(&self) -> usize {
        match self {
            JointType::Revolute(_) | JointType::Prismatic(_) => 1,
            JointType::Fixed(_) => 0,
        }
    }

    pub fn limits(&self) -> JointLimits {
        match self {
            JointType::Revolute(rev) => rev.limits,
            JointType::Prismatic(pris) => pris.distance_limits,
            JointType::Fixed(_) => JointLimits { min: 0.0, max: 0.0 },
        }
    }

    pub fn id(&self) -> JointId {
        match self {
            JointType::Revolute(rev) => rev.id,
            JointType::Prismatic(pris) => pris.id,
            JointType::Fixed(_) => 0,
        }
    }

    pub fn motion(&self, q: f64) -> Transform3D {
        match self {
            JointType::Revolute(j) => j.motion(q),
            JointType::Prismatic(j) => j.motion(q),
            JointType::Fixed(j) => j.motion(q),
        }
    }

    pub fn origin(&self) -> &Transform3D {
        match self {
            JointType::Revolute(j) => &j.origin,
            JointType::Prismatic(j) => &j.origin,
            JointType::Fixed(j) => &j.origin,
        }
    }

    pub fn axis(&self) -> UnitVector3 {
        match self {
            JointType::Revolute(j) => j.axis,
            JointType::Prismatic(j) => j.direction,
            JointType::Fixed(_) => UnitVector3::y_axis(),
        }
    }

    pub fn kind(&self) -> JointKind {
        match self {
            JointType::Revolute(_) => JointKind::Revolute,
            JointType::Prismatic(_) => JointKind::Prismatic,
            JointType::Fixed(_) => JointKind::Fixed,
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

