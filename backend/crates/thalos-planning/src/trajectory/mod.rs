

pub mod point;

pub use point::TrajectoryPoint;

pub struct  Trajectory {
    waypoints: Vec<TrajectoryPoint>
}