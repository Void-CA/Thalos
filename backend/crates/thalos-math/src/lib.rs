pub mod algebra;
pub mod constants;
pub mod error;
mod geometry;
pub mod traits;
mod transform;

pub use algebra::{DynamicMatrix, DynamicVector};
pub use error::MathError;
pub use geometry::{Quaternion, UnitQuaternion, UnitVector3, Vector3, orientation_error};
pub use traits::{Cross, Dot};
pub use transform::Transform3D;
