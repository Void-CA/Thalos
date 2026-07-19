//! Transport abstraction — comunicación con hardware real.
//!
//! Separa el protocolo de aplicación (RobotCommand → wire format) del
//! medio físico (serial, TCP, MQTT, etc.).
//!
//! # Ejemplo
//!
//! ```ignore
//! let transport = SerialTransport::new("/dev/ttyUSB0", 115200)?;
//! transport.send(b"CMD MOVEJ 0.5 -0.3 0.1\n")?;
//! let response = transport.receive()?;
//! ```

use async_trait::async_trait;

/// Error de transporte.

/// Error de transporte.
#[derive(Debug)]
pub enum TransportError {
    Io(std::io::Error),
    Timeout,
    Disconnected,
    InvalidResponse(String),
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransportError::Io(e) => write!(f, "IO error: {}", e),
            TransportError::Timeout => write!(f, "Transport timeout"),
            TransportError::Disconnected => write!(f, "Transport disconnected"),
            TransportError::InvalidResponse(s) => write!(f, "Invalid response: {}", s),
        }
    }
}

impl From<std::io::Error> for TransportError {
    fn from(e: std::io::Error) -> Self {
        TransportError::Io(e)
    }
}

/// Medio de transporte entre Thalos y un backend físico.
///
/// No conoce el formato de los mensajes — solo envía y recibe bytes.
#[async_trait]
pub trait Transport: Send + Sync {
    /// Conectar al dispositivo.
    async fn connect(&mut self) -> Result<(), TransportError>;

    /// Desconectar.
    async fn disconnect(&mut self) -> Result<(), TransportError>;

    /// Enviar datos. Bloquea hasta que se envíen todos los bytes.
    async fn send(&mut self, data: &[u8]) -> Result<(), TransportError>;

    /// Recibir datos. Bloquea hasta recibir al menos 1 byte.
    async fn receive(&mut self) -> Result<Vec<u8>, TransportError>;
}

/// Transporte TCP — conecta a un ESP32 (o simulador) por socket.
pub struct TcpTransport {
    addr: String,
    stream: Option<tokio::sync::Mutex<tokio::net::TcpStream>>,
}

impl TcpTransport {
    pub fn new(addr: impl Into<String>) -> Self {
        Self {
            addr: addr.into(),
            stream: None,
        }
    }
}

#[async_trait]
impl Transport for TcpTransport {
    async fn connect(&mut self) -> Result<(), TransportError> {
        let stream = tokio::net::TcpStream::connect(&self.addr).await?;
        self.stream = Some(tokio::sync::Mutex::new(stream));
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), TransportError> {
        self.stream = None;
        Ok(())
    }

    async fn send(&mut self, data: &[u8]) -> Result<(), TransportError> {
        use tokio::io::AsyncWriteExt;
        let stream = self.stream.as_ref().ok_or(TransportError::Disconnected)?;
        let mut guard = stream.lock().await;
        guard.write_all(data).await?;
        guard.flush().await?;
        Ok(())
    }

    async fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
        use tokio::io::AsyncBufReadExt;
        let stream = self.stream.as_ref().ok_or(TransportError::Disconnected)?;
        let mut guard = stream.lock().await;
        let mut reader = tokio::io::BufReader::new(&mut *guard);
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        if line.is_empty() {
            return Err(TransportError::Disconnected);
        }
        Ok(line.into_bytes())
    }
}

/// Transporte simulado — para tests sin hardware real.
pub struct FakeTransport {
    sent: std::sync::Mutex<Vec<Vec<u8>>>,
    responses: std::sync::Mutex<Vec<Vec<u8>>>,
    connected: std::sync::atomic::AtomicBool,
}

impl FakeTransport {
    pub fn new() -> Self {
        Self {
            sent: std::sync::Mutex::new(Vec::new()),
            responses: std::sync::Mutex::new(Vec::new()),
            connected: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Inyectar una respuesta que se devolverá en el próximo `receive()`.
    pub fn inject_response(&self, data: Vec<u8>) {
        self.responses.lock().unwrap().push(data);
    }

    /// Comandos enviados hasta ahora.
    pub fn sent_commands(&self) -> Vec<Vec<u8>> {
        self.sent.lock().unwrap().clone()
    }

    /// Limpiar el historial de comandos.
    pub fn clear_sent(&self) {
        self.sent.lock().unwrap().clear();
    }
}

#[async_trait]
impl Transport for FakeTransport {
    async fn connect(&mut self) -> Result<(), TransportError> {
        self.connected.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), TransportError> {
        self.connected.store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    async fn send(&mut self, data: &[u8]) -> Result<(), TransportError> {
        self.sent.lock().unwrap().push(data.to_vec());
        Ok(())
    }

    async fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
        let mut responses = self.responses.lock().unwrap();
        if responses.is_empty() {
            return Err(TransportError::Timeout);
        }
        Ok(responses.remove(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fake_transport_roundtrip() {
        let mut transport = FakeTransport::new();
        transport.inject_response(b"STATE 1.0 2.0\n".to_vec());
        transport.connect().await.unwrap();
        transport.send(b"CMD MOVEJ 1.0 2.0\n").await.unwrap();
        let resp = transport.receive().await.unwrap();
        assert_eq!(String::from_utf8(resp).unwrap(), "STATE 1.0 2.0\n");
    }
}
