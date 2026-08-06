use std::net::SocketAddr;

use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

use thalos_api::{
    app::{
        new_state_with_scene_writeback_and_history_cap, parse_env_bool, parse_env_usize,
        register_esp32_from_env,
    },
    http::app_router,
};
use thalos_runtime::DEFAULT_HISTORY_CAP;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    // Design D5: THALOS_SCENE_WRITEBACK / THALOS_HISTORY_CAP read ONLY at the
    // binary entry point, never inside the state constructor — tests building
    // state via `new_default_state()` stay hermetic regardless of the shell env.
    let app_state = new_state_with_scene_writeback_and_history_cap(
        parse_env_bool("THALOS_SCENE_WRITEBACK"),
        parse_env_usize("THALOS_HISTORY_CAP", DEFAULT_HISTORY_CAP),
    )
    .await;

    // PR2a: THALOS_EXECUTION_BACKEND + THALOS_SERIAL_PORT register the Esp32
    // backend at the binary entry point (hermetic tests untouched). The lazy
    // factory opens no serial port here — only connect does.
    register_esp32_from_env(&app_state).await;

    let app = app_router()
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    tracing::info!("listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
