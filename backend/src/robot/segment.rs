use crate::{
    robot::link::Link,
    robot::joint::JointType,
    spatial::frame::FrameId
};

pub struct Segment {
    pub parent: FrameId,
    pub child: FrameId,

    pub joint: JointType,
    pub link: Link,
}

impl Segment {
    pub fn new(parent: FrameId, child: FrameId, joint: JointType, link: Link) -> Self {
        Self { parent, child, joint, link }
    }
}
    