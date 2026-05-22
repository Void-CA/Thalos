use crate::math::geometry::rigid::Transform3D;

pub type LinkId = u32;

#[derive(Debug, Clone)]
pub struct Link {
    pub id: LinkId,
    pub transform: Transform3D
}

impl Link {
    pub fn new(id: LinkId, transform: Transform3D) -> Self {
        Self { id, transform }
    }

    pub fn id(&self) -> LinkId {
        self.id
    }
}