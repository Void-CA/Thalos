use std::sync::Arc;

use thalos_core::models::RobotModel;
use thalos_runtime::{backends::InternalBackend, SceneService};

use crate::features::robots::service::RobotService;

pub struct Services {
    pub scene: SceneService,
    pub robots: RobotService,
}

pub struct AppState {
    pub services: Arc<Services>,
}

pub type SharedState = Arc<AppState>;

pub fn new_default_state() -> SharedState {
    let backend = Box::new(InternalBackend);
    let scene = SceneService::new(backend, RobotModel::Planar2R);

    let robots = RobotService;

    Arc::new(AppState {
        services: Arc::new(Services {
            scene,
            robots,
        }),
    })
}