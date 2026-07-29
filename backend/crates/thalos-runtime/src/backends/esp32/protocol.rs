//! ESP32 protocol codec — text wire format for ESP32 communication.
//!
//! Defines the text protocol shared between the Rust host and C++ firmware:
//!
//! ```text
//! HOST → ESP                ESP → HOST
//! ─────────────────────────────────────
//! HELLO <ver>               HELLO <ver> OK
//! MANIFEST <dof> <N> <dur>  OK
//! SEGMENT <i> <instr> ...
//! SAMPLE <j0> <j1> .. <dt>  OK
//! END_UPLOAD                READY | ERROR <reason>
//! EXECUTE                   OK | ERROR <reason>
//! STOP                      OK
//! STATUS                    STATUS RUNNING | COMPLETED | ERROR <reason>
//! SAMPLES <count>           OK
//! SAMPLE <ts> <j0> <j1> ..  (×count, implicit)
//! ```

use crate::backends::transport::{Transport, TransportError};
use crate::execution_boundary::manifest::{ExecutionManifest, ManifestInstruction};
use crate::execution_boundary::sample::ExecutionSample;

/// Errors from the ESP32 protocol layer.
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("transport error: {0}")]
    Transport(#[from] TransportError),

    #[error("protocol error: {0}")]
    Protocol(String),

    #[error("unexpected response: {0}")]
    UnexpectedResponse(String),

    #[error("malformed response: {0}")]
    MalformedResponse(String),

    #[error("version mismatch: expected {expected}, got {actual}")]
    VersionMismatch { expected: u32, actual: u32 },

    #[error("ESP error: {0}")]
    EspError(String),
}

/// Firmware-side execution state as tracked by the host protocol codec.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirmwareState {
    /// No manifest loaded, idle.
    Idle,
    /// Receiving manifest data (MANIFEST / SEGMENT / SAMPLE commands).
    Receiving,
    /// Manifest uploaded and validated, ready to execute.
    Ready,
    /// Execution in progress.
    Executing,
}

/// Internal parsed representation of an ESP32 response line.
#[derive(Debug, Clone, PartialEq)]
enum ParsedResponse {
    Ok,
    Ready,
    HandshakeOk(u32),
    Error(String),
    StatusRunning,
    StatusCompleted,
    Sample(ExecutionSample),
}

/// ESP32 protocol codec.
///
/// Wraps a [`Transport`] and provides protocol-level operations:
/// handshake, manifest upload, execute, status query, and sample
/// collection. Owns all text wire-format concerns.
pub struct Esp32Protocol {
    transport: Box<dyn Transport>,
    firmware_state: FirmwareState,
    firmware_version: u32,
    expected_version: u32,
}

impl Esp32Protocol {
    /// Create a new protocol codec over the given transport.
    ///
    /// `expected_version` is the protocol version the host expects the
    /// firmware to announce during the HELLO handshake.
    pub fn new(transport: Box<dyn Transport>, expected_version: u32) -> Self {
        Self {
            transport,
            firmware_state: FirmwareState::Idle,
            firmware_version: 0,
            expected_version,
        }
    }

    /// Format a protocol command line and append a newline.
    fn format_line(args: &[&str]) -> Vec<u8> {
        let mut line = args.join(" ");
        line.push('\n');
        line.into_bytes()
    }

    /// Format a SAMPLE line from joint positions and delta time.
    ///
    /// Output: `SAMPLE <j0> <j1> ... <dt_us>\n`
    fn format_sample_line(joints: &[f64], dt_us: u32) -> Vec<u8> {
        let mut parts = vec!["SAMPLE".to_string()];
        for j in joints {
            // Format with enough precision for round-trip parsing
            parts.push(format!("{:.6}", j));
        }
        parts.push(dt_us.to_string());
        let line = parts.join(" ") + "\n";
        line.into_bytes()
    }

