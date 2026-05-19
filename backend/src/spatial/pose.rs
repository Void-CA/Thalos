use crate::spatial::frame::frame::FrameId;
use crate::math::geometry::rigid::Transform3D;

pub struct Pose {
    reference: FrameId,
    target: FrameId,
    transform: Transform3D,
}

impl Pose {
    pub fn new(reference: FrameId, target: FrameId, transform: Transform3D) -> Self {
        Self { reference, target, transform }
    }

    pub fn reference_id(&self) -> FrameId {
        self.reference.clone()
    }

    pub fn target_id(&self) -> FrameId {
        self.target.clone()
    }

    pub fn transform(&self) -> &Transform3D {
        &self.transform
    }

    pub fn is_global(&self) -> bool {
        self.reference_id() == FrameId::World
    }

}