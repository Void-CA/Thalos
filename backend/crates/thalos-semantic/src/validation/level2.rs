use crate::knowledge::{KnowledgeProvider, LoweringError};
use crate::operation::SemanticOperation;
use crate::program::SemanticProgram;
use super::{Diagnostic, ValidationResult};

/// Run Level 2 validation on a `SemanticProgram`.
///
/// Level 2 checks resource resolvability through the `KnowledgeProvider`:
///
/// - **Pick**: The object must be resolvable via `grasp_plan`.
/// - **Place**: The object and destination must be resolvable via `place_plan`.
/// - **MoveTo**: The destination location must be resolvable via `location_pose`.
/// - **Home**: The home pose must be resolvable via `home_pose`.
/// - **Wait**: No provider calls needed.
///
/// If the provider returns `Err`, a `Diagnostic` is emitted with the operation's
/// `origin` for traceability. Level 2 presumes Level 1 has already passed — no
/// sequence rules are checked here.
pub(super) fn validate_level2(
    program: &SemanticProgram,
    provider: &dyn KnowledgeProvider,
) -> ValidationResult {
    let mut errors: Vec<Diagnostic> = Vec::new();

    for op in &program.operations {
        match op {
            SemanticOperation::Pick(pick) => {
                if let Err(e) = provider.grasp_plan(&pick.object) {
                    errors.push(Diagnostic::error(
                        format!("unresolvable object '{}': {}", pick.object.0, error_message(&e)),
                        pick.origin.clone(),
                    ));
                }
            }
            SemanticOperation::Place(place) => {
                if let Err(e) = provider.place_plan(&place.object, &place.destination) {
                    errors.push(Diagnostic::error(
                        format!(
                            "unresolvable placement '{}' at '{}': {}",
                            place.object.0,
                            place.destination.0,
                            error_message(&e)
                        ),
                        place.origin.clone(),
                    ));
                }
            }
            SemanticOperation::MoveTo(mv) => {
                if let Err(e) = provider.location_pose(&mv.destination) {
                    errors.push(Diagnostic::error(
                        format!("unresolvable location '{}': {}", mv.destination.0, error_message(&e)),
                        mv.origin.clone(),
                    ));
                }
            }
            SemanticOperation::Home(home) => {
                if let Err(e) = provider.home_pose() {
                    errors.push(Diagnostic::error(
                        format!("unresolvable home pose: {}", error_message(&e)),
                        home.origin.clone(),
                    ));
                }
            }
            SemanticOperation::Wait(_) => {
                // Wait has no resource references — nothing to validate.
            }
        }
    }

    ValidationResult {
        errors,
        warnings: Vec::new(),
    }
}

