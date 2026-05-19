use crate::spatial::frame::{FrameId, Frame};
use std::collections::HashMap;
pub struct FrameRegistry {
    frames: HashMap<FrameId, Frame>,
}

impl FrameRegistry {
    pub fn new() -> Self {
        Self { frames: HashMap::new() }
    }

    pub fn insert(&mut self, id: FrameId, frame: Frame) {
        self.frames.insert(id, frame);
    }

    pub fn get(&self, id: &FrameId) -> Option<&Frame> {
        self.frames.get(id)
    }
}