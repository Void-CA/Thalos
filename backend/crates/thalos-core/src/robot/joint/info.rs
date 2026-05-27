use crate::robot::joint::{JointKind, JointLimits};

pub struct JointInfo {
    pub name: String,
    pub kind: JointKind,
    pub limits: Option<JointLimits>,
}

