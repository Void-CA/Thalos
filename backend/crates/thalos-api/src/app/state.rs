use std::sync::Arc;

use thalos_core::models::RobotModel;

use crate::features::{
    robots::service::RobotService,
    scene::SceneService,
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
    let scene = SceneService::new(RobotModel::Planar2R);

    let robots = RobotService;

    Arc::new(AppState {
        services: Arc::new(Services {
            scene,
            robots,
        }),
    })
}