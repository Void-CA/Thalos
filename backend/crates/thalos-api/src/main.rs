use std::net::SocketAddr;

use axum::Router;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

mod routes;
mod service;
mod state;

use state::new_default_state;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let app_state = new_default_state();

    let app = Router::new()
        .nest("/api", routes::scene_router())
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    tracing::info!("listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
