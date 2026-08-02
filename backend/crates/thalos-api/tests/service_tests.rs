use std::f64::consts::PI;
use std::sync::Arc;

use thalos_core::models::RobotModel;
use thalos_runtime::backends::{BackendManager, InternalBackend};
use thalos_runtime::{Command, SceneService};

fn new_service() -> SceneService {
    let backend = Box::new(InternalBackend);
    let manager = Arc::new(BackendManager::new());
    SceneService::new(backend, manager, RobotModel::Planar2R)
}

#[tokio::test]
async fn snapshot_returns_state() {
    let service = new_service();
    let snapshot = service.snapshot().await;
    assert!(snapshot.is_ok(), "snapshot should succeed");
}

#[tokio::test]
async fn snapshot_deterministic_fk() {
    let service = new_service();
    let a = service.snapshot().await.unwrap();
    let b = service.snapshot().await.unwrap();

    assert_eq!(
        a.fk_result.ee_position(),
        b.fk_result.ee_position(),
        "same state must produce identical FK result"
    );
}

#[tokio::test]
async fn execute_set_joints_changes_fk() {
    let service = new_service();
    let a = service.snapshot().await.unwrap();

    let b = service
        .execute(Command::SetJoints(vec![PI / 2.0, 0.0]))
        .await
        .unwrap();

    assert_ne!(
        a.fk_result.ee_position(),
        b.fk_result.ee_position(),
        "different joints should produce different FK results"
    );
}

#[tokio::test]
async fn execute_load_robot_changes_robot() {
    let service = new_service();
    let a = service.snapshot().await.unwrap();

    let b = service
        .execute(Command::LoadRobot(RobotModel::Scara))
        .await
        .unwrap();

    assert_ne!(a.robot, b.robot, "different robot model should be loaded");
}

#[tokio::test]
async fn execute_load_robot_planar_3r() {
    let service = new_service();

    let result = service
        .execute(Command::LoadRobot(RobotModel::Planar3R))
        .await;
    assert!(result.is_ok(), "Planar3R is a valid robot model");

    let snapshot = result.unwrap();
    assert_eq!(
        snapshot.robot,
        Some(RobotModel::Planar3R),
        "built-in load must carry Some(model) — catalog membership"
    );
    assert!(
        snapshot.joints_meta.is_empty(),
        "built-in load must have empty joints_meta (metadata comes from RobotModel)"
    );
    assert_eq!(snapshot.joints.len(), 3);
}
