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
            joints: metadata.joints.iter().map(|j| (*j).into()).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct JointMetadataDto {
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

impl From<JointInfo> for JointMetadataDto {
    fn from(joint: JointInfo) -> Self {
        Self {
            name: joint.name.to_string(),
            kind: match joint.kind {
                thalos_core::robot::joint::JointKind::Revolute => "revolute",
                thalos_core::robot::joint::JointKind::Prismatic => "prismatic",
            }
            .to_string(),
            min: joint.limits.map(|l| l.min),
            max: joint.limits.map(|l| l.max),
        }
    }
}


pub struct RobotSpecDto {

}
