use std::sync::Arc;

use thalos_core::models::factory::{RobotModel, RobotRegistry};

use crate::features::scene::SceneService;

pub struct Services {
    pub scene: SceneService,
}

pub struct AppState {
    pub services: Arc<Services>,
}

pub fn new_default_state() -> Arc<AppState> {
    let robot = RobotRegistry::create(RobotModel::Planar2R);
    let scene = SceneService::new(robot);
    Arc::new(AppState {
        services: Arc::new(Services { scene }),
    })
}
