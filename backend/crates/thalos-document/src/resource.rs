use crate::id::*;
use crate::pose::Pose;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Resource types — named, ID-keyed references for the task document
// ---------------------------------------------------------------------------

/// A named point in space with an associated pose.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub id: PointId,
    pub name: String,
    pub pose: Pose,
}

/// An ordered sequence of point references forming a continuous path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Path {
    pub id: PathId,
    pub name: String,
    pub points: Vec<PointId>,
}

/// A coordinate frame with an attached pose.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub id: FrameId,
    pub name: String,
    pub pose: Pose,
}

/// An output channel descriptor (digital or analog).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Output {
    pub id: OutputId,
    pub name: String,
    pub channel_type: String,
}

/// Named collections of all resource types in a task document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resources {
    pub points: Vec<Point>,
    pub paths: Vec<Path>,
    pub frames: Vec<Frame>,
    pub outputs: Vec<Output>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pose::Pose;

    // --- Point construction ---

    #[test]
    fn point_construction() {
        let pose = Pose {
            position: [1.0, 2.0, 3.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
        };
        let p = Point {
            id: PointId("pt_01".to_string()),
            name: "pick_pose".to_string(),
            pose,
        };
        assert_eq!(p.id.as_str(), "pt_01");
        assert_eq!(p.name, "pick_pose");
        assert_eq!(p.pose.position[1], 2.0);
    }

    #[test]
    fn point_rename_keeps_id() {
        let mut p = Point {
            id: PointId("pt_01".to_string()),
            name: "pick_pose".to_string(),
            pose: Pose {
                position: [0.0; 3],
                orientation: [0.0, 0.0, 0.0, 1.0],
            },
        };
        let old_id = p.id.clone();
        p.name = "grasp_pose".to_string();
        assert_eq!(p.id, old_id);
        assert_eq!(p.name, "grasp_pose");
    }

    // --- Path construction and order ---

    #[test]
    fn path_construction_and_order() {
        let path = Path {
            id: PathId("weld_path".to_string()),
            name: "weld_path".to_string(),
            points: vec![
                PointId("pt_01".to_string()),
                PointId("pt_02".to_string()),
                PointId("pt_05".to_string()),
            ],
        };
        assert_eq!(path.points.len(), 3);
        assert_eq!(path.points[0], PointId("pt_01".to_string()));
        assert_eq!(path.points[1], PointId("pt_02".to_string()));
        assert_eq!(path.points[2], PointId("pt_05".to_string()));
    }

    // --- Frame construction ---

    #[test]
    fn frame_construction() {
        let f = Frame {
            id: FrameId("base".to_string()),
            name: "base_link".to_string(),
            pose: Pose {
                position: [0.0; 3],
                orientation: [0.0, 0.0, 0.0, 1.0],
            },
        };
        assert_eq!(f.id.as_str(), "base");
    }

    // --- Output construction ---

    #[test]
    fn output_construction() {
        let o = Output {
            id: OutputId("gripper".to_string()),
            name: "Gripper".to_string(),
            channel_type: "digital".to_string(),
        };
        assert_eq!(o.channel_type, "digital");
    }

    // --- Resources collections ---

    #[test]
    fn resources_collection() {
        let resources = Resources {
            points: vec![Point {
                id: PointId("pt_01".to_string()),
                name: "A".to_string(),
                pose: Pose {
                    position: [0.0; 3],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                },
            }],
            paths: vec![],
            frames: vec![],
            outputs: vec![],
        };
        assert_eq!(resources.points.len(), 1);
        assert_eq!(resources.paths.len(), 0);
    }

    // --- Serde round-trip ---

    #[test]
    fn point_serde_round_trip() {
        let original = Point {
            id: PointId("pt_01".to_string()),
            name: "pick".to_string(),
            pose: Pose {
                position: [1.0, 0.0, 0.0],
                orientation: [0.0, 0.0, 0.0, 1.0],
            },
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: Point = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn resources_serde_round_trip() {
        let resources = Resources {
            points: vec![Point {
                id: PointId("pt_01".to_string()),
                name: "A".to_string(),
                pose: Pose {
                    position: [0.5, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                },
            }],
            paths: vec![Path {
                id: PathId("path_1".to_string()),
                name: "Path 1".to_string(),
                points: vec![PointId("pt_01".to_string())],
            }],
            frames: vec![],
            outputs: vec![],
        };
        let json = serde_json::to_string(&resources).expect("serialize");
        let deserialized: Resources = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(resources, deserialized);
    }
}
