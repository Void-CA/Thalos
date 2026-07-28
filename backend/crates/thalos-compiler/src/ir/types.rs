use serde::{Deserialize, Serialize};

/// A fully resolved pose with concrete position, orientation, and frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedPose {
    /// Position in metres `[x, y, z]`.
    pub position: [f64; 3],
    /// Orientation as a unit quaternion `[w, x, y, z]`.
    pub orientation: [f64; 4],
    /// The resolved coordinate frame this pose is expressed in.
    pub frame: ResolvedFrame,
}

/// A fully resolved coordinate frame with name, parent, and transform.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedFrame {
    /// Frame name (e.g. `"tool0"`, `"base"`).
    pub name: String,
    /// Parent frame name for transform chain resolution.
    pub parent: String,
    /// 4×4 column-major homogeneous transformation matrix.
    pub transform: [f64; 16],
}

/// A fully resolved motion profile with concrete velocity and acceleration limits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedProfile {
    /// Profile name for diagnostics and display.
    pub name: String,
    /// Maximum velocity in m/s (linear) or rad/s (angular).
    pub velocity: f64,
    /// Maximum acceleration in m/s² (linear) or rad/s² (angular).
    pub acceleration: f64,
}

/// A fully resolved output channel descriptor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedOutput {
    /// Human-readable channel name.
    pub name: String,
    /// Channel type descriptor (e.g. `"digital"`, `"analog"`).
    pub channel_type: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- ResolvedPose ---

    #[test]
    fn resolved_pose_construction() {
        let frame = ResolvedFrame {
            name: "base".into(),
            parent: "world".into(),
            transform: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        let pose = ResolvedPose {
            position: [0.5, 0.0, 0.3],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: frame.clone(),
        };
        assert_eq!(pose.position, [0.5, 0.0, 0.3]);
        assert_eq!(pose.orientation, [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(pose.frame, frame);
    }

    #[test]
    fn resolved_pose_serde_round_trip() {
        let original = ResolvedPose {
            position: [1.0, -0.5, 2.0],
            orientation: [0.707, 0.0, 0.0, 0.707],
            frame: ResolvedFrame {
                name: "tool0".into(),
                parent: "base".into(),
                transform: [
                    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.5, 0.0, 0.0, 1.0,
                ],
            },
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: ResolvedPose = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // --- ResolvedFrame ---

    #[test]
    fn resolved_frame_construction() {
        let frame = ResolvedFrame {
            name: "tool0".into(),
            parent: "base".into(),
            transform: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        assert_eq!(frame.name, "tool0");
        assert_eq!(frame.parent, "base");
        assert_eq!(frame.transform[12], 0.0); // translation.x is column 3, row 0
    }

    #[test]
    fn resolved_frame_serde_round_trip() {
        let original = ResolvedFrame {
            name: "base_link".into(),
            parent: "world".into(),
            transform: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: ResolvedFrame = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // --- ResolvedProfile ---

    #[test]
    fn resolved_profile_construction() {
        let profile = ResolvedProfile {
            name: "fast".into(),
            velocity: 2.5,
            acceleration: 5.0,
        };
        assert_eq!(profile.name, "fast");
        assert_eq!(profile.velocity, 2.5);
        assert_eq!(profile.acceleration, 5.0);
    }

    #[test]
    fn resolved_profile_serde_round_trip() {
        let original = ResolvedProfile {
            name: "slow".into(),
            velocity: 0.5,
            acceleration: 1.0,
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: ResolvedProfile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }

    // --- ResolvedOutput ---

    #[test]
    fn resolved_output_construction() {
        let output = ResolvedOutput {
            name: "Gripper".into(),
            channel_type: "digital".into(),
        };
        assert_eq!(output.name, "Gripper");
        assert_eq!(output.channel_type, "digital");
    }

    #[test]
    fn resolved_output_serde_round_trip() {
        let original = ResolvedOutput {
            name: "Vacuum".into(),
            channel_type: "analog".into(),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let deserialized: ResolvedOutput = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }
}
