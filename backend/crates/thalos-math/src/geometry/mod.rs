mod dual_quaternion;
mod orientation;
mod quaternion;
mod unit_quaternion;
mod unit_vector;
mod vector;

pub use dual_quaternion::model::DualQuaternion;
pub use orientation::orientation_error;
pub use quaternion::Quaternion;
pub use unit_quaternion::UnitQuaternion;
pub use unit_vector::UnitVector3;
pub use vector::Vector3;

pub mod rotations {
    pub use super::quaternion::Quaternion;
    pub use super::unit_quaternion::UnitQuaternion;
}
