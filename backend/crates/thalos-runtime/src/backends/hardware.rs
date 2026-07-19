//! Hardware backend — ejecuta comandos en un robot físico via Transport.
//!
//! Implementa [`ExecutionBackend`] usando un [`Transport`] concreto.
//! Convierte [`RobotCommand`] a wire format y parsea la telemetría
//! de vuelta a [`RobotState`].

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::backends::execution::ExecutionBackend;
use crate::backends::transport::{Transport, TransportError};
use crate::error::ControllerError;
use crate::robot_command::RobotCommand;
use crate::state::robot_state::{ConnectionState, RobotState};

/// Backend de hardware real.
///
/// Usa un [`Transport`] para comunicarse con el dispositivo físico.
/// El transporte puede ser Serial, TCP, MQTT, o `FakeTransport` para tests.
pub struct HardwareBackend {
    connected: AtomicBool,
    transport: RwLock<Box<dyn Transport>>,
    state: Arc<std::sync::RwLock<RobotState>>,
}

impl HardwareBackend {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self {
            connected: AtomicBool::new(false),
            transport: RwLock::new(transport),
            state: Arc::new(std::sync::RwLock::new(RobotState::default())),
        }
    }

    /// Parsear una línea de telemetría del ESP.
    ///
    /// Formato esperado: `STATE <j1> <j2> ... <jN>`
    fn parse_state_line(&self, line: &str) -> Option<RobotState> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 || parts[0] != "STATE" {
            return None;
        }
        let joints: Vec<f64> = parts[1..]
            .iter()
            .filter_map(|s| s.parse::<f64>().ok())
            .collect();
        if joints.is_empty() {
            return None;
        }
        Some(RobotState {
            revision: 0,
            joints: crate::state::robot_state::JointState {
                positions: joints,
                velocities: vec![],
                torques: vec![],
            },
            connection: ConnectionState::Connected,
            ..RobotState::default()
        })
    }
}

#[async_trait]
impl ExecutionBackend for HardwareBackend {
    async fn connect(&mut self) -> Result<(), ControllerError> {
        let mut transport = self.transport.write().await;
        transport.connect().await.map_err(|e| {
            ControllerError::NotConnected
        })?;
        self.connected.store(true, Ordering::SeqCst);
        // Mark state as connected
        if let Ok(mut state) = self.state.write() {
            state.connection = ConnectionState::Connected;
        }
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), ControllerError> {
        let mut transport = self.transport.write().await;
        let _ = transport.disconnect().await;
        self.connected.store(false, Ordering::SeqCst);
        if let Ok(mut state) = self.state.write() {
            state.connection = ConnectionState::Disconnected;
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn send_command(&mut self, command: RobotCommand) -> Result<(), ControllerError> {
        let wire = command.to_wire_format();
        let mut line = wire;
        line.push('\n');

        let mut transport = self.transport.write().await;
        transport.send(line.as_bytes()).await.map_err(|_| {
            self.connected.store(false, Ordering::SeqCst);
            ControllerError::NotConnected
        })?;

        // Try to read a STATE response
        match transport.receive().await {
            Ok(data) => {
                if let Ok(line_str) = String::from_utf8(data) {
                    if let Some(state) = self.parse_state_line(&line_str) {
                        if let Ok(mut s) = self.state.write() {
                            *s = state;
                        }
                    }
                }
            }
            Err(_) => {
                // Non-fatal: telemetry read failed, state stays as-is
            }
        }

        Ok(())
    }

    async fn read_state(&self) -> Arc<RobotState> {
        match self.state.read() {
            Ok(guard) => Arc::new(guard.clone()),
            Err(_) => Arc::new(RobotState::default()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::transport::FakeTransport;

    #[tokio::test]
    async fn connect_disconnect() {
        let transport = Box::new(FakeTransport::new());
        let mut backend = HardwareBackend::new(transport);
        backend.connect().await.expect("connect");
        assert!(backend.is_connected());
        backend.disconnect().await.expect("disconnect");
        assert!(!backend.is_connected());
    }

    #[tokio::test]
    async fn send_movej_receives_state() {
        let transport = Box::new(FakeTransport::new());
        transport.inject_response(b"STATE 0.5 -0.3 0.1 0.0\n".to_vec());
        let mut backend = HardwareBackend::new(transport);
        backend.connect().await.expect("connect");

        let cmd = RobotCommand::MoveJ {
            joints: vec![0.5, -0.3, 0.1, 0.0],
            velocity: None,
        };
        backend.send_command(cmd).await.expect("send_command");

        let state = backend.read_state().await;
        assert_eq!(state.joints.positions, vec![0.5, -0.3, 0.1, 0.0]);
    }

    #[tokio::test]
    async fn parse_state_line() {
        let transport = Box::new(FakeTransport::new());
        let backend = HardwareBackend::new(transport);
        let state = backend.parse_state_line("STATE 1.0 2.0 3.0").unwrap();
        assert_eq!(state.joints.positions, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn parse_invalid_state_line() {
        let transport = Box::new(FakeTransport::new());
        let backend = HardwareBackend::new(transport);
        assert!(backend.parse_state_line("INVALID").is_none());
        assert!(backend.parse_state_line("STATE").is_none());
    }
}
