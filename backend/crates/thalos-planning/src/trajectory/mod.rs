pub mod point;

pub use point::TrajectoryPoint;

#[derive(Debug, Clone)]
pub struct Trajectory {
    waypoints: Vec<TrajectoryPoint>,
}

impl Trajectory {
    pub fn new(waypoints: Vec<TrajectoryPoint>) -> Self {
        Self { waypoints }
    }

    pub fn waypoints(&self) -> &[TrajectoryPoint] {
        &self.waypoints
    }

    pub fn push(&mut self, point: TrajectoryPoint) {
        self.waypoints.push(point);
    }

    pub fn extend(&mut self, points: impl IntoIterator<Item = TrajectoryPoint>) {
        self.waypoints.extend(points);
    }

    pub fn len(&self) -> usize {
        self.waypoints.len()
    }

    pub fn is_empty(&self) -> bool {
        self.waypoints.is_empty()
    }

    pub fn duration(&self) -> f64 {
        self.waypoints.last().map(|p| p.timestamp()).unwrap_or(0.0)
    }
}
