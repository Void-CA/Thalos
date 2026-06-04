pub mod factory;
pub mod metadata;

pub mod single_revolute;
pub mod planar_2r;
pub mod planar_3r;
pub mod scara;
pub mod manipulator_3dof;
pub mod manipulator_6dof;

mod error;

pub use factory::{RobotModel, RobotRegistry, RobotSpec};
pub use metadata::RobotMetadata;
pub use error::RobotModelError;

pub mod factories {
    pub use crate::models::planar_2r::factory::create_planar_2r;
    pub use crate::models::single_revolute::factory::create_single_revolute;
    pub use crate::models::planar_3r::factory::create_planar_3r;
    pub use crate::models::scara::factory::create_scara_robot;
    pub use crate::models::manipulator_3dof::factory::create_manipulator_3dof;
}