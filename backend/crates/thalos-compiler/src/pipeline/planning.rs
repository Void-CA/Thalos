//! Planning stage — maps IR operations to planned operations and selects
//! execution strategies based on analysis results.
//!
//! Strategy selection — the decision of how to execute each operation — belongs
//! here, not in analysis.

use std::time::Duration;

use thalos_core::ids::OperationId;
use thalos_core::motion::{MotionPose, MotionProfile, OutputChannel, OutputValue};

use super::CompilationOptions;
use super::analysis::{AnalysisResult, ConstraintSet};
use crate::ir::{IrOperation, IrProgram};
use thalos_document::diagnostic::Diagnostic;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Marker type for the planning stage.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanningStage;

/// The final output of the compilation pipeline — a sequence of planned
/// operations ready for backend-specific lowering.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedProgram {
    /// Ordered planned operations, one per post-policy IR operation.
    pub operations: Vec<PlannedOperation>,
    /// Home pose for the robot — required by SCARA when lowering `Home` ops.
    /// Set after planning by the pipeline or by the lowering layer.
    pub home_pose: Option<MotionPose>,
    /// Bound constraints from the analysis stage.
    pub constraints: ConstraintSet,
    /// Pipeline execution metadata.
    pub metadata: PlanMetadata,
}

/// A single planned operation — the result of mapping one `IrOperation`
/// through strategy selection.
///
/// Each variant carries the `origin: OperationId` for traceability back to the
/// source IR operation. Motion operations include a `MotionStrategy` (Joint or
/// Linear) assigned by the planner — lowering reads the strategy but never
/// decides it.
#[derive(Debug, Clone, PartialEq)]
pub enum PlannedOperation {
    /// Return the robot to its configured home position.
    Home {
        /// The originating IR operation's ID.
        origin: OperationId,
    },
    /// Move to a target pose with a specific motion strategy.
    MoveTo {
        /// The originating IR operation's ID.
        origin: OperationId,
        /// Whether to execute as joint-space (MoveJ) or linear (MoveL).
        strategy: MotionStrategy,
        /// The target pose.
        pose: MotionPose,
        /// Motion profile (velocity/acceleration limits).
        profile: MotionProfile,
    },
    /// Follow an ordered sequence of waypoints.
    Follow {
        /// The originating IR operation's ID.
        origin: OperationId,
        /// The motion strategy (always Linear for Follow in SCARA v1).
        strategy: MotionStrategy,
        /// Ordered waypoints (resolved poses with full frame metadata).
        waypoints: Vec<crate::ir::types::ResolvedPose>,
        /// Motion profile applied to all waypoints.
        profile: MotionProfile,
    },
    /// Pause execution for a fixed duration.
    Wait {
        /// The originating IR operation's ID.
        origin: OperationId,
        /// How long to pause.
        duration: Duration,
    },
    /// Set an output channel (digital/analog) to a typed value.
    SetOutput {
        /// The originating IR operation's ID.
        origin: OperationId,
        /// The output channel descriptor.
        channel: OutputChannel,
        /// The value to set.
        value: OutputValue,
    },
}

/// Motion execution strategy — assigned by the planner, consumed by lowering.
///
/// Joint moves each axis independently; Linear moves the TCP along a
/// straight-line Cartesian path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MotionStrategy {
    /// Joint-space movement (MoveJ).
    Joint,
    /// Linear (Cartesian) movement (MoveL).
    Linear,
}

/// Pipeline version identifier.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    /// Major version — bumped for breaking pipeline changes.
    pub major: u16,
    /// Minor version — bumped for backwards-compatible additions.
    pub minor: u16,
}

/// Execution metadata recorded by `run_pipeline`.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanMetadata {
    /// Version of the pipeline that produced this program.
    pub pipeline_version: Version,
    /// Wall-clock time for the full pipeline execution.
    pub execution_time: Duration,
    /// Options passed to the pipeline.
    pub compilation_options: CompilationOptions,
    /// Complete diagnostics from all stages.
    pub diagnostics: Vec<Diagnostic>,
    /// Per-stage completion status.
    pub stage_status: Vec<StageResult>,
}

