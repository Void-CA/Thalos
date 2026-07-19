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

        // Motion program — preview (compile only, no execution)
        .route("/scene/motion/plan", post(handler::preview_plan))

        // Execution control
        .route("/scene/motion/start", post(handler::start_execution))
        .route("/scene/motion/pause", post(handler::pause_execution))
        .route("/scene/motion/resume", post(handler::resume_execution))
        .route("/scene/motion/cancel", post(handler::cancel_execution))
        .route("/scene/motion/reset", post(handler::reset_execution))

        // Execution seek (replay/simulation position control)
        .route("/scene/motion/seek", post(handler::seek_execution))

        // Execution tick (polling-based advance)
        .route("/scene/motion/tick", post(handler::tick_execution))

        // IK solve (no mutation) + execute
        .route("/scene/solve-ik-position", post(handler::solve_ik_position))
        .route("/scene/solve-ik-pose", post(handler::solve_ik_pose))
        .route("/scene/execute-ik", post(handler::execute_ik))

        // FK → scene (same as set_joints but exposed as a separate endpoint)
        .route("/scene/from-fk", post(handler::set_joints))

        // TCP selection
        .route("/scene/tcp", post(handler::select_tool_frame))

        // Utilities
        .route("/scene/validate", post(handler::validate))
        .route("/scene/diff", post(handler::diff))
}
