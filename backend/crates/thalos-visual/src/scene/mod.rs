pub mod precision;
pub mod diff;

use serde::{Deserialize, Serialize};

pub use precision::VisualPrecision;
pub use diff::{SceneDiff, ChangedFrame};

pub type VisualId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualScene {
    pub frames: Vec<VisualFrame>,
    pub links: Vec<VisualLink>,
    pub joint_axes: Vec<VisualJointAxis>,
    pub twists: Vec<VisualTwist>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualFrame {
    pub id: VisualId,
    pub parent: Option<VisualId>,
    pub translation: [f64; 3],
    pub rotation: [f64; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualLink {
    pub start: [f64; 3],
    pub end: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualJointAxis {
    pub origin: [f64; 3],
    pub axis: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisualTwist {
    pub origin: [f64; 3],
    pub linear: [f64; 3],
    pub angular: [f64; 3],
}
