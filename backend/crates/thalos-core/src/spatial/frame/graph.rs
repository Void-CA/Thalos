use crate::spatial::frame::Frame;
use crate::spatial::pose::Pose;

pub struct FrameGraph {
    frames: Vec<Frame>,
    relations: Vec<Pose>,
}
