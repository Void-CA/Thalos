use thalos_core::models::{
    RobotMetadata,
    RobotModel,
    RobotSpec,
};

pub struct RobotService;

impl RobotService {
    pub fn list_models(&self) -> Vec<RobotMetadata> {
        RobotModel::all()
            .iter()
            .map(|m| m.metadata())
            .collect()
    }

    pub fn get_metadata(&self, id: &str) -> Option<RobotMetadata> {
        RobotModel::from_id(id)
            .ok()
            .map(|m| m.metadata())
    }

    pub fn get_default_spec(&self, id: &str) -> Option<RobotSpec> {
        RobotModel::from_id(id)
            .ok()
            .map(|m| m.default_spec())
    }
}