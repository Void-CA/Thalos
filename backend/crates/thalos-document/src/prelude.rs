//! Crate prelude: re-exports key types for convenient wildcard imports.

pub use crate::diagnostic::{Diagnostic, Severity};
pub use crate::id::*;
pub use crate::operation::Operation;
pub use crate::operation::io::OutputValue;
pub use crate::operation::motion::MotionProfile;
pub use crate::pose::Pose;
pub use crate::project::{Metadata, Project, Robot, Scene, Settings, Task, TaskKind};
pub use crate::resource::*;
pub use crate::validation::StructuralError;
pub use crate::validation::validate_semantic;
pub use crate::validation::validate_structural;
