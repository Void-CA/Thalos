use crate::spatial::frame::{Frame, FrameId, FrameRegistry};

use super::segment::Segment;

pub struct SerialChain {
    pub segments: Vec<Segment>,
    pub frames: FrameRegistry
}

impl SerialChain {
    pub fn frame(&self, id: &FrameId) -> Option<&Frame> {
        self.frames.get(id)
    }
}