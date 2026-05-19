use crate::spatial::frame::{FrameId, Frame};
use std::collections::HashMap;
pub struct FrameRegistry {
    frames: HashMap<FrameId, Frame>,
}