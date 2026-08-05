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

/// Parse an optional raw env value into a boolean feature flag.
///
/// Accepts "1", "true", "yes", "on" (case-insensitive, whitespace
/// trimmed). Absent or unparseable values default to `false`.
fn parse_bool_value(value: Option<&str>) -> bool {
    match value {
        Some(raw) => matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        None => false,
    }
}

/// Read `var` from the process environment and parse it as a boolean feature
/// flag (see [`parse_bool_value`] for the accepted values).
///
/// Used ONLY at the binary entry point (`main.rs`) so that tests building
/// state via `new_default_state()` stay hermetic regardless of the shell env.
pub fn parse_env_bool(var: &str) -> bool {
    parse_bool_value(std::env::var(var).ok().as_deref())
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

    // ── parse_env_bool (design D5 env wiring, PR1) ──

    #[test]
    fn parse_bool_value_accepts_truthy_values_case_insensitive() {
        assert!(parse_bool_value(Some("1")));
        assert!(parse_bool_value(Some("true")));
        assert!(parse_bool_value(Some("TRUE")));
        assert!(parse_bool_value(Some("Yes")));
        assert!(parse_bool_value(Some("ON")));
        assert!(
            parse_bool_value(Some("  on  ")),
            "value must be trimmed before matching"
        );
    }

    #[test]
    fn parse_bool_value_rejects_falsy_garbage_and_empty() {
        assert!(!parse_bool_value(Some("0")));
        assert!(!parse_bool_value(Some("false")));
        assert!(!parse_bool_value(Some("no")));
        assert!(!parse_bool_value(Some("garbage")));
        assert!(!parse_bool_value(Some("")));
    }

    #[test]
    fn parse_bool_value_absent_defaults_to_false() {
        assert!(!parse_bool_value(None));
    }

    #[test]
    fn parse_env_bool_absent_var_defaults_to_false() {
        // Unique name — never set in any shell; proves the None path of the
        // wrapper that new_default_state relies on (hermeticity).
        assert!(!parse_env_bool("THALOS_TEST_UNSET_VAR_3f9a2c"));
    }

    #[test]
    fn parse_env_bool_reads_truthy_var_from_process_environment() {
        // Unique name per test → parallel-safe (no other test touches VAR).
        const VAR: &str = "THALOS_TEST_SET_VAR_7d1e4b";
        // SAFETY: process-global env mutation; the unique name isolates this
        // test from every other test in the binary.
        unsafe { std::env::set_var(VAR, "true") };
        assert!(parse_env_bool(VAR));
    }

    #[test]
    fn parse_env_bool_trims_value_read_from_process_environment() {
        const VAR: &str = "THALOS_TEST_SET_VAR_9b2f71";
        // SAFETY: same isolation argument as the sibling test above.
        unsafe { std::env::set_var(VAR, "  Yes  ") };
        assert!(parse_env_bool(VAR));
    }
}
