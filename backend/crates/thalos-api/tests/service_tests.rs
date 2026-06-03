use std::f64::consts::PI;

use thalos_core::models::RobotModel;
use thalos_runtime::{backends::InternalBackend, Command, SceneService};

fn new_service() -> SceneService {
    let backend = Box::new(InternalBackend);
    SceneService::new(backend, RobotModel::Planar2R)
}

#[test]
fn snapshot_returns_state() {
    let service = new_service();
    let snapshot = service.snapshot();
    assert!(snapshot.is_ok(), "snapshot should succeed");
}

#[test]
fn snapshot_deterministic_fk() {
    let service = new_service();
    let a = service.snapshot().unwrap();
    let b = service.snapshot().unwrap();

    assert_eq!(
        a.fk_result.ee_position(),
        b.fk_result.ee_position(),
        "same state must produce identical FK result"
    );
}

#[test]
fn execute_set_joints_changes_fk() {
    let service = new_service();
    let a = service.snapshot().unwrap();

    let b = service
        .execute(Command::SetJoints(vec![PI / 2.0, 0.0]))
        .unwrap();

    assert_ne!(
        a.fk_result.ee_position(),
        b.fk_result.ee_position(),
        "different joints should produce different FK results"
    );
}

#[test]
fn execute_load_robot_changes_robot() {
    let service = new_service();
    let a = service.snapshot().unwrap();

    let b = service
        .execute(Command::LoadRobot(RobotModel::Scara))
        .unwrap();

    assert_ne!(a.robot, b.robot, "different robot model should be loaded");
}

#[test]
fn execute_load_robot_planar_3r() {
    let service = new_service();

    let result = service.execute(Command::LoadRobot(RobotModel::Planar3R));
    assert!(result.is_ok(), "Planar3R is a valid robot model");

    let snapshot = result.unwrap();
    assert_eq!(snapshot.robot, RobotModel::Planar3R);
    assert_eq!(snapshot.joints.len(), 3);
}
