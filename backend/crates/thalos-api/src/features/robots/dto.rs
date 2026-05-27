use serde::Serialize;
use thalos_core::models::{
    RobotMetadata,
    RobotModel,
    RobotSpec,
};

#[derive(Debug, Serialize)]
pub struct RobotMetadataDto {
    pub id: String,
    pub display_name: String,
    pub dof: usize,
}

impl From<RobotMetadata> for RobotMetadataDto {
    fn from(metadata: RobotMetadata) -> Self {
        Self {
            id: metadata.id.to_string(),
            display_name: metadata.display_name.to_string(),
            dof: metadata.dof,
        }
    }
}


pub struct RobotSpecDto {

}