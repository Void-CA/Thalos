use serde::{
    de::{self, Visitor},
    Deserialize, Deserializer, Serialize, Serializer,
};
use std::fmt;

/// Motion profile selector — either the robot's default or a named profile.
///
/// Serializes as a plain JSON string:
/// - `MotionProfile::Default` → `"default"`
/// - `MotionProfile::Named("slow")` → `"slow"`
#[derive(Debug, Clone, PartialEq)]
pub enum MotionProfile {
    /// Use the robot's default speed / acceleration settings.
    Default,
    /// Use a named profile (e.g. "slow", "fast").
    Named(String),
}

impl Serialize for MotionProfile {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            MotionProfile::Default => serializer.serialize_str("default"),
            MotionProfile::Named(name) => serializer.serialize_str(name),
        }
    }
}

impl<'de> Deserialize<'de> for MotionProfile {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct MotionProfileVisitor;

        impl<'de> Visitor<'de> for MotionProfileVisitor {
            type Value = MotionProfile;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str(r#""default" or a profile name string"#)
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<MotionProfile, E> {
                match value {
                    "default" => Ok(MotionProfile::Default),
                    other => Ok(MotionProfile::Named(other.to_string())),
                }
            }
        }

        deserializer.deserialize_str(MotionProfileVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn motion_profile_default() {
        let p = MotionProfile::Default;
        assert!(matches!(p, MotionProfile::Default));
    }

    #[test]
    fn motion_profile_named() {
        let p = MotionProfile::Named("slow".to_string());
        assert!(matches!(p, MotionProfile::Named(name) if name == "slow"));
    }

    #[test]
    fn motion_profile_serde_default() {
        let json = serde_json::to_string(&MotionProfile::Default).expect("serialize");
        assert_eq!(json, r#""default""#);
        let deserialized: MotionProfile = serde_json::from_str(&json).expect("deserialize");
        assert!(matches!(deserialized, MotionProfile::Default));
    }

    #[test]
    fn motion_profile_serde_named() {
        let original = MotionProfile::Named("fast".to_string());
        let json = serde_json::to_string(&original).expect("serialize");
        assert_eq!(json, r#""fast""#);
        let deserialized: MotionProfile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, deserialized);
    }
}
