use std::sync::Arc;

use thalos_core::models::factories::create_planar_2r;

use crate::app::service::SceneService;

pub struct Services {
    pub scene: SceneService,
}

pub struct AppState {
    pub services: Arc<Services>,
}

pub fn new_default_state() -> Arc<AppState> {
    let robot = create_planar_2r(1.0, 1.0);
    let scene = SceneService::new(robot);
    Arc::new(AppState {
        services: Arc::new(Services { scene }),
    })
}
