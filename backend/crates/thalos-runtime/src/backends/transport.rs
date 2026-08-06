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

impl std::error::Error for TransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            TransportError::Io(e) => Some(e),
            _ => None,
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
    /// Max time to wait for a response line, in milliseconds (S1.3).
    receive_timeout_ms: u64,
}

impl TcpTransport {
    pub fn new(addr: impl Into<String>) -> Self {
        Self::with_receive_timeout(addr, 500)
    }

    /// Create a TCP transport with an explicit receive timeout (ms).
    /// `receive()` returns `Error::Timeout` if no data arrives in time.
    pub fn with_receive_timeout(addr: impl Into<String>, receive_timeout_ms: u64) -> Self {
        Self {
            addr: addr.into(),
            stream: None,
            receive_timeout_ms,
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
        // S1.3: bound the read — a silent peer must surface `Timeout` instead
        // of blocking the request forever (mirrors SerialTransport R4-002).
        match tokio::time::timeout(
            std::time::Duration::from_millis(self.receive_timeout_ms),
            reader.read_line(&mut line),
        )
        .await
        {
            Err(_) => return Err(TransportError::Timeout),
            Ok(Err(e)) => return Err(TransportError::Io(e)),
            Ok(Ok(0)) => return Err(TransportError::Disconnected),
            Ok(Ok(_)) => {}
        }
        if line.is_empty() {
            return Err(TransportError::Disconnected);
        }
        Ok(line.into_bytes())
    }
}

/// Transporte serial — conexión USB/UART a un ESP32 (o cualquier MCU).
///
/// Lee línea por línea usando un `BufReader` interno. La velocidad y
/// configuración del puerto se definen en `new()`.
///
/// # Timeout de lectura (R4-002)
///
/// `receive()` espera una línea hasta `read_timeout`; si el dispositivo no
/// responde (TTY silencioso) devuelve `TransportError::Timeout` en vez de
/// bloquear para siempre. Sin esto, un `POST /backends/esp32/connect` contra
/// un puerto sin firmware cuelga la request y deja el dispositivo abierto
/// (el retry choca con `port_in_use` hasta reiniciar el proceso).
pub struct SerialTransport {
    port: String,
    baud: u32,
    stream: Option<tokio::sync::Mutex<tokio_serial::SerialStream>>,
    /// Max wait for a response line in `receive`. Defaults to 2s — short
    /// enough to beat the frontend 10s timeout and return `no_firmware` fast,
    /// long enough for a real device to answer the HELLO handshake.
    read_timeout: std::time::Duration,
}

impl SerialTransport {
    /// Crear un nuevo transporte serial.
    ///
    /// `port` es el path al dispositivo (ej: `"/dev/ttyUSB0"`).
    /// `baud` es la velocidad en baudios (ej: `115200`).
    pub fn new(port: impl Into<String>, baud: u32) -> Self {
        Self {
            port: port.into(),
            baud,
            stream: None,
            read_timeout: std::time::Duration::from_secs(2),
        }
    }

