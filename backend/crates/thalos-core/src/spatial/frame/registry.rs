use crate::spatial::frame::{FrameId, Frame};
use std::collections::HashMap;

#[derive(Clone)]
pub struct FrameRegistry {
    frames: HashMap<FrameId, Frame>,
    next_id: u64,
}

impl FrameRegistry {
    pub fn new() -> Self {
        Self { frames: HashMap::new(), next_id: 0 }
    }

    pub fn create(&mut self, name: &str) -> FrameId {
        let id = FrameId::new(self.next_id);
        self.next_id += 1;

        let frame = Frame::new(
            id.clone(), 
            name.to_string()
        );

        self.frames.insert(id.clone(), frame);

        id
    }

    pub fn get(&self, id: &FrameId) -> Option<&Frame> {
        self.frames.get(id)
    }

    pub fn contains(&self, id: &FrameId) -> bool {
        self.frames.contains_key(id)
    }

    pub fn register(&mut self, frame: Frame) -> FrameId {
        let id = frame.id().clone();
        self.frames.insert(id.clone(), frame);
        id
    }

}