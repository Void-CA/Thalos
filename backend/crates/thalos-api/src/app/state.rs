use std::sync::Arc;

use tokio::sync::RwLock;

use thalos_core::models::RobotModel;
use thalos_runtime::{
    backends::{
        controller::simulation::SimulationController,
        manager::BackendManager,
        InternalBackend,
    },
    RobotController, SceneService, SessionManager,
};

use crate::features::robots::service::RobotService;

pub struct Services {
    pub scene: SceneService,
    pub robots: RobotService,
    pub manager: Arc<BackendManager>,
    pub sessions: Arc<SessionManager>,
}

pub struct AppState {
    pub services: Arc<Services>,
}

pub type SharedState = Arc<AppState>;

pub async fn new_default_state() -> SharedState {
    let backend = Box::new(InternalBackend);

    let controller = Arc::new(RwLock::new(
        SimulationController::new(RobotModel::Planar2R.metadata().dof),
    )) as Arc<RwLock<dyn RobotController + Send + Sync>>;

    let manager = Arc::new(BackendManager::new());
    manager
        .set_active(controller)
        .await
        .expect("Failed to register simulation controller");

    let sessions = Arc::new(SessionManager::new());
    let scene = SceneService::with_session_manager(
        backend,
        manager.clone(),
        RobotModel::Planar2R,
        sessions.clone(),
    );
    let robots = RobotService;

    Arc::new(AppState {
        services: Arc::new(Services {
            scene,
            robots,
            manager,
            sessions,
        }),
    })
}