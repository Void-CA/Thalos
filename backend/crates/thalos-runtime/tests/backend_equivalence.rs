//! Backend equivalence tests.
//!
//! Verifica que `SimulationController` y `HardwareBackend` producen
//! `RobotState` equivalente cuando reciben el mismo `RobotCommand`.
//!
//! Este es el contrato fundamental de `ExecutionBackend`: los backends
//! son intercambiables desde la perspectiva del llamante.
//!
//! # Arquitectura del test
//!
//! 1. Se ejecuta un comando en `SimulationController` para obtener el
//!    estado de referencia.
//! 2. Se inyecta ese estado como telemetría `STATE` en `FakeTransport`.
//! 3. Se ejecuta el mismo comando en `HardwareBackend`.
//! 4. Se comparan los `RobotState` resultantes.
//!
//! De esta forma, el output de simulación se convierte en el input de
//! telemetría del backend hardware, cerrando el círculo.

use thalos_runtime::backends::controller::simulation::SimulationController;
use thalos_runtime::backends::execution::ExecutionBackend;
use thalos_runtime::backends::hardware::HardwareBackend;
use thalos_runtime::backends::transport::{FakeTransport, Transport};
use thalos_runtime::robot_command::RobotCommand;

// ---------------------------------------------------------------------------
// MoveJ — el comando principal
// ---------------------------------------------------------------------------

#[tokio::test]
async fn movej_matching_joint_positions() {
    let mut sim = SimulationController::new(4);
    let target = vec![0.5, -0.3, 0.1, 0.0];

    sim.connect().await.expect("sim connect");
    sim.send_command(RobotCommand::MoveJ {
        joints: target.clone(),
        velocity: None,
    })
    .await
    .expect("sim send_command");

    let sim_state = sim.read_state().await;

    // El sim debe tener las posiciones target inmediatamente después de
    // send_command (el advance ocurre en ticks separados).
    assert_eq!(sim_state.joints.positions, target);

    // Construir una línea STATE con el mismo formato que produce
    // HardwareBackend al parsear una respuesta del ESP32.
    let telemetry = format!(
        "STATE {}\n",
        sim_state
            .joints
            .positions
            .iter()
            .map(|j| format!("{:.6}", j))
            .collect::<Vec<_>>()
            .join(" ")
    );

    let fake = FakeTransport::new();
    fake.inject_response(telemetry.into_bytes());
    let transport: Box<dyn Transport> = Box::new(fake);
    let mut hw = HardwareBackend::new(transport);

    hw.connect().await.expect("hw connect");
    hw.send_command(RobotCommand::MoveJ {
        joints: target,
        velocity: None,
    })
    .await
    .expect("hw send_command");

    let hw_state = hw.read_state().await;

    assert_eq!(
        sim_state.joints.positions, hw_state.joints.positions,
        "SimulationController y HardwareBackend deben reportar \
         las mismas posiciones articulares para el mismo MoveJ"
    );
}

#[tokio::test]
async fn movej_with_velocity_matching_positions() {
    let mut sim = SimulationController::new(3);
    let target = vec![1.0, -0.5, 0.8];

    sim.connect().await.expect("sim connect");
    sim.send_command(RobotCommand::MoveJ {
        joints: target.clone(),
        velocity: Some(0.5),
    })
    .await
    .expect("sim send_command");

    let sim_state = sim.read_state().await;
    assert_eq!(sim_state.joints.positions, target);

    let telemetry = format!(
        "STATE {}",
        target.iter().map(|j| format!("{:.6}", j)).collect::<Vec<_>>().join(" ")
    );

    let fake = FakeTransport::new();
    fake.inject_response(telemetry.into_bytes());
    let transport: Box<dyn Transport> = Box::new(fake);
    let mut hw = HardwareBackend::new(transport);

    hw.connect().await.expect("hw connect");
    hw.send_command(RobotCommand::MoveJ {
        joints: target,
        velocity: Some(0.5),
    })
    .await
    .expect("hw send_command");

    let hw_state = hw.read_state().await;

    assert_eq!(
        sim_state.joints.positions, hw_state.joints.positions,
        "La velocidad no debe afectar las posiciones resultantes"
    );
}

// ---------------------------------------------------------------------------
// Ciclo de vida de conexión
// ---------------------------------------------------------------------------

#[tokio::test]
async fn connect_disconnect_lifecycle() {
    let mut sim = SimulationController::new(3);
    let fake = FakeTransport::new();
    let transport: Box<dyn Transport> = Box::new(fake);
    let mut hw = HardwareBackend::new(transport);

    // Ambos arrancan desconectados
    assert!(!sim.is_connected());
    assert!(!hw.is_connected());

    // Conectar
    sim.connect().await.expect("sim connect");
    hw.connect().await.expect("hw connect");
    assert!(sim.is_connected());
    assert!(hw.is_connected());

    // Desconectar
    sim.disconnect().await.expect("sim disconnect");
    hw.disconnect().await.expect("hw disconnect");
    assert!(!sim.is_connected());
    assert!(!hw.is_connected());
}

// ---------------------------------------------------------------------------
// Múltiples comandos en secuencia
// ---------------------------------------------------------------------------

#[tokio::test]
async fn multiple_commands_preserve_equivalence() {
    let mut sim = SimulationController::new(2);
    let fake = FakeTransport::new();
    let transport: Box<dyn Transport> = Box::new(fake);
    let mut hw = HardwareBackend::new(transport);

    sim.connect().await.expect("sim connect");
    hw.connect().await.expect("hw connect");

    let poses = vec![
        vec![0.0, 0.0],
        vec![0.5, 0.3],
        vec![-0.2, 0.8],
        vec![0.0, 0.0],
    ];

    for target in poses {
        // Inyectar telemetría para HW
        let telemetry = format!(
            "STATE {}",
            target.iter().map(|j| format!("{:.6}", j)).collect::<Vec<_>>().join(" ")
        );

        // Necesitamos un FakeTransport nuevo por iteración porque
        // cada inject_response consume una respuesta.
        let fake = FakeTransport::new();
        fake.inject_response(telemetry.into_bytes());
        let new_transport: Box<dyn Transport> = Box::new(fake);
        hw = HardwareBackend::new(new_transport);
        hw.connect().await.expect("hw connect");

        sim.send_command(RobotCommand::MoveJ {
            joints: target.clone(),
            velocity: None,
        })
        .await
        .expect("sim send_command");

        hw.send_command(RobotCommand::MoveJ {
            joints: target.clone(),
            velocity: None,
        })
        .await
        .expect("hw send_command");

        let sim_state = sim.read_state().await;
        let hw_state = hw.read_state().await;

        assert_eq!(
            sim_state.joints.positions, hw_state.joints.positions,
            "Fallo en posición {:?}", target
        );
    }
}
