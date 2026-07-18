//! Comandos de robot — lenguaje común entre el runtime y el backend físico.
//!
//! El runtime produce `RobotCommand`s. El backend (simulado o real) los ejecuta.
//! Esto desacopla la semántica de planificación ("MoveJ a esta posición") del
//! protocolo de transporte ("enviar 4 bytes por serie").

/// Comando de robot: instrucción atómica que el backend debe ejecutar.
#[derive(Debug, Clone, PartialEq)]
pub enum RobotCommand {
    /// MoveJ: mover articulaciones a una posición objetivo.
    MoveJ {
        joints: Vec<f64>,
        velocity: Option<f64>,
    },
    /// Detener movimiento inmediatamente.
    Stop,
    /// Pausar la ejecución.
    Pause,
    /// Reanudar una ejecución pausada.
    Resume,
    /// Habilitar motores (power on).
    Enable,
    /// Deshabilitar motores (power off / safe mode).
    Disable,
}

impl RobotCommand {
    /// Serializar el comando a un formato de texto para transmisión serie.
    ///
    /// Formato: `CMD <tipo> <args>` (similar a protocolos industriales tipo G-Code).
    pub fn to_wire_format(&self) -> String {
        match self {
            RobotCommand::MoveJ { joints, velocity } => {
                let joints_str = joints
                    .iter()
                    .map(|j| format!("{:.6}", j))
                    .collect::<Vec<_>>()
                    .join(" ");
                match velocity {
                    Some(v) => format!("CMD MOVEJ {} V{:.3}", joints_str, v),
                    None => format!("CMD MOVEJ {}", joints_str),
                }
            }
            RobotCommand::Stop => "CMD STOP".to_string(),
            RobotCommand::Pause => "CMD PAUSE".to_string(),
            RobotCommand::Resume => "CMD RESUME".to_string(),
            RobotCommand::Enable => "CMD ENABLE".to_string(),
            RobotCommand::Disable => "CMD DISABLE".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movej_wire_format() {
        let cmd = RobotCommand::MoveJ {
            joints: vec![0.5, -0.3, 0.1],
            velocity: Some(0.8),
        };
        let wire = cmd.to_wire_format();
        assert!(wire.starts_with("CMD MOVEJ"));
        assert!(wire.contains("V0.800"));
    }

    #[test]
    fn stop_wire_format() {
        assert_eq!(RobotCommand::Stop.to_wire_format(), "CMD STOP");
    }

    #[test]
    fn enable_wire_format() {
        assert_eq!(RobotCommand::Enable.to_wire_format(), "CMD ENABLE");
    }
}