    /// Parse a single response line from the ESP32 firmware.
    ///
    /// Returns a [`ParsedResponse`] representing the firmware's reply.
    fn parse_response(line: &str) -> Result<ParsedResponse, ProtocolError> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err(ProtocolError::MalformedResponse("empty line".into()));
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            return Err(ProtocolError::MalformedResponse("empty line".into()));
        }

        match parts[0] {
            "HELLO" => {
                if parts.len() >= 3 && parts[2] == "OK" {
                    let version: u32 = parts[1]
                        .parse()
                        .map_err(|_| ProtocolError::MalformedResponse(line.to_string()))?;
                    Ok(ParsedResponse::HandshakeOk(version))
                } else {
                    Err(ProtocolError::MalformedResponse(line.to_string()))
                }
            }
            "OK" => Ok(ParsedResponse::Ok),
            "READY" => Ok(ParsedResponse::Ready),
            "ERROR" => {
                let reason = if parts.len() > 1 {
                    parts[1..].join(" ")
                } else {
                    "unknown".into()
                };
                Ok(ParsedResponse::Error(reason))
            }
            "STATUS" => {
                if parts.len() < 2 {
                    return Err(ProtocolError::MalformedResponse(line.to_string()));
                }
                match parts[1] {
                    "RUNNING" => Ok(ParsedResponse::StatusRunning),
                    "COMPLETED" => Ok(ParsedResponse::StatusCompleted),
                    _ => Ok(ParsedResponse::Error(parts[1..].join(" "))),
                }
            }
            "SAMPLE" => {
                // SAMPLE <j0> <j1> ... <ts_us>
                if parts.len() < 3 {
                    return Err(ProtocolError::MalformedResponse(line.to_string()));
                }
                let n_joint_values = parts.len() - 2; // skip "SAMPLE" and timestamp
                let mut joints = Vec::with_capacity(n_joint_values);
                for s in &parts[1..parts.len() - 1] {
                    let val: f64 = s
                        .parse()
                        .map_err(|_| ProtocolError::MalformedResponse(line.to_string()))?;
                    joints.push(val);
                }
                let timestamp: u64 = parts[parts.len() - 1]
                    .parse()
                    .map_err(|_| ProtocolError::MalformedResponse(line.to_string()))?;
                Ok(ParsedResponse::Sample(ExecutionSample {
                    timestamp_us: timestamp,
                    joints,
                }))
            }
            _ => Err(ProtocolError::UnexpectedResponse(line.to_string())),
        }
    }

    /// Encode an [`ExecutionManifest`] into a list of text command lines
    /// ready to send over the transport.
    ///
    /// The returned vector contains the following lines, in order:
    /// 1. `MANIFEST <dof> <N> <dur_us>\n`
    /// 2. `SEGMENT <idx> <instr> <start> <count>\n` (one per segment)
    /// 3. `SAMPLE <j0> ... <dt_us>\n` (one per sample)
    /// 4. `END_UPLOAD\n`
    pub fn encode_manifest(manifest: &ExecutionManifest) -> Vec<Vec<u8>> {
        let mut lines = Vec::new();

        // MANIFEST <dof> <N> <dur_us>
        lines.push(Self::format_line(&[
            "MANIFEST",
            &manifest.metadata.dof_count.to_string(),
            &manifest.metadata.total_samples.to_string(),
            &manifest.metadata.duration_us.to_string(),
        ]));

        // SEGMENT <idx> <instruction> <start> <count>
        for seg in &manifest.segments {
            let instr = match seg.instruction {
                ManifestInstruction::MoveJ => "movej",
                ManifestInstruction::MoveL => "movel",
            };
            lines.push(Self::format_line(&[
                "SEGMENT",
                &seg.index.to_string(),
                instr,
                &seg.sample_start.to_string(),
                &seg.sample_count.to_string(),
            ]));
        }

        // SAMPLE <j0> <j1> ... <dt_us>
        for sample in &manifest.samples {
            lines.push(Self::format_sample_line(&sample.joints, sample.dt_us));
        }

        // END_UPLOAD
        lines.push(Self::format_line(&["END_UPLOAD"]));

        lines
    }

    /// Perform the HELLO version handshake.
    ///
    /// Sends `HELLO <expected_version>` and expects `HELLO <ver> OK`.
    /// Returns an error if the version does not match.
    pub async fn handshake(&mut self) -> Result<(), ProtocolError> {
        let cmd = Self::format_line(&["HELLO", &self.expected_version.to_string()]);
        self.transport.send(&cmd).await?;

        let response = self.transport.receive().await?;
        let line = String::from_utf8(response)
            .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;

        match Self::parse_response(&line)? {
            ParsedResponse::HandshakeOk(version) => {
                if version != self.expected_version {
                    return Err(ProtocolError::VersionMismatch {
                        expected: self.expected_version,
                        actual: version,
                    });
                }
                self.firmware_version = version;
                self.firmware_state = FirmwareState::Idle;
                Ok(())
            }
            other => Err(ProtocolError::UnexpectedResponse(format!("{other:?}"))),
        }
    }

    /// Upload a manifest to the ESP32.
    ///
    /// Sends the encoded manifest lines and waits for responses after
    /// MANIFEST, SEGMENT, and SAMPLE lines (expecting `OK`). After
    /// `END_UPLOAD`, waits for `READY` or `ERROR <reason>`.
    pub async fn upload_manifest(
        &mut self,
        manifest: &ExecutionManifest,
    ) -> Result<(), ProtocolError> {
        self.firmware_state = FirmwareState::Receiving;

        let lines = Self::encode_manifest(manifest);
        // The last line is END_UPLOAD — handled separately
        let upload_lines = &lines[..lines.len() - 1];

        for cmd in upload_lines {
            self.transport.send(cmd).await?;
            // Expect OK after MANIFEST, SEGMENT, SAMPLE
            let response = self.transport.receive().await?;
            let line = String::from_utf8(response)
                .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;
            match Self::parse_response(&line)? {
                ParsedResponse::Ok => {}
                other => {
                    return Err(ProtocolError::UnexpectedResponse(format!("{other:?}")));
                }
            }
        }

        // Send END_UPLOAD — expect READY or ERROR
        let end = &lines[lines.len() - 1];
        self.transport.send(end).await?;
        let response = self.transport.receive().await?;
        let line = String::from_utf8(response)
            .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;
        match Self::parse_response(&line)? {
            ParsedResponse::Ready => {
                self.firmware_state = FirmwareState::Ready;
                Ok(())
            }
            ParsedResponse::Error(reason) => Err(ProtocolError::EspError(reason)),
            other => Err(ProtocolError::UnexpectedResponse(format!("{other:?}"))),
        }
    }

    /// Start execution on the ESP32.
    ///
    /// Sends `EXECUTE` and expects `OK` or `ERROR <reason>`.
    pub async fn start_execution(&mut self) -> Result<(), ProtocolError> {
        self.transport
            .send(&Self::format_line(&["EXECUTE"]))
            .await?;
        let response = self.transport.receive().await?;
        let line = String::from_utf8(response)
            .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;
        match Self::parse_response(&line)? {
            ParsedResponse::Ok => {
                self.firmware_state = FirmwareState::Executing;
                Ok(())
            }
            ParsedResponse::Error(reason) => Err(ProtocolError::EspError(reason)),
            other => Err(ProtocolError::UnexpectedResponse(format!("{other:?}"))),
        }
    }

    /// Query the current execution status.
    ///
    /// Sends `STATUS` and parses the response. Returns `"RUNNING"`,
    /// `"COMPLETED"`, or an error.
    pub async fn query_status(&mut self) -> Result<String, ProtocolError> {
        self.transport.send(&Self::format_line(&["STATUS"])).await?;
        let response = self.transport.receive().await?;
        let line = String::from_utf8(response)
            .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;
        match Self::parse_response(&line)? {
            ParsedResponse::StatusRunning => Ok("RUNNING".into()),
            ParsedResponse::StatusCompleted => {
                self.firmware_state = FirmwareState::Idle;
                Ok("COMPLETED".into())
            }
            ParsedResponse::Error(reason) => Err(ProtocolError::EspError(reason)),
            other => Err(ProtocolError::UnexpectedResponse(format!("{other:?}"))),
        }
    }

    /// Collect execution samples from the ESP32.
    ///
    /// Sends `SAMPLES <count>`, expects `OK`, then reads exactly
    /// `count` `SAMPLE` response lines.
    pub async fn collect_samples(
        &mut self,
        count: usize,
    ) -> Result<Vec<ExecutionSample>, ProtocolError> {
        self.transport
            .send(&Self::format_line(&["SAMPLES", &count.to_string()]))
            .await?;
        let response = self.transport.receive().await?;
        let line = String::from_utf8(response)
            .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;
        match Self::parse_response(&line)? {
            ParsedResponse::Ok => {}
            other => return Err(ProtocolError::UnexpectedResponse(format!("{other:?}"))),
        }

        let mut samples = Vec::with_capacity(count);
        for _ in 0..count {
            let resp = self.transport.receive().await?;
            let line = String::from_utf8(resp)
                .map_err(|e| ProtocolError::MalformedResponse(format!("invalid UTF-8: {e}")))?;
            match Self::parse_response(&line)? {
                ParsedResponse::Sample(sample) => samples.push(sample),
                other => return Err(ProtocolError::UnexpectedResponse(format!("{other:?}"))),
            }
        }
        Ok(samples)
    }

    /// Send a STOP command to the ESP32.
    pub async fn stop(&mut self) -> Result<(), ProtocolError> {
        self.transport.send(&Self::format_line(&["STOP"])).await?;
        self.firmware_state = FirmwareState::Idle;
        Ok(())
    }

    /// The current firmware state as tracked by the host.
    pub fn firmware_state(&self) -> FirmwareState {
        self.firmware_state
    }

    /// The firmware protocol version, if the handshake completed.
    pub fn firmware_version(&self) -> u32 {
        self.firmware_version
    }

    /// Whether the protocol has completed a handshake.
    pub fn is_connected(&self) -> bool {
        self.firmware_version > 0
    }
}

