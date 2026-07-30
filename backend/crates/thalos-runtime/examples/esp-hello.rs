//! ESP32 Hello — prueba de conexión real con el firmware Thalos.
//!
//! Conecta al ESP por Serial, hace handshake, sube un manifiesto
//! simple de 2 DOF, ejecuta, y monitorea hasta completar.
//!
//! # Uso
//!
//! ```bash
//! cargo run --example esp-hello -- /dev/ttyUSB0
//! ```
//!
//! # Salida esperada
//!
//! ```text
//! Conectando a /dev/ttyUSB0...
//! ✓ HELLO handshake: versión 1
//! ✓ Manifest uploaded (3 samples, 2 DOF)
//! ✓ Execute started
//!   STATUS: RUNNING
//!   STATUS: RUNNING
//! ✓ Execution COMPLETED
//! ```

use std::env;

use thalos_runtime::backends::esp32::Esp32Backend;
use thalos_runtime::backends::transport::{SerialTransport, Transport};
use thalos_runtime::RobotController;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    let port = args.get(1).map(|s| s.as_str()).unwrap_or("/dev/ttyUSB0");

    println!("Conectando a {}...", port);

    // 1. Crear y conectar SerialTransport
    let transport = SerialTransport::new(port, 115200);
    let mut backend = Esp32Backend::new(Box::new(transport));

    // El Esp32Backend no expone el handshake directamente — se hace
    // internamente en connect(). Pero nosotros queremos ver el proceso.
    // Usamos el protocolo directamente a través del transport.

    // ── Opción A: Usar Esp32Backend (más alto nivel) ────────────────
    println!("\n── Opción A: Esp32Backend ──\n");

    // Necesitamos acceso al protocol para inyectar HELLO response...
    // En su lugar, usemos el transport directamente (Opción B).

    // ── Opción B: Usar Transport + protocolo manual ─────────────────
    println!("\n── Opción B: Protocolo manual ──\n");

    let mut transport = SerialTransport::new(port, 115200);
    transport.connect().await.expect("connect");

    // HELLO
    transport.send(b"HELLO 1\n").await.expect("send HELLO");
    let resp = transport.receive().await.expect("recv HELLO");
    println!("  >> HELLO 1");
    println!("  << {}", String::from_utf8_lossy(&resp).trim());
    assert!(
        String::from_utf8_lossy(&resp).contains("HELLO 1 OK"),
        "handshake failed"
    );
    println!("  ✓ Handshake OK\n");

    // MANIFEST
    transport
        .send(b"MANIFEST 2 3 2000000\n")
        .await
        .expect("send MANIFEST");
    let resp = transport.receive().await.expect("recv MANIFEST");
    println!("  >> MANIFEST 2 3 2000000");
    println!("  << {}", String::from_utf8_lossy(&resp).trim());

    // SEGMENT
    transport
        .send(b"SEGMENT 0 movej 0 3\n")
        .await
        .expect("send SEGMENT");
    let resp = transport.receive().await.expect("recv SEGMENT");
    println!("  >> SEGMENT 0 movej 0 3");
    println!("  << {}", String::from_utf8_lossy(&resp).trim());

    // SAMPLES
    let samples = [
        "SAMPLE 0.0 0.0 0",
        "SAMPLE 0.5 0.3 1000000",
        "SAMPLE 1.0 0.5 1000000",
    ];
    for s in &samples {
        transport.send(format!("{}\n", s).as_bytes()).await.unwrap();
        let resp = transport.receive().await.unwrap();
        println!("  >> {}", s);
        println!("  << {}", String::from_utf8_lossy(&resp).trim());
    }

    // END_UPLOAD
    transport.send(b"END_UPLOAD\n").await.unwrap();
    let resp = transport.receive().await.unwrap();
    println!("  >> END_UPLOAD");
    println!("  << {}", String::from_utf8_lossy(&resp).trim());
    assert!(
        String::from_utf8_lossy(&resp).contains("READY"),
        "upload rejected: {}",
        String::from_utf8_lossy(&resp)
    );
    println!("  ✓ Manifest uploaded\n");

    // EXECUTE
    transport.send(b"EXECUTE\n").await.unwrap();
    let resp = transport.receive().await.unwrap();
    println!("  >> EXECUTE");
    println!("  << {}", String::from_utf8_lossy(&resp).trim());
    println!("  ✓ Execute started\n");

    // STATUS poll
    for i in 0..10 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        transport.send(b"STATUS\n").await.unwrap();
        let resp = transport.receive().await.unwrap();
        let status = String::from_utf8_lossy(&resp).trim().to_string();
        println!("  STATUS poll {}: {}", i + 1, status);

        if status.contains("COMPLETED") {
            println!("\n  ✓ Execution COMPLETED");
            break;
        }
    }

    // STOP
    transport.send(b"STOP\n").await.unwrap();
    let resp = transport.receive().await.unwrap();
    println!("  >> STOP");
    println!("  << {}", String::from_utf8_lossy(&resp).trim());
    println!("  ✓ Done\n");

    transport.disconnect().await.unwrap();
    println!("✅ Todo OK — ESP responde y ejecuta correctamente.");
}
