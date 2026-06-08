#[derive(Debug, Clone, Copy, PartialEq)]
pub enum JointKind {
    Revolute,
    Prismatic,
    Fixed,
}

impl std::fmt::Display for JointKind {
    fn fmt(
        &self,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        match self {
            JointKind::Revolute => write!(f, "revolute"),
            JointKind::Prismatic => write!(f, "prismatic"),
            JointKind::Fixed => write!(f, "fixed"),
        }
    }
}