// ═════════════════════════════════════════════════════════════════════
// Test helpers — always compiled so integration tests can use them.
// Assumes the inner transport IS a `FakeTransport`.
// ═════════════════════════════════════════════════════════════════════

impl Esp32Protocol {
    /// Access the FakeTransport's sent commands for test assertions.
    ///
    /// # Safety
    ///
    /// This assumes the inner transport IS a `FakeTransport`. Only call
    /// from tests where you created one.
    pub fn test_sent_commands(&self) -> Vec<Vec<u8>> {
        unsafe {
            let transport_ref: &dyn Transport = &*self.transport;
            let fake_ptr: *const crate::backends::transport::FakeTransport = transport_ref
                as *const dyn Transport
                as *const crate::backends::transport::FakeTransport;
            (*fake_ptr).sent_commands()
        }
    }

    /// Inject a response into the FakeTransport for scripted testing.
    ///
    /// # Safety
    ///
    /// This assumes the inner transport IS a `FakeTransport`.
    pub fn test_inject_response(&self, data: Vec<u8>) {
        unsafe {
            let transport_ref: &dyn Transport = &*self.transport;
            let fake_ptr: *const crate::backends::transport::FakeTransport = transport_ref
                as *const dyn Transport
                as *const crate::backends::transport::FakeTransport;
            // FakeTransport methods take &self (interior mutability)
            // so we need &mut. But we have *const. Use cast to *mut.
            let fake_mut = fake_ptr as *mut crate::backends::transport::FakeTransport;
            (*fake_mut).inject_response(data);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::transport::FakeTransport;
    use crate::execution_boundary::manifest::{
        ExecutionManifest, ManifestInstruction, ManifestMetadata, ManifestSegment, TimedWaypoint,
    };

    // ── Helpers ────────────────────────────────────────────────────────

    fn sample_manifest() -> ExecutionManifest {
        ExecutionManifest {
            metadata: ManifestMetadata {
                dof_count: 2,
                total_samples: 3,
                duration_us: 1_000_000,
            },
            segments: vec![ManifestSegment {
                index: 0,
                instruction: ManifestInstruction::MoveJ,
                sample_start: 0,
                sample_count: 3,
            }],
            samples: vec![
                TimedWaypoint {
                    joints: vec![0.0, 0.0],
                    dt_us: 0,
                },
                TimedWaypoint {
                    joints: vec![0.5, 0.3],
                    dt_us: 500_000,
                },
                TimedWaypoint {
                    joints: vec![1.0, 0.5],
                    dt_us: 500_000,
                },
            ],
        }
    }

    fn multi_segment_manifest() -> ExecutionManifest {
        ExecutionManifest {
            metadata: ManifestMetadata {
                dof_count: 3,
                total_samples: 5,
                duration_us: 2_000_000,
            },
            segments: vec![
                ManifestSegment {
                    index: 0,
                    instruction: ManifestInstruction::MoveJ,
                    sample_start: 0,
                    sample_count: 2,
                },
                ManifestSegment {
                    index: 1,
                    instruction: ManifestInstruction::MoveL,
                    sample_start: 2,
                    sample_count: 3,
                },
            ],
            samples: vec![
                TimedWaypoint {
                    joints: vec![0.0, 0.0, 0.0],
                    dt_us: 0,
                },
                TimedWaypoint {
                    joints: vec![0.2, 0.1, 0.0],
                    dt_us: 500_000,
                },
                TimedWaypoint {
                    joints: vec![0.2, 0.1, 0.0],
                    dt_us: 0,
                },
                TimedWaypoint {
                    joints: vec![0.5, 0.4, 0.3],
                    dt_us: 500_000,
                },
                TimedWaypoint {
                    joints: vec![0.8, 0.6, 0.5],
                    dt_us: 1_000_000,
                },
            ],
        }
    }

    // ── Task 2.1: RED — encode manifest to text lines ────────────────

    #[test]
    fn encode_single_segment_manifest() {
        let manifest = sample_manifest();
        let lines = Esp32Protocol::encode_manifest(&manifest);

        // MANIFEST + 1 SEGMENT + 3 SAMPLES + END_UPLOAD = 6 lines
        assert_eq!(lines.len(), 6);

        // MANIFEST <dof> <N> <dur_us>
        assert_eq!(
            String::from_utf8(lines[0].clone()).unwrap(),
            "MANIFEST 2 3 1000000\n"
        );

        // SEGMENT 0 movej 0 3
        assert_eq!(
            String::from_utf8(lines[1].clone()).unwrap(),
            "SEGMENT 0 movej 0 3\n"
        );

        // SAMPLE lines
        assert!(
            String::from_utf8(lines[2].clone())
                .unwrap()
                .starts_with("SAMPLE")
        );
        assert!(
            String::from_utf8(lines[3].clone())
                .unwrap()
                .starts_with("SAMPLE")
        );
        assert!(
            String::from_utf8(lines[4].clone())
                .unwrap()
                .starts_with("SAMPLE")
        );

        // END_UPLOAD
        assert_eq!(String::from_utf8(lines[5].clone()).unwrap(), "END_UPLOAD\n");
    }

    #[test]
    fn encode_multi_segment_manifest() {
        let manifest = multi_segment_manifest();
        let lines = Esp32Protocol::encode_manifest(&manifest);

        // MANIFEST + 2 SEGMENTS + 5 SAMPLES + END_UPLOAD = 9 lines
        assert_eq!(lines.len(), 9);

        assert_eq!(
            String::from_utf8(lines[0].clone()).unwrap(),
            "MANIFEST 3 5 2000000\n"
        );

        assert_eq!(
            String::from_utf8(lines[1].clone()).unwrap(),
            "SEGMENT 0 movej 0 2\n"
        );
        assert_eq!(
            String::from_utf8(lines[2].clone()).unwrap(),
            "SEGMENT 1 movel 2 3\n"
        );

        // Last line is END_UPLOAD
        assert_eq!(String::from_utf8(lines[8].clone()).unwrap(), "END_UPLOAD\n");
    }

    #[test]
    fn encode_sample_lines_include_joints_and_dt() {
        let manifest = sample_manifest();
        let lines = Esp32Protocol::encode_manifest(&manifest);

        // Sample 0: joints=[0.0, 0.0], dt_us=0
        let sample0 = String::from_utf8(lines[2].clone()).unwrap();
        assert!(sample0.starts_with("SAMPLE "));
        assert!(sample0.ends_with("0\n")); // dt_us=0 at end

        // Sample 1: joints=[0.5, 0.3], dt_us=500000
        let sample1 = String::from_utf8(lines[3].clone()).unwrap();
        assert!(sample1.starts_with("SAMPLE "));
        assert!(sample1.ends_with("500000\n"));
    }

    #[test]
    fn encode_empty_manifest_still_produces_manifest_line() {
        let manifest = ExecutionManifest {
            metadata: ManifestMetadata {
                dof_count: 0,
                total_samples: 0,
                duration_us: 0,
            },
            segments: vec![],
            samples: vec![],
        };
        let lines = Esp32Protocol::encode_manifest(&manifest);

        // MANIFEST line + END_UPLOAD (no SEGMENT or SAMPLE lines)
        assert_eq!(lines.len(), 2);
        assert_eq!(
            String::from_utf8(lines[0].clone()).unwrap(),
            "MANIFEST 0 0 0\n"
        );
        assert_eq!(String::from_utf8(lines[1].clone()).unwrap(), "END_UPLOAD\n");
    }

    // ── Task 2.3: RED — decode SAMPLE lines → ExecutionSample ────────

    #[test]
    fn parse_sample_line_with_two_joints() {
        let line = "SAMPLE 0.0 0.5 1000\n";
        let parsed = Esp32Protocol::parse_response(line).unwrap();

        match parsed {
            ParsedResponse::Sample(sample) => {
                assert_eq!(sample.timestamp_us, 1000);
                assert_eq!(sample.joints.len(), 2);
                assert!((sample.joints[0] - 0.0).abs() < 1e-9);
                assert!((sample.joints[1] - 0.5).abs() < 1e-9);
            }
            other => panic!("Expected Sample, got {other:?}"),
        }
    }

    #[test]
    fn parse_sample_line_with_six_joints() {
        let line = "SAMPLE 0.1 0.2 0.3 0.4 0.5 0.6 5000000\n";
        let parsed = Esp32Protocol::parse_response(line).unwrap();

        match parsed {
            ParsedResponse::Sample(sample) => {
                assert_eq!(sample.timestamp_us, 5_000_000);
                assert_eq!(sample.joints.len(), 6);
                assert!((sample.joints[0] - 0.1).abs() < 1e-9);
                assert!((sample.joints[5] - 0.6).abs() < 1e-9);
            }
            other => panic!("Expected Sample, got {other:?}"),
        }
    }

    #[test]
    fn parse_sample_line_zero_timestamp() {
        let line = "SAMPLE 1.0 2.0 0\n";
        let parsed = Esp32Protocol::parse_response(line).unwrap();

        match parsed {
            ParsedResponse::Sample(sample) => {
                assert_eq!(sample.timestamp_us, 0);
                assert_eq!(sample.joints, vec![1.0, 2.0]);
            }
            other => panic!("Expected Sample, got {other:?}"),
        }
    }

    #[test]
    fn parse_sample_line_malformed_rejected() {
        let line = "SAMPLE abc 1000\n";
        let result = Esp32Protocol::parse_response(line);
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::MalformedResponse(_) => {} // expected
            other => panic!("Expected MalformedResponse, got {other}"),
        }
    }

    #[test]
    fn parse_sample_line_too_short_rejected() {
        let line = "SAMPLE\n";
        let result = Esp32Protocol::parse_response(line);
        assert!(result.is_err());
    }

    // ── Task 2.7: RED — version mismatch handshake rejected ──────────

    #[tokio::test]
    async fn handshake_version_mismatch_rejected() {
        let mut transport = FakeTransport::new();
        transport.inject_response(b"HELLO 2 OK\n".to_vec());
        transport.connect().await.unwrap();

        let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
        let result = protocol.handshake().await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::VersionMismatch { expected, actual } => {
                assert_eq!(expected, 1);
                assert_eq!(actual, 2);
            }
            other => panic!("Expected VersionMismatch, got {other}"),
        }
    }

