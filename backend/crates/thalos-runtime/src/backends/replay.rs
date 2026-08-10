//! ReplayBackend — reproduce un MotionTrace como si fuera un robot real.
//!
//! Implementa [`RobotController`] para ser intercambiable con
//! `SimulationController` a través de `BackendManager`.
//!
//! # Flujo
//!
//! ```text
//! MotionTrace → ReplayBackend
//!                  ├── PlaybackCursor (seek, speed, step)
//!                  └── Interpolator (muestras → RobotState)
//! ```
//!
//! El frontend controla el replay (stop/pause/resume) y el ciclo de tick
//! avanza el cursor mediante `advance(dt)`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use arc_swap::ArcSwap;
use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::backends::controller::{BackendCapabilities, RobotController};
use crate::backends::playback::cursor::PlaybackCursor;
use crate::backends::playback::interpolator::{Interpolator, LinearInterpolator};
use crate::error::ControllerError;
use crate::motion_trace::MotionTrace;
use crate::state::robot_state::RobotState;

/// Backend que reproduce un MotionTrace previamente grabado.
///
/// Se comporta como un robot conectado: responde a Stop/Pause/Resume,
/// produce RobotStates interpolados del trace, y avanza según el
/// ciclo de tick del runtime.
pub struct ReplayBackend {
    trace: MotionTrace,
    cursor: RwLock<PlaybackCursor>,
    interpolator: Box<dyn Interpolator>,
    state: ArcSwap<RobotState>,
    connected: AtomicBool,
}

impl ReplayBackend {
    /// Crear un ReplayBackend a partir de un trace.
    ///
    /// Usa interpolación lineal por defecto.
    pub fn new(trace: MotionTrace) -> Self {
        let total = trace.duration();
        let initial_state =
            LinearInterpolator::new().interpolate(&trace, std::time::Duration::ZERO);
        Self {
            trace,
            cursor: RwLock::new(PlaybackCursor::new(total)),
            interpolator: Box::new(LinearInterpolator::new()),
            state: ArcSwap::new(initial_state),
            connected: AtomicBool::new(false),
        }
    }

    /// Crear con interpolador personalizado.
    pub fn with_interpolator(trace: MotionTrace, interpolator: Box<dyn Interpolator>) -> Self {
        let total = trace.duration();
        let initial_state = interpolator.interpolate(&trace, std::time::Duration::ZERO);
        Self {
            trace,
            cursor: RwLock::new(PlaybackCursor::new(total)),
            interpolator,
            state: ArcSwap::new(initial_state),
            connected: AtomicBool::new(false),
        }
    }

    /// Actualizar el estado interno interpolando en la posición del cursor.
    async fn update_state(&self) {
        let pos = self.cursor.read().await.position();
        let state = self.interpolator.interpolate(&self.trace, pos);
        self.state.store(state);
    }

    /// Obtener el trace para exportación.
    pub fn trace(&self) -> &MotionTrace {
        &self.trace
    }
}

#[async_trait]
impl RobotController for ReplayBackend {
    async fn connect(&mut self) -> Result<(), ControllerError> {
        if self.trace.is_empty() {
            return Err(ControllerError::NotConnected);
        }
        if self.connected.swap(true, Ordering::SeqCst) {
            return Err(ControllerError::AlreadyConnected);
        }
        self.cursor.write().await.resume();
        self.update_state().await;
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), ControllerError> {
        self.connected.store(false, Ordering::SeqCst);
        self.cursor.write().await.stop();
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn execute(
        &mut self,
        _waypoints: Vec<Vec<f64>>,
        _duration: f64,
    ) -> Result<(), ControllerError> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(ControllerError::NotConnected);
        }
        // ReplayBackend no ejecuta nuevas trayectorias.
        // El cursor ya está listo para reproducir.
        self.cursor.write().await.resume();
        self.update_state().await;
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ControllerError> {
        self.cursor.write().await.stop();
        self.update_state().await;
        Ok(())
    }

    async fn pause(&mut self) -> Result<(), ControllerError> {
        self.cursor.write().await.pause();
        // Update state to reflect current position
        self.update_state().await;
        Ok(())
    }

    async fn resume(&mut self) -> Result<(), ControllerError> {
        self.cursor.write().await.resume();
        Ok(())
    }

    async fn advance(&self, dt: f64) -> Result<(), ControllerError> {
        let mut cursor = self.cursor.write().await;
        cursor.advance(dt);
        drop(cursor);
        self.update_state().await;
        Ok(())
    }

    async fn seek(&self, position: f64) -> Result<(), ControllerError> {
        let mut cursor = self.cursor.write().await;
        cursor.seek_progress(position);
        drop(cursor);
        self.update_state().await;
        Ok(())
    }

    async fn robot_state(&self) -> Arc<RobotState> {
        self.state.load_full()
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            pause: true,
            resume: true,
            io: false,
            gripper: false,
            streaming: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::controller::RobotController;
    use crate::motion_trace::MotionSample;
    use std::time::Duration;

    fn sample_trace() -> MotionTrace {
        let mut trace = MotionTrace::new();
        trace.push(MotionSample {
            timestamp: Duration::from_secs_f64(0.0),
            joints: vec![0.0, 0.0],
            velocities: vec![0.0, 0.0],
            target_joints: None,
            progress: 0.0,
            errors: vec![],
        });
        trace.push(MotionSample {
            timestamp: Duration::from_secs_f64(1.0),
            joints: vec![1.0, 2.0],
            velocities: vec![1.0, 2.0],
            target_joints: None,
            progress: 1.0,
            errors: vec![],
        });
        trace
    }

    #[tokio::test]
    async fn connect_rejects_empty_trace() {
        let mut backend = ReplayBackend::new(MotionTrace::new());
        let result = RobotController::connect(&mut backend).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn connect_and_read_initial_state() {
        let mut backend = ReplayBackend::new(sample_trace());
        RobotController::connect(&mut backend)
            .await
            .expect("connect");
        assert!(RobotController::is_connected(&backend));

        let state = backend.robot_state().await;
        assert!((state.joints.positions[0] - 0.0).abs() < 1e-6);
    }

    #[tokio::test]
    async fn advance_updates_position() {
        let mut backend = ReplayBackend::new(sample_trace());
        RobotController::connect(&mut backend)
            .await
            .expect("connect");

        backend.advance(0.5).await.expect("advance");
        let state = backend.robot_state().await;
        assert!((state.joints.positions[0] - 0.5).abs() < 1e-6);
    }

    #[tokio::test]
    async fn pause_and_resume() {
        let mut backend = ReplayBackend::new(sample_trace());
        RobotController::connect(&mut backend)
            .await
            .expect("connect");

        backend.advance(0.3).await.expect("advance");
        RobotController::pause(&mut backend).await.expect("pause");
        backend.advance(0.5).await.expect("advance"); // no avanza mientras pausado
        let state = backend.robot_state().await;
        assert!((state.joints.positions[0] - 0.3).abs() < 1e-6);

        RobotController::resume(&mut backend).await.expect("resume");
        backend.advance(0.2).await.expect("advance");
        let state = backend.robot_state().await;
        assert!((state.joints.positions[0] - 0.5).abs() < 1e-6);
    }

    #[tokio::test]
    async fn stop_resets_to_beginning() {
        let mut backend = ReplayBackend::new(sample_trace());
        RobotController::connect(&mut backend)
            .await
            .expect("connect");

        backend.advance(0.7).await.expect("advance");
        RobotController::stop(&mut backend).await.expect("stop");

        let state = backend.robot_state().await;
        assert!((state.joints.positions[0] - 0.0).abs() < 1e-6);
    }
}
