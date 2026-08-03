//! Uniformity test — user contract (PR 5, spec C3).
//!
//! Semantic validation (`thalos_semantic`) and document validation
//! (`thalos_document`) MUST emit the SAME observation language: both return
//! `Vec<thalos_core::analysis::observation::Observation>` — the same type, the
//! same structure — and both outputs are validatable through
//! `AnalysisReport::validate()` after aggregation.
//!
//! ```text
//! Semantic validation → Observation
//! Document validation → Observation
//! ```

use thalos_core::analysis::aggregator::{Aggregator, DefaultAggregator};
use thalos_core::analysis::observation::{ArtifactRef, Observation, ObservationKind, Severity};
use thalos_core::analysis::scoring::DefaultScoringPolicy;
use thalos_core::ids::{ObjectId, OperationId, SemanticProgramId, TaskDocumentId};

use thalos_document::id::{LocationId, PointId};
use thalos_document::operation::Operation;
use thalos_document::operation::motion::MotionProfile;
use thalos_document::pose::Pose;
use thalos_document::project::*;
use thalos_document::resource::*;
use thalos_document::validation::validate_semantic;

use thalos_semantic::operation::{PlaceOp, SemanticOperation};
use thalos_semantic::program::SemanticProgram;
use thalos_semantic::validation::validate;

/// A semantic program with a single Place and no preceding Pick — the
/// PlaceWithoutPick phenomenon of the semantic validator.
fn program_with_place_without_pick() -> SemanticProgram {
    SemanticProgram::new(vec![SemanticOperation::Place(PlaceOp {
        origin: OperationId("place-1".to_string()),
        object: ObjectId("bolt-1".to_string()),
        destination: LocationId("tray-1".to_string()),
        tool: None,
    })])
}

/// A document whose single MoveTo targets a non-existent point — the
/// UnresolvableReference phenomenon of the document validator.
fn project_with_dangling_point() -> Project {
    Project {
        metadata: Metadata {
            name: "uniformity".to_string(),
            version: 1,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        },
        robot: Robot {
            reference: "ur5e".to_string(),
        },
        scene: Scene {
            reference: "ws".to_string(),
        },
        resources: Resources {
            points: vec![Point {
                id: PointId("pt_01".to_string()),
                name: "target".to_string(),
                pose: Pose {
                    position: [1.0, 0.0, 0.0],
                    orientation: [0.0, 0.0, 0.0, 1.0],
                },
            }],
            paths: vec![],
            frames: vec![],
            outputs: vec![],
            objects: vec![],
            locations: vec![],
            tools: vec![],
        },
        tasks: vec![Task::geometric(
            "main",
            vec![Operation::MoveTo {
                id: OperationId("op_1".to_string()),
                target: PointId("pt_99".to_string()),
                profile: None,
            }],
        )],
        settings: Settings {
            default_profile: MotionProfile::Default,
        },
    }
}

#[test]
fn semantic_and_document_validators_emit_the_same_observation_model() {
    // 1. Same type, same structure (spec C3): both validators return the SAME
    //    `Observation` type — merging the two vectors into one `Vec<Observation>`
    //    compiles and preserves both outputs. This is a compile-time proof of
    //    convergence; the runtime assertions prove both produced exactly one
    //    non-trivial observation.
    let semantic_observations: Vec<Observation> = validate(&program_with_place_without_pick());
    let document_observations: Vec<Observation> = validate_semantic(&project_with_dangling_point());

    let mut merged: Vec<Observation> = semantic_observations.clone();
    merged.extend(document_observations.clone());
    assert_eq!(
        merged.len(),
        2,
        "both validators must emit exactly one observation"
    );
    assert_eq!(merged[0].kind, ObservationKind::PlaceWithoutPick);
    assert_eq!(merged[1].kind, ObservationKind::UnresolvableReference);

    // 2. Report-contract validity: each validator's output aggregates through
    //    the canonical aggregator and passes `AnalysisReport::validate()` —
    //    the same report contract, no per-validator variants.
    let semantic_report = DefaultAggregator::new(DefaultScoringPolicy).aggregate(
        ArtifactRef::SemanticProgram(SemanticProgramId("semantic-program".to_string())),
        semantic_observations,
    );
    assert_eq!(semantic_report.validate(), Ok(()));
    assert_eq!(
        semantic_report.observations[0].kind,
        ObservationKind::PlaceWithoutPick
    );
    assert_eq!(semantic_report.observations[0].severity, Severity::Error);

    let document_report = DefaultAggregator::new(DefaultScoringPolicy).aggregate(
        ArtifactRef::TaskDocument(TaskDocumentId("task-document".to_string())),
        document_observations,
    );
    assert_eq!(document_report.validate(), Ok(()));
    assert_eq!(
        document_report.observations[0].kind,
        ObservationKind::UnresolvableReference
    );
    assert_eq!(document_report.observations[0].severity, Severity::Error);
}