    #[tokio::test]
    async fn handshake_version_match_succeeds() {
        let mut transport = FakeTransport::new();
        transport.inject_response(b"HELLO 1 OK\n".to_vec());
        transport.connect().await.unwrap();

        let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
        let result = protocol.handshake().await;

        assert!(result.is_ok());
        assert_eq!(protocol.firmware_version(), 1);
        assert!(protocol.is_connected());
    }

    // ── Task 2.11: RED — unexpected response triggers protocol error ──

    #[tokio::test]
    async fn unexpected_response_triggers_protocol_error() {
        let mut transport = FakeTransport::new();
        // When we send EXECUTE, FakeTransport returns "READY" instead of "OK"
        transport.inject_response(b"READY\n".to_vec());
        transport.connect().await.unwrap();

        let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
        let result = protocol.start_execution().await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::UnexpectedResponse(msg) => {
                // Debug format of ParsedResponse::Ready is "Ready"
                assert!(msg.contains("Ready"), "msg should mention Ready: {msg}");
            }
            other => panic!("Expected UnexpectedResponse, got {other}"),
        }
    }

    #[tokio::test]
    async fn execute_with_error_response() {
        let mut transport = FakeTransport::new();
        transport.inject_response(b"ERROR NOT_READY\n".to_vec());
        transport.connect().await.unwrap();

        let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
        let result = protocol.start_execution().await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::EspError(reason) => {
                assert_eq!(reason, "NOT_READY");
            }
            other => panic!("Expected EspError, got {other}"),
        }
    }

    #[tokio::test]
    async fn upload_manifest_rejected_with_esp_error() {
        let mut transport = FakeTransport::new();
        // sample_manifest() has: MANIFEST + 1 SEGMENT + 3 SAMPLES + END_UPLOAD = 6 lines
        transport.inject_response(b"OK\n".to_vec()); // MANIFEST
        transport.inject_response(b"OK\n".to_vec()); // SEGMENT
        transport.inject_response(b"OK\n".to_vec()); // SAMPLE 0
        transport.inject_response(b"OK\n".to_vec()); // SAMPLE 1
        transport.inject_response(b"OK\n".to_vec()); // SAMPLE 2
        transport.inject_response(b"ERROR DOF_MISMATCH\n".to_vec()); // END_UPLOAD
        transport.connect().await.unwrap();

        let manifest = sample_manifest();
        let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
        let result = protocol.upload_manifest(&manifest).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::EspError(reason) => {
                assert_eq!(reason, "DOF_MISMATCH");
            }
            other => panic!("Expected EspError, got {other}"),
        }
    }

    #[tokio::test]
    async fn upload_manifest_full_success() {
        let mut transport = FakeTransport::new();
        // Each MANIFEST/SEGMENT/SAMPLE line expects OK (total 5)
        transport.inject_response(b"OK\n".to_vec()); // MANIFEST
        transport.inject_response(b"OK\n".to_vec()); // SEGMENT
        transport.inject_response(b"OK\n".to_vec()); // SAMPLE 0
        transport.inject_response(b"OK\n".to_vec()); // SAMPLE 1
        transport.inject_response(b"OK\n".to_vec()); // SAMPLE 2
        transport.inject_response(b"READY\n".to_vec()); // END_UPLOAD
        transport.connect().await.unwrap();

        let manifest = sample_manifest();
        let mut protocol = Esp32Protocol::new(Box::new(transport), 1);
        let result = protocol.upload_manifest(&manifest).await;

        assert!(result.is_ok());
        assert_eq!(protocol.firmware_state(), FirmwareState::Ready);
    }

    // ── Additional parse_response tests ──────────────────────────────

    #[test]
    fn parse_ok_response() {
        let parsed = Esp32Protocol::parse_response("OK\n").unwrap();
        assert_eq!(parsed, ParsedResponse::Ok);
    }

    #[test]
    fn parse_ready_response() {
        let parsed = Esp32Protocol::parse_response("READY\n").unwrap();
        assert_eq!(parsed, ParsedResponse::Ready);
    }

    #[test]
    fn parse_handshake_ok() {
        let parsed = Esp32Protocol::parse_response("HELLO 1 OK\n").unwrap();
        assert_eq!(parsed, ParsedResponse::HandshakeOk(1));
    }

    #[test]
    fn parse_error_response() {
        let parsed = Esp32Protocol::parse_response("ERROR DOF_MISMATCH\n").unwrap();
        match parsed {
            ParsedResponse::Error(reason) => assert_eq!(reason, "DOF_MISMATCH"),
            other => panic!("Expected Error, got {other:?}"),
        }
    }

    #[test]
    fn parse_status_running() {
        let parsed = Esp32Protocol::parse_response("STATUS RUNNING\n").unwrap();
        assert_eq!(parsed, ParsedResponse::StatusRunning);
    }

    #[test]
    fn parse_status_completed() {
        let parsed = Esp32Protocol::parse_response("STATUS COMPLETED\n").unwrap();
        assert_eq!(parsed, ParsedResponse::StatusCompleted);
    }

    #[test]
    fn parse_unknown_command_response() {
        let result = Esp32Protocol::parse_response("BOGUS\n");
        assert!(result.is_err());
        match result.unwrap_err() {
            ProtocolError::UnexpectedResponse(msg) => {
                assert!(msg.contains("BOGUS"));
            }
            other => panic!("Expected UnexpectedResponse, got {other}"),
        }
    }
}
