//! SceneFile v1 — the persistent, versioned, file-level description of a robot
//! workspace, SEPARATE from `SceneContent` (the in-memory projection used by the
//! semantic pipeline). See `openspec/.../scene-file-artifact/spec.md`.
//!
//! **Design rule (D4)**: v1 geometry is VISUALIZATION-ONLY. `geometry` on
//! objects and fixtures is OPTIONAL and is DROPPED by `into_scene_content()` —
//! it never reaches the planning scene model. Fixture geometry MUST NOT trigger
//! planning behavior (collision semantics deferred).

use serde::{Deserialize, Serialize};

use crate::pose::Pose;

/// Supported SceneFile schema version.
pub const SCENE_FILE_SCHEMA_VERSION: &str = "1";

/// SceneFile v1 — a standalone JSON artifact describing a robot and the
/// physical objects, fixtures, and placement targets in its workspace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneFile {
    /// Schema version string, currently `"1"`.
    pub schema_version: String,
    /// Robot reference — `name` is the STABLE identity (D11); the runtime ID
    /// (`urdf:<sha256-6hex>`) is derived and MUST NOT be persisted in demos.
    pub robot: RobotRef,
    /// Physical objects that can be manipulated.
    pub objects: Vec<SceneObjectDef>,
    /// Presentational workspace fixtures (fences, tables, …).
    pub fixtures: Vec<SceneFixtureDef>,
    /// Logical placement targets (trays, bins, stations).
    pub locations: Vec<SceneLocationDef>,
    /// The robot's home pose (return target for Home operations).
    pub home_pose: Pose,
    /// Approach/retreat transit height in metres.
    pub approach_height: f64,
}

/// Robot reference — `name` is the stable, human/versioned identity (D11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RobotRef {
    pub name: String,
    pub urdf: String,
}

/// A physical object with a semantic category, optional label, optional
/// VISUALIZATION-ONLY geometry, and an optional placement-target reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneObjectDef {
    pub id: String,
    /// Semantic category (e.g. "bolt", "box").
    pub kind: String,
    /// Human-readable label (optional; falls back to `id` in the mapping).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional placement target — MUST reference an id in `locations[]`
    /// (validated at tier (b); spec "Missing location reference").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location_ref: Option<String>,
    /// VISUALIZATION-ONLY in v1 (D4 rule) — dropped by the mapping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry: Option<GeometryDef>,
    pub pose: Pose,
}

/// A presentational workspace fixture. Geometry is OPTIONAL and
/// VISUALIZATION-ONLY in v1; fixtures are dropped by the mapping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneFixtureDef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry: Option<GeometryDef>,
    pub pose: Pose,
}

/// A logical placement target in the workspace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneLocationDef {
    pub id: String,
    /// Kind of location — v1 supports `"placement_target"`.
    pub kind: String,
    pub pose: Pose,
}

/// Visualization-only geometry descriptor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeometryDef {
    /// `"box" | "cylinder" | "sphere"` (unsupported types rejected at tier (b)).
    pub r#type: String,
    /// Dimensions in metres (box: [w,h,d]; cylinder: [r,h]; sphere: [r]).
    pub size: Vec<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    /// A representative valid SceneFile v1 JSON document — some objects carry
    /// geometry, others do not; one object references a placement location.
    const SAMPLE_JSON: &str = r#"{
        "schema_version": "1",
        "robot": { "name": "icebot", "urdf": "docs/robot/icebot.urdf" },
        "objects": [
            { "id": "box-1", "kind": "box", "name": "Box 1", "location_ref": "tray-1",
              "geometry": { "type": "box", "size": [0.1, 0.1, 0.1] },
              "pose": { "position": [0.2, 0.1, 0.0], "orientation": [0.0, 0.0, 0.0, 1.0] } },
            { "id": "bolt-1", "kind": "bolt",
              "pose": { "position": [0.15, -0.1, 0.02], "orientation": [0.0, 0.0, 0.0, 1.0] } }
        ],
        "fixtures": [
            { "id": "fence-1",
              "geometry": { "type": "box", "size": [0.5, 0.02, 0.3] },
              "pose": { "position": [0.4, 0.0, 0.0], "orientation": [0.0, 0.0, 0.0, 1.0] } }
        ],
        "locations": [
            { "id": "tray-1", "kind": "placement_target",
              "pose": { "position": [0.3, -0.2, 0.0], "orientation": [0.0, 0.0, 0.0, 1.0] } }
        ],
        "home_pose": { "position": [0.0, 0.0, 0.5], "orientation": [0.0, 0.0, 0.0, 1.0] },
        "approach_height": 0.05
    }"#;

    // ── 1.1: serde round-trip ────────────────────────────────────────────

    #[test]
    fn scene_file_serde_round_trip_is_equal() {
        let first: SceneFile = serde_json::from_str(SAMPLE_JSON).expect("parse");
        let json = serde_json::to_string(&first).expect("serialize");
        let second: SceneFile = serde_json::from_str(&json).expect("re-parse");
        assert_eq!(first, second);
    }

    #[test]
    fn geometry_is_optional_and_defaults_to_none() {
        let file: SceneFile = serde_json::from_str(SAMPLE_JSON).expect("parse");
        let bolt = file
            .objects
            .iter()
            .find(|o| o.id == "bolt-1")
            .expect("bolt-1 present");
        assert!(bolt.geometry.is_none(), "object without geometry stays None");
        let boxed = file
            .objects
            .iter()
            .find(|o| o.id == "box-1")
            .expect("box-1 present");
        let geom = boxed.geometry.as_ref().expect("box-1 has geometry");
        assert_eq!(geom.r#type, "box");
        assert_eq!(geom.size, vec![0.1, 0.1, 0.1]);
    }

    #[test]
    fn round_trip_preserves_optional_geometry_absence() {
        let file: SceneFile = serde_json::from_str(SAMPLE_JSON).expect("parse");
        let json = serde_json::to_string(&file).expect("serialize");
        assert!(
            !json.contains("\"bolt-1\":\"geometry\""),
            "None geometry not serialized"
        );
        let back: SceneFile = serde_json::from_str(&json).expect("re-parse");
        assert_eq!(file, back);
    }
}
