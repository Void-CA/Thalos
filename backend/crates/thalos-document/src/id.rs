use serde::{Deserialize, Serialize};
use std::fmt;

// ---------------------------------------------------------------------------
// ID newtypes — String-backed, serde-compatible, type-safe identifiers
// ---------------------------------------------------------------------------

macro_rules! id_newtype {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub struct $name(pub String);

        impl $name {
            /// View the inner string as a `&str`.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

id_newtype!(PointId);
id_newtype!(PathId);
id_newtype!(FrameId);
id_newtype!(OutputId);

// ---------------------------------------------------------------------------
// Semantic resource identifiers
// ---------------------------------------------------------------------------

id_newtype!(ObjectId);
id_newtype!(LocationId);
id_newtype!(ToolId);

/// Re-export the unified `OperationId` from `thalos_core`.
///
/// Single source of truth — all crates use the same `OperationId(String)` type,
/// eliminating conversion at crate boundaries.
pub use thalos_core::ids::OperationId;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    // --- Construction and equality ---

    #[test]
    fn point_id_construction_and_equality() {
        let a = PointId("pt_01".to_string());
        let b = PointId("pt_01".to_string());
        let c = PointId("pt_02".to_string());
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn path_id_construction_and_equality() {
        let a = PathId("path_01".to_string());
        let b = PathId("path_01".to_string());
        assert_eq!(a, b);
    }

    #[test]
    fn frame_id_construction_and_equality() {
        let a = FrameId("base".to_string());
        let b = FrameId("tool".to_string());
        assert_ne!(a, b);
    }

    #[test]
    fn output_id_construction_and_equality() {
        let a = OutputId("gripper".to_string());
        let b = OutputId("gripper".to_string());
        assert_eq!(a, b);
    }

    #[test]
    fn operation_id_construction_and_equality() {
        let a = OperationId("op_1".to_string());
        let b = OperationId("op_1".to_string());
        let c = OperationId("op_2".to_string());
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    // --- Serde round-trip ---

    #[test]
    fn point_id_serde_round_trip() {
        let original = PointId("pt_01".to_string());
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: PointId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn path_id_serde_round_trip() {
        let original = PathId("weld_path".to_string());
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: PathId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // --- String access ---

    #[test]
    fn point_id_string_access() {
        let id = PointId("pt_01".to_string());
        assert_eq!(id.as_str(), "pt_01");
        assert_eq!(id.to_string(), "pt_01");
    }

    // --- Semantic resource IDs ---

    #[test]
    fn object_id_construction_and_equality() {
        let a = ObjectId("obj_01".to_string());
        let b = ObjectId("obj_01".to_string());
        let c = ObjectId("obj_02".to_string());
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn location_id_construction_and_equality() {
        let a = LocationId("station_a".to_string());
        let b = LocationId("station_a".to_string());
        assert_eq!(a, b);
    }

    #[test]
    fn tool_id_construction_and_equality() {
        let a = ToolId("gripper".to_string());
        let b = ToolId("gripper".to_string());
        assert_eq!(a, b);
    }

    #[test]
    fn semantic_ids_serde_round_trip() {
        // Test ObjectId
        let o = ObjectId("bolt".to_string());
        let json = serde_json::to_string(&o).unwrap();
        let back: ObjectId = serde_json::from_str(&json).unwrap();
        assert_eq!(o, back);
        // Test LocationId
        let l = LocationId("tray".to_string());
        let json = serde_json::to_string(&l).unwrap();
        let back: LocationId = serde_json::from_str(&json).unwrap();
        assert_eq!(l, back);
        // Test ToolId
        let t = ToolId("vacuum".to_string());
        let json = serde_json::to_string(&t).unwrap();
        let back: ToolId = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }

    // --- Clone and Debug ---

    #[test]
    fn point_id_is_clone_and_debug() {
        let a = PointId("pt_01".to_string());
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{:?}", a);
    }
}
