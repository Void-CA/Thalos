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

// ---------------------------------------------------------------------------
// Semantic resource types — logical entities referenced by SemanticProgram
// ---------------------------------------------------------------------------

/// A physical object that can be manipulated (picked, placed, inspected).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Object {
    pub id: ObjectId,
    pub name: String,
    /// Optional semantic category (e.g. "screw", "housing", "tool").
    pub category: Option<String>,
}

/// A logical location in the workspace (assembly station, bin, tray, etc.).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Location {
    pub id: LocationId,
    pub name: String,
    /// Optional description of this location's purpose.
    pub description: Option<String>,
}

/// A tool or end-effector that can be attached to the robot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tool {
    pub id: ToolId,
    pub name: String,
    /// Optional tool type descriptor (e.g. "gripper", "vacuum", "welder").
    pub tool_type: Option<String>,
}

/// Named collections of all resource types in a task document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resources {
    pub points: Vec<Point>,
    pub paths: Vec<Path>,
    pub frames: Vec<Frame>,
    pub outputs: Vec<Output>,
    /// Semantic resources — logical entities for task-level programming.
    #[serde(default)]
    pub objects: Vec<Object>,
    #[serde(default)]
    pub locations: Vec<Location>,
    #[serde(default)]
    pub tools: Vec<Tool>,
}

impl Resources {
    /// Create an empty resource collection.
    pub fn empty() -> Self {
        Self {
            points: vec![],
            paths: vec![],
            frames: vec![],
            outputs: vec![],
            objects: vec![],
            locations: vec![],
            tools: vec![],
        }
    }
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
            objects: vec![],
            locations: vec![],
            tools: vec![],
        };
        assert_eq!(resources.points.len(), 1);
        assert_eq!(resources.paths.len(), 0);
    }

    // --- Semantic resource construction ---

    #[test]
    fn object_construction() {
        let obj = Object {
            id: ObjectId("bolt-01".to_string()),
            name: "M8 Bolt".to_string(),
            category: Some("fastener".to_string()),
        };
        assert_eq!(obj.id.as_str(), "bolt-01");
        assert_eq!(obj.name, "M8 Bolt");
    }

    #[test]
    fn location_construction() {
        let loc = Location {
            id: LocationId("tray-a".to_string()),
            name: "Tray A".to_string(),
            description: Some("Finished parts tray".to_string()),
        };
        assert_eq!(loc.name, "Tray A");
        assert!(loc.description.is_some());
    }

    #[test]
    fn tool_construction() {
        let tool = Tool {
            id: ToolId("gripper-1".to_string()),
            name: "Parallel Gripper".to_string(),
            tool_type: Some("gripper".to_string()),
        };
        assert_eq!(tool.id.as_str(), "gripper-1");
    }

    #[test]
    fn semantic_resources_serde_round_trip() {
        let obj = Object {
            id: ObjectId("bolt".to_string()),
            name: "Bolt".to_string(),
            category: None,
        };
        let json = serde_json::to_string(&obj).unwrap();
        let back: Object = serde_json::from_str(&json).unwrap();
        assert_eq!(obj, back);
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
            objects: vec![],
            locations: vec![],
            tools: vec![],
        };
        let json = serde_json::to_string(&resources).expect("serialize");
        let deserialized: Resources = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(resources, deserialized);
    }
}
