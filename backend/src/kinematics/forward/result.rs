use std::collections::HashMap;

use crate::spatial::{
    frame::FrameId, 
    pose::Pose
};

pub struct FKResult {
    poses: HashMap<FrameId, Pose>,
}

impl FKResult {
    pub fn new(poses: HashMap<FrameId, Pose>) -> Self {
        Self { poses }
    }

    pub fn pose(&self, frame: &FrameId) -> Option<&Pose> {
        self.poses.get(frame)
    }

    pub fn frames(&self) -> impl Iterator<Item = &FrameId> {
        self.poses.keys()
    }
}