use crate::robot::{
    joint::joint::JointType, 
    link::Link
};

pub struct RobotArm {
    pub segments: Vec<Segment>,
}

pub struct Segment {
    pub joint: JointType,
    pub link: Link,
}