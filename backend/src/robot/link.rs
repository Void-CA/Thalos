use crate::math::geometry::spatial::Transform3D;

pub type LinkId = u32;
pub struct Link {
    pub id: LinkId,
    pub transform: Transform3D
}

impl Link {
    pub fn new(id: LinkId, transform: Transform3D) -> Self {
        Self { id, transform }
    }
}