use std::sync::Arc;

use thalos_core::models::factory::{RobotModel, RobotRegistry};

use crate::features::{
    scene::SceneService,
    robots::service::RobotService
};

pub struct Services {
    pub scene: SceneService,
    pub robots: RobotService,
}

pub struct AppState {
    pub services: Arc<Services>,
}

pub type SharedState = Arc<AppState>;

pub fn new_default_state() -> SharedState {
    let robot = RobotRegistry::create_default(RobotModel::Planar2R);
    let scene = SceneService::new(robot);
    let robots = RobotService;
    Arc::new(AppState {
        services: Arc::new(Services { scene, robots }),
    })
}
