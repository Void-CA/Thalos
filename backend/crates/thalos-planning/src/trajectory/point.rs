#[derive(Debug, Clone)]
pub struct TrajectoryPoint {
    joints: Vec<f64>,
    timestamp: f64,
}

impl TrajectoryPoint {
    pub fn new(joints: Vec<f64>, timestamp: f64) -> Self {
        Self { joints, timestamp }
    }

    pub fn joints(&self) -> &[f64] {
        &self.joints
    }

    pub fn timestamp(&self) -> f64 {
        self.timestamp
    }

    pub fn into_joints(self) -> Vec<f64> {
        self.joints
    }
}
