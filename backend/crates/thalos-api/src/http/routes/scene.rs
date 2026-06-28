use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};

use crate::app::state::AppState;
use crate::features::scene::handler;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // Current visual scene
        .route("/scene", get(handler::get_scene))

        // Runtime mutations
        .route("/scene/joints", post(handler::set_joints))
        .route("/scene/robot", post(handler::load_robot))
        .route("/scene/robot/from-urdf", post(handler::load_robot_from_urdf))

        // IK motion commands
        .route("/scene/move-to-position", post(handler::move_to_position))
        .route("/scene/move-to-pose", post(handler::move_to_pose))

        // IK solve (no mutation) + execute
        .route("/scene/solve-ik-position", post(handler::solve_ik_position))
        .route("/scene/solve-ik-pose", post(handler::solve_ik_pose))
        .route("/scene/execute-ik", post(handler::execute_ik))

        // FK → scene (same as set_joints but exposed as a separate endpoint)
        .route("/scene/from-fk", post(handler::set_joints))

        // Utilities
        .route("/scene/validate", post(handler::validate))
        .route("/scene/diff", post(handler::diff))
}
