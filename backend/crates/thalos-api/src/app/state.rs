use std::sync::Arc;

use tokio::sync::RwLock;

use thalos_core::models::RobotModel;
use thalos_runtime::{
    RobotController, SceneService, SessionManager,
    backends::{
        InternalBackend, controller::simulation::SimulationController, manager::BackendManager,
    },
};

use crate::features::repair::session_handler::SessionServiceState;
use crate::features::robots::service::RobotService;

pub struct Services {
    pub scene: SceneService,
    pub robots: RobotService,
    pub manager: Arc<BackendManager>,
    pub sessions: Arc<SessionManager>,
}

pub struct AppState {
    pub services: Arc<Services>,
    pub session_service: SessionServiceState,
}

pub type SharedState = Arc<AppState>;

/// Fail-fast guard for invariant I1 at the runtime state level.
///
/// The simulation controller's DOF MUST match the DOF of the scene's robot
/// model — the same robot that planning resolves against. Kept as a pure
/// function so the check is unit-testable without building the tokio
/// services; `new_default_state` panics with the returned message.
fn validate_dof_consistency(controller_dof: usize, scene_model: RobotModel) -> Result<(), String> {
    let scene_dof = scene_model.metadata().dof;
    if controller_dof == scene_dof {
        Ok(())
    } else {
        Err(format!(
            "runtime DOF mismatch (I1): simulation controller has {controller_dof} DOF but scene robot model {scene_model:?} has {scene_dof} DOF"
        ))
    }
}

pub async fn new_default_state() -> SharedState {
    // Design D5: scene-writeback is OFF by default (rollback-safe). The
    // first runtime-mutating surface (PR4 apply) requires explicit opt-in.
    new_state_with_scene_writeback(false).await
}

/// State builder with the scene-writeback feature flag (design D5)
/// configurable.
///
/// `new_default_state` keeps the flag OFF; integration tests that exercise
/// the PR4 apply/write-back surface opt in via this constructor. Production
/// rollout enables the flag per-environment after integration tests pass.
pub async fn new_state_with_scene_writeback(scene_writeback: bool) -> SharedState {
    let backend = Box::new(InternalBackend);

    // Runtime controller DOF and scene robot model are named independently so
    // the I1 guard below actually protects against drift between the two.
    let controller_dof = RobotModel::Planar2R.metadata().dof;
    let scene_model = RobotModel::Planar2R;

    validate_dof_consistency(controller_dof, scene_model)
        .expect("runtime state must satisfy invariant I1 (single robot per compilation)");

    let controller = Arc::new(RwLock::new(SimulationController::new(controller_dof)))
        as Arc<RwLock<dyn RobotController + Send + Sync>>;

    let manager = Arc::new(BackendManager::new());
    manager
        .set_active(controller)
        .await
        .expect("Failed to register simulation controller");

    let sessions = Arc::new(SessionManager::new());
    let scene =
        SceneService::with_session_manager(backend, manager.clone(), scene_model, sessions.clone());
    if scene_writeback {
        scene.set_scene_writeback(true).await;
    }
    let robots = RobotService;

    Arc::new(AppState {
        services: Arc::new(Services {
            scene,
            robots,
            manager,
            sessions,
        }),
        session_service: SessionServiceState::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consistent_dof_is_accepted() {
        assert!(validate_dof_consistency(2, RobotModel::Planar2R).is_ok());
        assert!(validate_dof_consistency(4, RobotModel::Scara).is_ok());
    }

    #[test]
    fn mismatched_dof_is_rejected_with_clear_error() {
        let err = validate_dof_consistency(6, RobotModel::Planar2R).unwrap_err();
        assert!(
            err.contains("6"),
            "error must name the controller DOF: {err}"
        );
        assert!(
            err.contains("2"),
            "error must name the scene robot DOF: {err}"
        );
        assert!(err.contains("I1"), "error must cite invariant I1: {err}");
    }
}
