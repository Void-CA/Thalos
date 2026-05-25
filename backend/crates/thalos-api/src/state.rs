use std::sync::Arc;

use thalos_core::models::factories::create_planar_2r;

use crate::service::SceneService;

pub fn new_default_state() -> Arc<AppState> {
    let robot = create_planar_2r(1.0, 1.0);
    let service = SceneService::new(robot);
    Arc::new(AppState { service })
}

pub struct AppState {
    pub(crate) service: SceneService,
}
