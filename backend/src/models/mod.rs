pub mod planar_2r;
pub mod single_revolute;

pub mod factories {
    pub use crate::models::planar_2r::factory::create_planar_2r;
    pub use crate::models::single_revolute::factory::create_single_revolute;
}