    /// Override the receive read timeout (R4-002). Tests use a short value so
    /// the silent-device path is exercised fast; production keeps the 2s default.
    pub fn with_read_timeout(mut self, timeout: std::time::Duration) -> Self {
        self.read_timeout = timeout;
        self
    }
}

#[cfg(test)]
impl SerialTransport {
    /// Build a transport over an already-open stream (test seam): the virtual
    /// serial pair from `SerialStream::pair()` exercises the REAL read path
    /// without a physical device.
    pub fn from_stream(stream: tokio_serial::SerialStream, read_timeout: std::time::Duration) -> Self {
        Self {
            port: String::new(),
            baud: 0,
            stream: Some(tokio::sync::Mutex::new(stream)),
            read_timeout,
        }
    }
}

#[async_trait]
impl Transport for SerialTransport {
    async fn connect(&mut self) -> Result<(), TransportError> {
        // Idempotent: a stream already injected (test seam) stays open.
        if self.stream.is_some() {
            return Ok(());
        }
        let builder = tokio_serial::new(&self.port, self.baud);
        let port = tokio_serial::SerialStream::open(&builder)
            .map_err(|e| TransportError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
        self.stream = Some(tokio::sync::Mutex::new(port));
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
        // R4-002: bound the read — a silent device must surface `Timeout`
        // (→ `no_firmware`) instead of blocking the request forever.
        match tokio::time::timeout(self.read_timeout, reader.read_line(&mut line)).await {
            Err(_) => return Err(TransportError::Timeout),
            Ok(Err(e)) => return Err(TransportError::Io(e)),
            Ok(Ok(0)) => return Err(TransportError::Disconnected),
            Ok(Ok(_)) => {}
        }
        // Strip trailing \r\n or \n (ESP firmware envía \r\n)
        let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');
        let mut bytes = trimmed.to_string().into_bytes();
        bytes.push(b'\n'); // restore single \n for protocol parser
        Ok(bytes)
    }
}

/// Transporte simulado — para tests sin hardware real.
pub struct FakeTransport {
    sent: std::sync::Mutex<Vec<Vec<u8>>>,
    responses: std::sync::Mutex<Vec<Vec<u8>>>,
    connected: std::sync::atomic::AtomicBool,
    /// When set, the next `receive` that finds an empty response queue reports
    /// the transport disconnected (R4-001 test seam: simulate a device that
    /// drops mid-operation AFTER answering the HELLO handshake).
    disconnect_on_empty: std::sync::atomic::AtomicBool,
}

impl FakeTransport {
    pub fn new() -> Self {
        Self {
            sent: std::sync::Mutex::new(Vec::new()),
            responses: std::sync::Mutex::new(Vec::new()),
            connected: std::sync::atomic::AtomicBool::new(false),
            disconnect_on_empty: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Arm the transport to report `TransportError::Disconnected` on the next
    /// `receive` that has no queued response — i.e. right after the injected
    /// HELLO response is consumed. Test seam for the ConnectionLost path.
    pub fn disconnect_on_empty_queue(&self) {
        self.disconnect_on_empty
            .store(true, std::sync::atomic::Ordering::SeqCst);
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
        self.connected
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), TransportError> {
        self.connected
            .store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    async fn send(&mut self, data: &[u8]) -> Result<(), TransportError> {
        self.sent.lock().unwrap().push(data.to_vec());
        Ok(())
    }

    async fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
        let mut responses = self.responses.lock().unwrap();
        if responses.is_empty() {
            if self
                .disconnect_on_empty
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                return Err(TransportError::Disconnected);
            }
            return Err(TransportError::Timeout);
        }
        Ok(responses.remove(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn fake_transport_roundtrip() {
        let mut transport = FakeTransport::new();
        transport.inject_response(b"STATE 1.0 2.0\n".to_vec());
        transport.connect().await.unwrap();
        transport.send(b"CMD MOVEJ 1.0 2.0\n").await.unwrap();
        let resp = transport.receive().await.unwrap();
        assert_eq!(String::from_utf8(resp).unwrap(), "STATE 1.0 2.0\n");
    }

    /// R4-002: `SerialTransport::receive` on a SILENT device must time out
    /// instead of blocking forever — the no_firmware handshake depends on it
    /// (a silent TTY currently hangs the connect request indefinitely).
    #[tokio::test]
    async fn serial_receive_times_out_on_silent_port() {
        let (master, _slave) = tokio_serial::SerialStream::pair().unwrap();
        let mut transport =
            SerialTransport::from_stream(master, Duration::from_millis(150));
        let start = std::time::Instant::now();
        let err = transport.receive().await.unwrap_err();
        assert!(matches!(err, TransportError::Timeout), "got {err:?}");
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "receive must not hang forever"
        );
    }

    /// R4-002: a device that DOES answer must still read its line — the timeout
    /// must not break the healthy path.
    #[tokio::test]
    async fn serial_receive_reads_line_when_data_arrives() {
        let (master, slave) = tokio_serial::SerialStream::pair().unwrap();
        let mut transport =
            SerialTransport::from_stream(master, Duration::from_secs(2));
        // Write from the OTHER end of the virtual pair; the transport reads it.
        use tokio::io::AsyncWriteExt;
        let mut slave = slave;
        slave.write_all(b"HELLO 1 OK\r\n").await.unwrap();
        slave.flush().await.unwrap();
        let resp = transport.receive().await.unwrap();
        assert_eq!(String::from_utf8(resp).unwrap(), "HELLO 1 OK\n");
    }

    /// S1.3/S1.5 (RED): `TcpTransport::receive()` on a silent peer MUST return
    /// `Error::Timeout` after `receive_timeout_ms` instead of blocking forever.
    /// Uses a `with_receive_timeout` constructor that does not exist yet —
    /// guaranteed failure until the timeout is implemented.
    #[tokio::test]
    async fn tcp_receive_times_out_without_data() {
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // 100ms timeout so the test is fast; default is 500ms.
        let mut transport = TcpTransport::with_receive_timeout(addr.to_string(), 100);
        transport.connect().await.unwrap();

        // Do NOT accept/write on the listener: the peer stays silent.
        let start = std::time::Instant::now();
        let err = transport.receive().await.unwrap_err();
        assert!(matches!(err, TransportError::Timeout), "got {err:?}");
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "receive must not block forever"
        );
    }
}