fn error_message(e: &LoweringError) -> String {
    match e {
        LoweringError::KnowledgeProvider(msg) => msg.clone(),
        LoweringError::MissingHomePose => "home pose not configured".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use thalos_core::ids::OperationId;
    use thalos_core::motion::MotionPose;

    use crate::knowledge::{GraspPlan, MockKnowledgeProvider};
    use crate::operation::*;
    use crate::resource::*;

    fn sample_pose(x: f64, y: f64, z: f64) -> MotionPose {
        MotionPose {
            position: [x, y, z],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }
    }

    fn sample_grasp_plan() -> GraspPlan {
        GraspPlan {
            grasp_frame: sample_pose(1.0, 0.0, 0.0),
            approach_frame: sample_pose(0.0, 1.0, 0.0),
            retreat_frame: sample_pose(0.0, 0.0, 1.0),
            preferred_tool: None,
        }
    }

    fn sample_provider() -> MockKnowledgeProvider {
        let object = ObjectId("bolt-1".to_string());
        let location = LocationId("tray-1".to_string());
        let shelf = LocationId("shelf-a".to_string());

        MockKnowledgeProvider::new()
            .with_grasp_ok(object.clone(), sample_grasp_plan())
            .with_place_ok(
                object.clone(),
                location.clone(),
                crate::knowledge::PlacementPlan {
                    drop_frame: sample_pose(2.0, 0.0, 0.0),
                    approach_frame: sample_pose(0.0, 2.0, 0.0),
                    retreat_frame: sample_pose(0.0, 0.0, 2.0),
                },
            )
            .with_location_ok(shelf, sample_pose(3.0, 0.0, 0.0))
            .with_home_pose(Ok(sample_pose(0.0, 0.0, 0.5)))
    }

    macro_rules! assert_error_count {
        ($result:expr, $count:expr) => {
            assert_eq!(
                $result.errors.len(),
                $count,
                "Expected {} errors, got {}: {:?}",
                $count,
                $result.errors.len(),
                $result.errors
            );
        };
    }

    // ── Unresolvable object in Pick ──────────────────────────────────────

    #[test]
    fn pick_with_unresolvable_object_errors() {
        let unknown = ObjectId("unknown".to_string());
        let provider = MockKnowledgeProvider::new()
            .with_grasp_error(unknown.clone(), LoweringError::KnowledgeProvider("not found".into()))
            .with_home_pose(Ok(sample_pose(0.0, 0.0, 0.0)));

        let program = SemanticProgram::new(vec![
            SemanticOperation::Pick(PickOp {
                origin: OperationId("pick-1".to_string()),
                object: unknown,
                tool: None,
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 1);
        assert_eq!(result.errors[0].origin, OperationId("pick-1".to_string()));
        assert!(result.errors[0].message.contains("unknown"));
    }

    // ── Unresolvable location in MoveTo ──────────────────────────────────

    #[test]
    fn move_to_with_unresolvable_location_errors() {
        let unknown = LocationId("unknown-loc".to_string());
        let provider = MockKnowledgeProvider::new()
            .with_location_error(unknown.clone(), LoweringError::KnowledgeProvider("location unknown".into()))
            .with_home_pose(Ok(sample_pose(0.0, 0.0, 0.0)));

        let program = SemanticProgram::new(vec![
            SemanticOperation::MoveTo(MoveToOp {
                origin: OperationId("move-1".to_string()),
                destination: unknown,
                tool: None,
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 1);
        assert_eq!(result.errors[0].origin, OperationId("move-1".to_string()));
    }

    // ── Unresolvable placement ──────────────────────────────────────────

    #[test]
    fn place_with_unresolvable_object_errors() {
        let unknown = ObjectId("unknown".to_string());
        let provider = MockKnowledgeProvider::new()
            .with_place_error(
                unknown.clone(),
                LocationId("any".to_string()),
                LoweringError::KnowledgeProvider("not found".into()),
            )
            .with_home_pose(Ok(sample_pose(0.0, 0.0, 0.0)));

        let program = SemanticProgram::new(vec![
            SemanticOperation::Place(PlaceOp {
                origin: OperationId("place-1".to_string()),
                object: unknown,
                destination: LocationId("any".to_string()),
                tool: None,
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 1);
        assert_eq!(result.errors[0].origin, OperationId("place-1".to_string()));
    }

    // ── Unresolvable home ────────────────────────────────────────────────

    #[test]
    fn home_without_pose_errors() {
        let provider = MockKnowledgeProvider::new()
            .with_home_pose(Err(LoweringError::MissingHomePose));

        let program = SemanticProgram::new(vec![
            SemanticOperation::Home(HomeOp {
                origin: OperationId("home-1".to_string()),
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 1);
        assert_eq!(result.errors[0].origin, OperationId("home-1".to_string()));
        assert!(result.errors[0].message.contains("home pose"));
    }

    // ── Wait does not trigger errors ─────────────────────────────────────

    #[test]
    fn wait_passes_without_provider_calls() {
        let provider = MockKnowledgeProvider::new().with_home_pose(Ok(sample_pose(0.0, 0.0, 0.0)));

        let program = SemanticProgram::new(vec![
            SemanticOperation::Wait(WaitOp {
                origin: OperationId("wait-1".to_string()),
                duration: Duration::from_secs(5),
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 0);
    }

    // ── Valid references pass ────────────────────────────────────────────

    #[test]
    fn valid_pick_passes() {
        let provider = sample_provider();
        let program = SemanticProgram::new(vec![
            SemanticOperation::Pick(PickOp {
                origin: OperationId("pick-1".to_string()),
                object: ObjectId("bolt-1".to_string()),
                tool: None,
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 0);
    }

    #[test]
    fn valid_move_to_passes() {
        let provider = sample_provider();
        let program = SemanticProgram::new(vec![
            SemanticOperation::MoveTo(MoveToOp {
                origin: OperationId("move-1".to_string()),
                destination: LocationId("shelf-a".to_string()),
                tool: None,
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 0);
    }

    #[test]
    fn valid_home_passes() {
        let provider = sample_provider();
        let program = SemanticProgram::new(vec![
            SemanticOperation::Home(HomeOp {
                origin: OperationId("home-1".to_string()),
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 0);
    }

    #[test]
    fn valid_mixed_program_passes_level2() {
        let provider = sample_provider();
        let program = SemanticProgram::new(vec![
            SemanticOperation::Pick(PickOp {
                origin: OperationId("op-1".to_string()),
                object: ObjectId("bolt-1".to_string()),
                tool: None,
            }),
            SemanticOperation::Place(PlaceOp {
                origin: OperationId("op-2".to_string()),
                object: ObjectId("bolt-1".to_string()),
                destination: LocationId("tray-1".to_string()),
                tool: None,
            }),
            SemanticOperation::MoveTo(MoveToOp {
                origin: OperationId("op-3".to_string()),
                destination: LocationId("shelf-a".to_string()),
                tool: None,
            }),
            SemanticOperation::Wait(WaitOp {
                origin: OperationId("op-4".to_string()),
                duration: Duration::from_secs(2),
            }),
            SemanticOperation::Home(HomeOp {
                origin: OperationId("op-5".to_string()),
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 0);
    }

    // ── Multiple errors ──────────────────────────────────────────────────

    #[test]
    fn multiple_unresolvable_operations_all_flagged() {
        let provider = MockKnowledgeProvider::new()
            .with_home_pose(Err(LoweringError::MissingHomePose));

        let program = SemanticProgram::new(vec![
            SemanticOperation::Pick(PickOp {
                origin: OperationId("pick-1".to_string()),
                object: ObjectId("unknown-1".to_string()),
                tool: None,
            }),
            SemanticOperation::Home(HomeOp {
                origin: OperationId("home-1".to_string()),
            }),
        ]);

        let result = validate_level2(&program, &provider);
        assert_error_count!(result, 2);
    }
}
