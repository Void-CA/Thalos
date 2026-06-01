use std::f64::consts::PI;

use thalos_core::models::RobotModel;
use thalos_runtime::{backends::InternalBackend, Command, SceneService};

fn new_service() -> SceneService {
    let backend = Box::new(InternalBackend);
    SceneService::new(backend, RobotModel::Planar2R)
}

#[test]
fn snapshot_returns_valid_scene() {
    let service = new_service();
    let snapshot = service.snapshot();
    assert!(snapshot.is_ok(), "snapshot should build and validate");
}

#[test]
fn snapshot_deterministic() {
    let service = new_service();
    let a = service.snapshot().unwrap();
    let b = service.snapshot().unwrap();
    assert_eq!(a.scene, b.scene, "same state must produce identical scene");
}

#[test]
fn execute_set_joints_changes_scene() {
    let service = new_service();
    let a = service.snapshot().unwrap();

    let b = service
        .execute(Command::SetJoints(vec![PI / 2.0, 0.0]))
        .unwrap();

    assert_ne!(a.scene, b.scene, "different joints should produce different scenes");
}

#[test]
fn execute_load_robot_changes_robot() {
    let service = new_service();
    let a = service.snapshot().unwrap();

    let b = service
        .execute(Command::LoadRobot("scara".into()))
        .unwrap();

    assert_ne!(a.robot, b.robot, "different robot model should be loaded");
}

#[test]
fn execute_load_robot_invalid_id() {
    let service = new_service();
    let result = service.execute(Command::LoadRobot("nonexistent".into()));
    assert!(result.is_err(), "invalid robot id should fail");
}
