//! RepairContext — capacidades cinemáticas necesarias para reparar.
//!
//! El planner inyecta este contexto a las estrategias. Las estrategias
//! que no necesitan cinemática (SplitSegment) lo ignoran.

use std::sync::Arc;

use thalos_core::{
    kinematics::inverse::solver::IKSolver, robot::serial_chain::SerialChain,
    spatial::frame::FrameId,
};

/// Capacidades cinemáticas disponibles para las estrategias de reparación.
///
/// Separado del dominio de reparación para que `repair::domain` no dependa
/// de `thalos_core::kinematics` ni `thalos_core::robot`.
pub struct RepairContext {
    pub chain: Arc<SerialChain>,
    pub tcp_frame: FrameId,
    pub ik_solver: Arc<dyn IKSolver>,
}