/// Identifies which pipeline stage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PipelineStage {
    /// Policy decision stage.
    Policy,
    /// Constraint analysis stage.
    Analysis,
    /// Operation planning stage.
    Planning,
}

/// Completion status for a single pipeline stage.
#[derive(Debug, Clone, PartialEq)]
pub enum StageStatus {
    /// Stage completed normally.
    Success,
    /// Stage was skipped (e.g. due to a prior abort).
    Skipped,
    /// Stage failed with a human-readable reason.
    Failed(String),
}

/// Duration and status for a single pipeline stage.
#[derive(Debug, Clone, PartialEq)]
pub struct StageResult {
    /// Which stage this result describes.
    pub stage: PipelineStage,
    /// How the stage completed.
    pub status: StageStatus,
    /// Wall-clock duration for this stage.
    pub duration: Duration,
}

impl StageResult {
    /// Create a new stage result.
    pub fn new(stage: PipelineStage, status: StageStatus, duration: Duration) -> Self {
        Self {
            stage,
            status,
            duration,
        }
    }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/// Run the planning stage — map each IR operation to a `PlannedOperation`.
///
/// Returns exactly `N` operations for `N` input IR operations, preserving
/// order. Strategy selection logic will be expanded in future iterations.
pub fn execute(
    ir: &IrProgram,
    _analysis: &AnalysisResult,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<PlannedOperation> {
    PlanningStage::execute(ir, _analysis, diagnostics)
}

impl PlanningStage {
    /// Execute the planning stage — map each IR operation to a planned
    /// operation.
    ///
    /// Each `IrOperation` maps to exactly one `PlannedOperation`. The
    /// `_analysis` result is reserved for future strategy selection.
    pub fn execute(
        ir: &IrProgram,
        _analysis: &AnalysisResult,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Vec<PlannedOperation> {
        for op in &ir.operations {
            let planned = op_to_planned(op);
            diagnostics.push(Diagnostic::warning(
                "planning",
                format!("planned operation {}", origin_str(&planned)),
                "pipeline",
            ));
        }

        ir.operations.iter().map(op_to_planned).collect()
    }
}

/// Map a single `IrOperation` to a `PlannedOperation`.
///
/// Strategy selection currently defaults to `MotionStrategy::Joint` for all
/// motion operations. In a future iteration the planner will select the strategy
/// based on analysis results (e.g. singularity proximity, collision risk).
fn op_to_planned(op: &IrOperation) -> PlannedOperation {
    match op {
        IrOperation::Home { origin } => PlannedOperation::Home {
            origin: origin.clone(),
        },
        IrOperation::MoveTo {
            origin,
            pose,
            profile,
        } => PlannedOperation::MoveTo {
            origin: origin.clone(),
            strategy: MotionStrategy::Joint,
            pose: resolved_pose_to_motion_pose(pose),
            profile: resolved_profile_to_motion_profile(profile),
        },
        IrOperation::Follow {
            origin,
            waypoints,
            profile,
        } => PlannedOperation::Follow {
            origin: origin.clone(),
            strategy: MotionStrategy::Joint,
            waypoints: waypoints.clone(),
            profile: resolved_profile_to_motion_profile(profile),
        },
        IrOperation::Wait { origin, duration } => PlannedOperation::Wait {
            origin: origin.clone(),
            duration: *duration,
        },
        IrOperation::SetOutput {
            origin,
            channel,
            value,
        } => PlannedOperation::SetOutput {
            origin: origin.clone(),
            channel: OutputChannel {
                name: channel.name.clone(),
                channel_type: channel.channel_type.clone(),
            },
            value: doc_output_value_to_core(value),
        },
    }
}

// ---------------------------------------------------------------------------
// Accessor helpers
// ---------------------------------------------------------------------------

/// Extract the origin from any `PlannedOperation` variant.
pub fn origin_str(op: &PlannedOperation) -> &str {
    match op {
        PlannedOperation::Home { origin }
        | PlannedOperation::MoveTo { origin, .. }
        | PlannedOperation::Follow { origin, .. }
        | PlannedOperation::Wait { origin, .. }
        | PlannedOperation::SetOutput { origin, .. } => origin.as_str(),
    }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/// Convert an IR `ResolvedPose` to a core `MotionPose`.
fn resolved_pose_to_motion_pose(pose: &crate::ir::types::ResolvedPose) -> MotionPose {
    MotionPose {
        position: pose.position,
        orientation: pose.orientation,
        frame: pose.frame.name.clone(),
    }
}

/// Convert an IR `ResolvedProfile` to a core `MotionProfile`.
fn resolved_profile_to_motion_profile(
    profile: &crate::ir::types::ResolvedProfile,
) -> MotionProfile {
    MotionProfile {
        max_velocity: profile.velocity,
        max_acceleration: profile.acceleration,
        max_jerk: None,
    }
}

/// Convert a document-level `OutputValue` to a core `OutputValue`.
///
/// Both types share the same variants (`Bool`, `Integer`, `Float`), so the
/// mapping is direct.
fn doc_output_value_to_core(value: &thalos_document::operation::io::OutputValue) -> OutputValue {
    match value {
        thalos_document::operation::io::OutputValue::Bool(v) => OutputValue::Bool(*v),
        thalos_document::operation::io::OutputValue::Integer(v) => OutputValue::Integer(*v),
        thalos_document::operation::io::OutputValue::Float(v) => OutputValue::Float(*v),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{IrOperation, IrProgram};
    use std::time::Duration;
    use thalos_document::diagnostic::Diagnostic;
    use thalos_document::id::OperationId;
    use thalos_document::project::Metadata as ProjectMetadata;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn make_ir(operations: Vec<IrOperation>) -> IrProgram {
        IrProgram {
            version: 1,
            operations,
            source_metadata: ProjectMetadata {
                name: "test".into(),
                version: 1,
                created_at: "".into(),
                modified_at: "".into(),
            },
        }
    }

    fn make_analysis_result(items: Vec<&str>) -> AnalysisResult {
        AnalysisResult {
            constraints: ConstraintSet {
                items: items.iter().map(|s| s.to_string()).collect(),
            },
        }
    }

    fn sample_pose() -> crate::ir::ResolvedPose {
        crate::ir::ResolvedPose {
            position: [0.0; 3],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: crate::ir::ResolvedFrame {
                name: "base".into(),
                parent: "world".into(),
                transform: [
                    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
                ],
            },
        }
    }

    fn sample_profile() -> crate::ir::ResolvedProfile {
        crate::ir::ResolvedProfile {
            name: "default".into(),
            velocity: 1.0,
            acceleration: 2.0,
        }
    }

    fn default_options() -> CompilationOptions {
        CompilationOptions {
            policy_mode: super::super::PolicyMode::Strict,
        }
    }

    /// Helper: extract origin from any `PlannedOperation` variant.
    fn op_origin(op: &PlannedOperation) -> &OperationId {
        match op {
            PlannedOperation::Home { origin }
            | PlannedOperation::MoveTo { origin, .. }
            | PlannedOperation::Follow { origin, .. }
            | PlannedOperation::Wait { origin, .. }
            | PlannedOperation::SetOutput { origin, .. } => origin,
        }
    }

    /// Helper: return a human-readable label for a `PlannedOperation` variant.
    fn op_kind(op: &PlannedOperation) -> &'static str {
        match op {
            PlannedOperation::Home { .. } => "home",
            PlannedOperation::MoveTo { .. } => "move_to",
            PlannedOperation::Follow { .. } => "follow",
            PlannedOperation::Wait { .. } => "wait",
            PlannedOperation::SetOutput { .. } => "set_output",
        }
    }

    // ------------------------------------------------------------------
    // Structural: type construction, field assertions
    // ------------------------------------------------------------------

    #[test]
    fn version_construction() {
        let v = Version { major: 0, minor: 1 };
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 1);
    }

    #[test]
    fn planned_operation_enum_variants_construct() {
        // Prove all 5 variants are constructible.
        let home = PlannedOperation::Home {
            origin: OperationId("op_01".into()),
        };
        let move_to = PlannedOperation::MoveTo {
            origin: OperationId("op_02".into()),
            strategy: MotionStrategy::Joint,
            pose: MotionPose {
                position: [0.0; 3],
                orientation: [0.0, 0.0, 0.0, 1.0],
                frame: "world".into(),
            },
            profile: MotionProfile {
                max_velocity: 1.0,
                max_acceleration: 2.0,
                max_jerk: None,
            },
        };
        let follow = PlannedOperation::Follow {
            origin: OperationId("op_03".into()),
            strategy: MotionStrategy::Joint,
            waypoints: vec![],
            profile: MotionProfile {
                max_velocity: 1.0,
                max_acceleration: 2.0,
                max_jerk: None,
            },
        };
        let wait = PlannedOperation::Wait {
            origin: OperationId("op_04".into()),
            duration: Duration::from_secs(1),
        };
        let set_output = PlannedOperation::SetOutput {
            origin: OperationId("op_05".into()),
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };

        assert_eq!(op_kind(&home), "home");
        assert_eq!(op_kind(&move_to), "move_to");
        assert_eq!(op_kind(&follow), "follow");
        assert_eq!(op_kind(&wait), "wait");
        assert_eq!(op_kind(&set_output), "set_output");
        assert_eq!(op_origin(&home).as_str(), "op_01");
        assert_eq!(op_origin(&move_to).as_str(), "op_02");
        assert_eq!(op_origin(&follow).as_str(), "op_03");
        assert_eq!(op_origin(&wait).as_str(), "op_04");
        assert_eq!(op_origin(&set_output).as_str(), "op_05");
    }

    #[test]
    fn planned_program_construction_with_home_pose() {
        let ops = vec![PlannedOperation::Home {
            origin: OperationId("op_01".into()),
        }];
        let home_pose = Some(MotionPose {
            position: [0.0, 0.0, 0.0],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        });
        let constraints = ConstraintSet { items: vec![] };
        let metadata = PlanMetadata {
            pipeline_version: Version { major: 0, minor: 1 },
            execution_time: Duration::ZERO,
            compilation_options: default_options(),
            diagnostics: vec![],
            stage_status: vec![],
        };
        let program = PlannedProgram {
            operations: ops,
            home_pose: home_pose.clone(),
            constraints,
            metadata,
        };
        assert_eq!(program.operations.len(), 1);
        assert_eq!(program.home_pose, home_pose);
        assert_eq!(op_kind(&program.operations[0]), "home");
    }

    #[test]
    fn stage_result_construction() {
        let sr = StageResult::new(
            PipelineStage::Policy,
            StageStatus::Success,
            Duration::from_millis(5),
        );
        assert_eq!(sr.stage, PipelineStage::Policy);
        assert_eq!(sr.status, StageStatus::Success);
        let _ = sr.duration;
    }

    #[test]
    fn stage_result_failed_contains_reason() {
        let sr = StageResult::new(
            PipelineStage::Analysis,
            StageStatus::Failed("singularity detected".into()),
            Duration::ZERO,
        );
        match sr.status {
            StageStatus::Failed(ref reason) => {
                assert!(reason.contains("singularity"));
            }
            _ => panic!("Expected Failed variant"),
        }
    }

    #[test]
    fn stage_status_variants_are_distinct() {
        let success = StageStatus::Success;
        let skipped = StageStatus::Skipped;
        let failed = StageStatus::Failed("err".into());
        assert_ne!(format!("{success:?}"), format!("{skipped:?}"));
        assert_ne!(format!("{success:?}"), format!("{failed:?}"));
    }

    #[test]
    fn pipeline_stage_variants_are_distinct() {
        assert_ne!(
            format!("{:?}", PipelineStage::Policy),
            format!("{:?}", PipelineStage::Analysis)
        );
        assert_ne!(
            format!("{:?}", PipelineStage::Policy),
            format!("{:?}", PipelineStage::Planning)
        );
    }

    // ------------------------------------------------------------------
    // Behavioral: one-to-one ops mapping, metadata construction
    // ------------------------------------------------------------------

    #[test]
    fn planning_one_to_one_mapping() {
        let ir = make_ir(vec![
            IrOperation::Home {
                origin: OperationId("op_01".into()),
            },
            IrOperation::Wait {
                origin: OperationId("op_02".into()),
                duration: Duration::from_secs(1),
            },
        ]);
        let analysis = make_analysis_result(vec!["op_01:home", "op_02:wait"]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);

        assert_eq!(
            ops.len(),
            2,
            "must produce exactly N operations for N IR operations"
        );
    }

    #[test]
    fn planning_preserves_operation_order() {
        let ir = make_ir(vec![
            IrOperation::Home {
                origin: OperationId("op_01".into()),
            },
            IrOperation::MoveTo {
                origin: OperationId("op_02".into()),
                pose: sample_pose(),
                profile: sample_profile(),
            },
            IrOperation::Wait {
                origin: OperationId("op_03".into()),
                duration: Duration::from_millis(500),
            },
        ]);
        let analysis = make_analysis_result(vec![]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);

        assert_eq!(ops.len(), 3);
        assert_eq!(op_origin(&ops[0]).as_str(), "op_01");
        assert_eq!(op_origin(&ops[1]).as_str(), "op_02");
        assert_eq!(op_origin(&ops[2]).as_str(), "op_03");
        assert_eq!(op_kind(&ops[0]), "home");
        assert_eq!(op_kind(&ops[1]), "move_to");
        assert_eq!(op_kind(&ops[2]), "wait");
    }

    #[test]
    fn planning_empty_ir_produces_empty_ops() {
        let ir = make_ir(vec![]);
        let analysis = make_analysis_result(vec![]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);
        assert!(
            ops.is_empty(),
            "empty IR should produce zero planned operations"
        );
    }

    #[test]
    fn planning_maps_all_ir_variants() {
        let ir = make_ir(vec![
            IrOperation::Home {
                origin: OperationId("op_01".into()),
            },
            IrOperation::MoveTo {
                origin: OperationId("op_02".into()),
                pose: sample_pose(),
                profile: sample_profile(),
            },
            IrOperation::Follow {
                origin: OperationId("op_03".into()),
                waypoints: vec![sample_pose()],
                profile: sample_profile(),
            },
            IrOperation::Wait {
                origin: OperationId("op_04".into()),
                duration: Duration::from_secs(2),
            },
            IrOperation::SetOutput {
                origin: OperationId("op_05".into()),
                channel: crate::ir::ResolvedOutput {
                    name: "Gripper".into(),
                    channel_type: "digital".into(),
                },
                value: thalos_document::operation::io::OutputValue::Bool(true),
            },
        ]);
        let analysis = make_analysis_result(vec![]);
        let mut diags = vec![];
        let ops = execute(&ir, &analysis, &mut diags);

        assert_eq!(ops.len(), 5);
        assert_eq!(op_kind(&ops[0]), "home");
        assert_eq!(op_kind(&ops[1]), "move_to");
        assert_eq!(op_kind(&ops[2]), "follow");
        assert_eq!(op_kind(&ops[3]), "wait");
        assert_eq!(op_kind(&ops[4]), "set_output");
    }

    #[test]
    fn metadata_construction() {
        let meta = PlanMetadata {
            pipeline_version: Version { major: 0, minor: 1 },
            execution_time: Duration::from_millis(42),
            compilation_options: default_options(),
            diagnostics: vec![Diagnostic::warning("W001", "test warning", "pipeline")],
            stage_status: vec![StageResult::new(
                PipelineStage::Policy,
                StageStatus::Success,
                Duration::from_millis(5),
            )],
        };
        assert_eq!(meta.pipeline_version.major, 0);
        assert_eq!(meta.execution_time.as_millis(), 42);
        assert_eq!(meta.diagnostics.len(), 1);
        assert_eq!(meta.stage_status.len(), 1);
    }

    // ------------------------------------------------------------------
    // Clone + Debug hygiene
    // ------------------------------------------------------------------

    #[test]
    fn plan_metadata_is_clone_and_debug() {
        let a = PlanMetadata {
            pipeline_version: Version { major: 0, minor: 1 },
            execution_time: Duration::ZERO,
            compilation_options: default_options(),
            diagnostics: vec![],
            stage_status: vec![],
        };
        let _b = a.clone();
        let _ = format!("{a:?}");
    }

    #[test]
    fn planning_stage_is_clone_and_debug() {
        let s = PlanningStage;
        let _b = s.clone();
        let _ = format!("{s:?}");
    }
}
