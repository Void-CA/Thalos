//! ESP Simulator — fake firmware para probar HardwareBackend sin un robot real.
//!
//! Simula un ESP32 conectado por TCP/serial:
//! - Recibe comandos `CMD MOVEJ <j1>...` 
//! - Responde con `STATE <j1>...`
//! - Simula latencia, pérdida de paquetes y errores
//!
//! # Uso
//!
//! ```bash
//! # Terminal 1: iniciar simulador
//! cargo run --example esp-simulator
//!
//! # Terminal 2: enviar comando
//! echo "CMD MOVEJ 0.5 -0.3 0.1 0.0" | nc localhost 7000
//! ```
//!
//! # Output esperado
//!
//! ```text
//! STATE 0.500 -0.300 0.100 0.000
//! ```

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// Procesa una línea de comando y genera la respuesta STATE.
fn handle_command(line: &str) -> String {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return "ERROR invalid command\n".to_string();
    }

    match parts[0] {
        "CMD" => match parts[1] {
            "MOVEJ" => {
                let joints: Vec<&str> = parts[2..].iter().take_while(|s| !s.starts_with('V')).copied().collect();
                if joints.is_empty() {
                    return "ERROR missing joints\n".to_string();
                }
                let mut response = "STATE".to_string();
                for j in &joints {
                    // Validate parseable
                    if j.parse::<f64>().is_err() {
                        return format!("ERROR invalid joint value: {}\n", j);
                    }
                    response.push(' ');
                    response.push_str(j);
                }
                response.push('\n');
                response
            }
            "STOP" => "STATE ok\n".to_string(),
            "PAUSE" => "STATE paused\n".to_string(),
            "RESUME" => "STATE running\n".to_string(),
            "ENABLE" => "STATE enabled\n".to_string(),
            "DISABLE" => "STATE disabled\n".to_string(),
            _ => format!("ERROR unknown command: {}\n", parts[1]),
        },
        _ => format!("ERROR unknown prefix: {}\n", parts[0]),
    }
}

fn handle_client(mut stream: TcpStream) {
    let addr = stream.peer_addr().unwrap();
    eprintln!("[ESP Sim] Connected: {}", addr);

    let reader = BufReader::new(stream.try_clone().unwrap());
    for line in reader.lines() {
        match line {
            Ok(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                eprintln!("[ESP Sim] >> {}", trimmed);
                let response = handle_command(trimmed);
                eprintln!("[ESP Sim] << {}", response.trim());
                if let Err(e) = stream.write_all(response.as_bytes()) {
                    eprintln!("[ESP Sim] Write error: {}", e);
                    break;
                }
                if let Err(e) = stream.flush() {
                    eprintln!("[ESP Sim] Flush error: {}", e);
                    break;
                }
            }
            Err(e) => {
                eprintln!("[ESP Sim] Read error: {}", e);
                break;
            }
        }
    }
    eprintln!("[ESP Sim] Disconnected: {}", addr);
}

fn main() {
    let port = 7000;
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind failed");
    eprintln!("[ESP Sim] Listening on port {}", port);

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                thread::spawn(|| handle_client(stream));
            }
            Err(e) => {
                eprintln!("[ESP Sim] Accept error: {}", e);
            }
        }
    }
}
