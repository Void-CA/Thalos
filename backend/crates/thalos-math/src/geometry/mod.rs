mod orientation;
mod quaternion;
mod unit_quaternion;
mod unit_vector;
mod vector;
mod dual_quaternion;

pub use orientation::orientation_error;
pub use quaternion::Quaternion;
pub use unit_quaternion::UnitQuaternion;
pub use unit_vector::UnitVector3;
pub use vector::Vector3;
pub use dual_quaternion::model::DualQuaternion;

pub mod rotations {
    pub use super::quaternion::Quaternion;
    pub use super::unit_quaternion::UnitQuaternion;
}
