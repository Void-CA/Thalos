use crate::spatial::frame::FrameRegistry;

use super::segment::Segment;

pub struct SerialChain {
    pub segments: Vec<Segment>,
    pub frames: FrameRegistry
}

