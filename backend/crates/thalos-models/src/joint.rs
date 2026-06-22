use std::fmt;
use thalos_math::{Transform3D, UnitVector3};

/// The kinematic type of a joint.
///
/// Matches the URDF joint types:
///
/// | Variant     | DOF | Description                                |
/// |-------------|-----|--------------------------------------------|
/// | `Revolute`  | 1   | Rotational joint with position limits      |
/// | `Continuous`| 1   | Unlimited rotational joint (no limits)     |
/// | `Prismatic` | 1   | Translational joint along an axis          |
/// | `Fixed`     | 0   | Rigidly connects two links                 |
/// | `Floating`  | 6   | Full 6-DOF motion (no URDF standard axis)  |
/// | `Planar`    | 3   | Motion in a plane (no URDF standard axis)  |
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum JointKind {
    Revolute,
    Continuous,
    Prismatic,
    Fixed,
    Floating,
    Planar,
}

impl fmt::Display for JointKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JointKind::Revolute => write!(f, "revolute"),
            JointKind::Continuous => write!(f, "continuous"),
            JointKind::Prismatic => write!(f, "prismatic"),
            JointKind::Fixed => write!(f, "fixed"),
            JointKind::Floating => write!(f, "floating"),
            JointKind::Planar => write!(f, "planar"),
        }
    }
}

/// Motion limits for a joint.
///
/// Only `min` and `max` are required; `velocity` and `effort` are
/// optional limits that some planners and controllers respect.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct JointLimits {
    /// Lower bound (radians for revolute, metres for prismatic).
    pub min: f64,
    /// Upper bound (radians for revolute, metres for prismatic).
    pub max: f64,
    /// Maximum absolute velocity.
    pub velocity: Option<f64>,
    /// Maximum effort (torque / force).
    pub effort: Option<f64>,
}

impl JointLimits {
    pub fn new(min: f64, max: f64) -> Self {
        Self {
            min,
            max,
            velocity: None,
            effort: None,
        }
    }

    /// Clamp a value to `[min, max]`.
    pub fn clamp(&self, value: f64) -> f64 {
        value.clamp(self.min, self.max)
    }

    /// Wrap a value into `[min, max)` using modular arithmetic.
    ///
    /// Falls back to [`clamp`](Self::clamp) if the range is degenerate
    /// (`min >= max`).
    pub fn wrap(&self, value: f64) -> f64 {
        let range = self.max - self.min;
        if range <= 0.0 {
            return self.clamp(value);
        }
        let mut wrapped = (value - self.min) % range;
        if wrapped < 0.0 {
            wrapped += range;
        }
        wrapped + self.min
    }
}

/// A joint connecting two links.
///
/// Represents the kinematic relationship between a `parent` link and
/// a `child` link via an `origin` transform and an optional motion `axis`.
///
/// Corresponds to `<joint>` in URDF.
#[derive(Debug, Clone, PartialEq)]
pub struct Joint {
    pub name: String,
    pub kind: JointKind,

    /// Name of the parent link.
    pub parent: String,
    /// Name of the child link.
    pub child: String,

    /// Transform from the parent link frame to the child link frame
    /// at the joint's neutral/zero position.
    pub origin: Transform3D,

    /// Axis of motion in the joint frame.
    ///
    /// Required for `Revolute`, `Continuous`, and `Prismatic`.
    /// Ignored for `Fixed`, `Floating`, and `Planar`.
    pub axis: Option<UnitVector3>,

    /// Motion limits.
    ///
    /// Required for `Revolute` and `Prismatic`.
    /// Should be `None` for `Continuous`, `Fixed`, `Floating`, `Planar`.
    pub limits: Option<JointLimits>,
}

impl Joint {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        name: impl Into<String>,
        kind: JointKind,
        parent: impl Into<String>,
        child: impl Into<String>,
        origin: Transform3D,
    ) -> Self {
        Self {
            name: name.into(),
            kind,
            parent: parent.into(),
            child: child.into(),
            origin,
            axis: None,
            limits: None,
        }
    }
}
