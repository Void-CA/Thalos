//! Execution backends — abstracción para simulación y hardware real.
//!
//! Define el contrato entre el runtime de Thalos y cualquier backend de
//! ejecución: simulado, ESP32, ROS 2, etc.
//!
//! # Flujo
//!
//! ```text
//! Runtime → RobotCommand → ExecutionBackend → RobotState
//! ```

use std::sync::Arc;

use async_trait::async_trait;

use crate::error::ControllerError;
use crate::robot_command::RobotCommand;
use crate::state::robot_state::RobotState;

/// Backend de ejecución: simulación o hardware real.
///
/// El runtime envía comandos atómicos ([`RobotCommand`]) y lee el estado
/// resultante ([`RobotState`]). El backend decide cómo ejecutarlos.
///
/// Para simulación: comandos se ejecutan instantáneamente, estado se interpola.
/// Para hardware real: comandos se serializan y envían por el transporte,
/// estado refleja la telemetría más reciente.
#[async_trait]
pub trait ExecutionBackend: Send + Sync {
    /// Conectar con el backend.
    /// Para simulación: no-op. Para hardware: abrir puerto serie/TCP.
    async fn connect(&mut self) -> Result<(), ControllerError>;

    /// Desconectar.
    async fn disconnect(&mut self) -> Result<(), ControllerError>;

    /// True si el backend está conectado.
    fn is_connected(&self) -> bool;

    /// Enviar un comando atómico al backend.
    ///
    /// El backend NO ejecuta el comando inmediatamente — lo encola.
    /// El ciclo de tick (advance + read_state) lo procesa.
    async fn send_command(&mut self, command: RobotCommand) -> Result<(), ControllerError>;

    /// Leer el estado actual del robot.
    ///
    /// Para simulación: devuelve el estado interpolado de la trayectoria.
    /// Para hardware real: devuelve la telemetría más reciente.
    async fn read_state(&self) -> Arc<RobotState>;
}
