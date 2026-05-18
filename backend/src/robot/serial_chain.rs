use crate::{robot::{
    joint::joint::JointType, 
    link::Link
}};

use crate::spatial::frame::{Frame, FrameId};

pub struct SerialChain {
    pub segments: Vec<Segment>,
}

pub struct Segment {
    pub frame: Frame,
    pub joint: JointType,
    pub link: Link,
}

impl Segment {
    pub fn new(frame: Frame, joint: JointType, link: Link) -> Self {
        Self { frame, joint, link }
    }

    pub fn frame_id(&self) -> &FrameId {
        self.frame.id()
    }
}