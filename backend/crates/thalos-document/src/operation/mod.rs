pub mod motion;
pub mod io;

use crate::id::*;
use motion::MotionProfile;
use io::OutputValue;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Primitive task operations — internally tagged for clean JSON.
///
/// Each variant carries a unique `OperationId`. Serialized as
/// `{"type": "<snake_case_name>", ...fields...}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Operation {
    /// Return robot to configured home position.
    Home {
        id: OperationId,
    },
    /// Move to a target point with an optional motion profile.
    MoveTo {
        id: OperationId,
        target: PointId,
        profile: Option<MotionProfile>,
    },
    /// Follow a path (ordered sequence of points).
    Follow {
        id: OperationId,
        path: PathId,
        profile: Option<MotionProfile>,
    },
    /// Pause execution for the given duration.
    Wait {
        id: OperationId,
        duration: Duration,
    },
    /// Set an output channel to a typed value.
    SetOutput {
        id: OperationId,
        channel: OutputId,
        value: OutputValue,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use motion::MotionProfile;
    use io::OutputValue;
    use serde_json;
    use std::time::Duration;

    // --- Home ---

    #[test]
    fn operation_home() {
        let op = Operation::Home {
            id: OperationId("op_1".to_string()),
        };
        assert!(matches!(op, Operation::Home { id } if id == OperationId("op_1".to_string())));
    }

    // --- MoveTo ---

    #[test]
    fn operation_move_to() {
        let op = Operation::MoveTo {
            id: OperationId("op_2".to_string()),
            target: PointId("pt_01".to_string()),
            profile: None,
        };
        assert!(matches!(op, Operation::MoveTo { target, .. } if target == PointId("pt_01".to_string())));
    }

    #[test]
    fn operation_move_to_with_profile() {
        let op = Operation::MoveTo {
            id: OperationId("op_3".to_string()),
            target: PointId("pt_01".to_string()),
            profile: Some(MotionProfile::Named("slow".to_string())),
        };
        assert!(matches!(op, Operation::MoveTo { profile: Some(MotionProfile::Named(name)), .. } if name == "slow"));
    }

    // --- Follow ---

    #[test]
    fn operation_follow() {
        let op = Operation::Follow {
            id: OperationId("op_4".to_string()),
            path: PathId("path_1".to_string()),
            profile: None,
        };
        assert!(matches!(op, Operation::Follow { path, .. } if path == PathId("path_1".to_string())));
    }

    // --- Wait ---

    #[test]
    fn operation_wait() {
        let op = Operation::Wait {
            id: OperationId("op_5".to_string()),
            duration: Duration::from_secs(5),
        };
        assert!(matches!(op, Operation::Wait { duration, .. } if duration == Duration::from_secs(5)));
    }

    // --- SetOutput ---

    #[test]
    fn operation_set_output() {
        let op = Operation::SetOutput {
            id: OperationId("op_6".to_string()),
            channel: OutputId("gripper".to_string()),
            value: OutputValue::Bool(true),
        };
        assert!(matches!(op, Operation::SetOutput { channel, value, .. }
            if channel == OutputId("gripper".to_string()) && value == OutputValue::Bool(true)));
    }

    // --- Serde internally-tagged ---

    #[test]
    fn operation_serde_type_tag_home() {
        let op = Operation::Home {
            id: OperationId("op_1".to_string()),
        };
        let json = serde_json::to_string(&op).expect("serialize");
        assert!(json.contains(r#""type":"home""#));
    }

    #[test]
    fn operation_serde_type_tag_move_to() {
        let op = Operation::MoveTo {
            id: OperationId("op_2".to_string()),
            target: PointId("pt_01".to_string()),
            profile: None,
        };
        let json = serde_json::to_string(&op).expect("serialize");
        assert!(json.contains(r#""type":"move_to""#));
        assert!(json.contains(r#""pt_01""#));
    }

    #[test]
    fn operation_serde_type_tag_follow() {
        let op = Operation::Follow {
            id: OperationId("op_3".to_string()),
            path: PathId("path_1".to_string()),
            profile: None,
        };
        let json = serde_json::to_string(&op).expect("serialize");
        assert!(json.contains(r#""type":"follow""#));
    }

    #[test]
    fn operation_serde_type_tag_wait() {
        let op = Operation::Wait {
            id: OperationId("op_4".to_string()),
            duration: Duration::from_secs(2),
        };
        let json = serde_json::to_string(&op).expect("serialize");
        assert!(json.contains(r#""type":"wait""#));
    }

    #[test]
    fn operation_serde_type_tag_set_output() {
        let op = Operation::SetOutput {
            id: OperationId("op_5".to_string()),
            channel: OutputId("gripper".to_string()),
            value: OutputValue::Float(0.75),
        };
        let json = serde_json::to_string(&op).expect("serialize");
        assert!(json.contains(r#""type":"set_output""#));
        assert!(json.contains(r#""gripper""#));
    }

    // --- Full serde round-trips ---

    #[test]
    fn operation_serde_round_trip_home() {
        let original = Operation::Home {
            id: OperationId("op_1".to_string()),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: Operation = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn operation_serde_round_trip_move_to() {
        let original = Operation::MoveTo {
            id: OperationId("op_2".to_string()),
            target: PointId("pt_01".to_string()),
            profile: Some(MotionProfile::Default),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: Operation = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn operation_serde_round_trip_wait() {
        let original = Operation::Wait {
            id: OperationId("op_3".to_string()),
            duration: Duration::new(1, 500_000_000),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: Operation = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn operation_serde_round_trip_follow() {
        let original = Operation::Follow {
            id: OperationId("op_4".to_string()),
            path: PathId("path_1".to_string()),
            profile: Some(MotionProfile::Named("fast".to_string())),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: Operation = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    #[test]
    fn operation_serde_round_trip_set_output() {
        let original = Operation::SetOutput {
            id: OperationId("op_5".to_string()),
            channel: OutputId("gripper".to_string()),
            value: OutputValue::Integer(255),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: Operation = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // --- Clone and Debug ---

    #[test]
    fn operation_is_clone_and_debug() {
        let a = Operation::Home {
            id: OperationId("op_1".to_string()),
        };
        let b = a.clone();
        assert_eq!(a, b);
        let _ = format!("{:?}", a);
    }
}
