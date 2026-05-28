use serde::Serialize;
use thalos_core::models::RobotMetadata;
use thalos_core::robot::joint::JointInfo;

#[derive(Debug, Serialize)]
pub struct RobotMetadataDto {
    pub id: String,
    pub display_name: String,
    pub dof: usize,
    pub joints: Vec<JointMetadataDto>,
}

impl From<RobotMetadata> for RobotMetadataDto {
    fn from(metadata: RobotMetadata) -> Self {
        Self {
            id: metadata.id.to_string(),
            display_name: metadata.display_name.to_string(),
            dof: metadata.dof,
            joints: metadata.joints.iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct JointMetadataDto {
    pub name: String,
    pub kind: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl From<&JointInfo> for JointMetadataDto {
    fn from(joint: &JointInfo) -> Self {
        Self {
            name: joint.name.to_string(),
            kind: joint.kind.to_string(),
            min: joint.limits.map(|l| l.min),
            max: joint.limits.map(|l| l.max),
        }
    }
}
