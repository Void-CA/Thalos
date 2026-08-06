pub mod dto;
pub mod error;
pub mod prelude;
pub mod state;
pub mod types;

pub use state::{
    AppState, Services, new_default_state, new_state_with_scene_writeback,
    new_state_with_scene_writeback_and_history_cap, parse_env_bool, parse_env_usize,
    register_esp32_from_env, should_register_esp32,
};
