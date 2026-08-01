use std::fmt;

use thalos_core::motion::MotionProfile;

use crate::knowledge::KnowledgeProvider;
use crate::resource::ToolId;

/// The context for lowering a `SemanticProgram` into a `ExecutionProgram`.
///
/// Wraps the read-only dependencies: a `KnowledgeProvider` for resource
/// resolution, a default tool for operations that omit tool selection, and
/// a default `MotionProfile` for emitted motion instructions.
///
/// Context is immutable during lowering — all fields are public for
/// construction but never mutated once built.
pub struct LoweringContext<'a> {
    /// The knowledge provider for resolving semantic resource IDs into
    /// geometric frames and plans.
    pub provider: &'a dyn KnowledgeProvider,
    /// The default tool to use when an operation specifies `tool: None`.
    pub default_tool: Option<ToolId>,
    /// The default motion profile for emitted MoveJ/MoveL instructions.
    pub default_profile: MotionProfile,
}

impl Clone for LoweringContext<'_> {
    fn clone(&self) -> Self {
        LoweringContext {
            provider: self.provider,
            default_tool: self.default_tool.clone(),
            default_profile: self.default_profile.clone(),
        }
    }
}

impl fmt::Debug for LoweringContext<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LoweringContext")
            .field("default_tool", &self.default_tool)
            .field("default_profile", &self.default_profile)
            .field("provider", &"<KnowledgeProvider>")
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::motion::MotionPose;

    use crate::knowledge::MockKnowledgeProvider;

    fn sample_profile() -> MotionProfile {
        MotionProfile {
            max_velocity: 500.0,
            max_acceleration: 1000.0,
            max_jerk: None,
        }
    }

    fn sample_provider() -> MockKnowledgeProvider {
        MockKnowledgeProvider::new().with_home_pose(Ok(MotionPose {
            position: [0.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }))
    }

    // ── Construction ────────────────────────────────────────────────────

    #[test]
    fn lowering_context_wraps_provider_ref() {
        let provider = sample_provider();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: sample_profile(),
        };
        // Confirm we can call provider methods through the context
        let home = ctx.provider.home_pose();
        assert!(home.is_ok());
    }

    #[test]
    fn lowering_context_with_default_tool() {
        let provider = sample_provider();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: Some(ToolId("gripper-1".to_string())),
            default_profile: sample_profile(),
        };
        assert_eq!(ctx.default_tool, Some(ToolId("gripper-1".to_string())));
    }

    #[test]
    fn lowering_context_without_default_tool() {
        let provider = sample_provider();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: sample_profile(),
        };
        assert!(ctx.default_tool.is_none());
    }

    #[test]
    fn lowering_context_has_default_profile() {
        let provider = sample_provider();
        let profile = sample_profile();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: profile.clone(),
        };
        assert_eq!(ctx.default_profile, profile);
    }

    // ── Immutability ────────────────────────────────────────────────────

    #[test]
    fn lowering_context_cannot_mutate_provider() {
        let provider = sample_provider();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: sample_profile(),
        };
        // All methods take &self — confirmed by trait signature.
        // The provider reference is immutable (&dyn, not &mut dyn).
        let _provider_ref: &dyn KnowledgeProvider = ctx.provider;
    }

    #[test]
    fn lowering_context_is_read_only() {
        let provider = sample_provider();
        let ctx = LoweringContext {
            provider: &provider,
            default_tool: None,
            default_profile: sample_profile(),
        };
        // Prove we can read from the context multiple times
        let _ = ctx.provider;
        let _ = ctx.default_tool;
        let _ = ctx.default_profile;
    }
}
