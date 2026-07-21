use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Evento de ciclo de vida durante la ejecución.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExecutionEvent {
    Started { timestamp: Duration },
    Paused { timestamp: Duration },
    Resumed { timestamp: Duration },
    WaypointReached { timestamp: Duration, waypoint: usize },
    SegmentCompleted { timestamp: Duration, segment: usize },
    Error { timestamp: Duration, message: String },
    Completed { timestamp: Duration },
    Cancelled { timestamp: Duration },
}

impl ExecutionEvent {
    pub fn timestamp(&self) -> Duration {
        match self {
            ExecutionEvent::Started { timestamp }
            | ExecutionEvent::Paused { timestamp }
            | ExecutionEvent::Resumed { timestamp }
            | ExecutionEvent::WaypointReached { timestamp, .. }
            | ExecutionEvent::SegmentCompleted { timestamp, .. }
            | ExecutionEvent::Error { timestamp, .. }
            | ExecutionEvent::Completed { timestamp }
            | ExecutionEvent::Cancelled { timestamp } => *timestamp,
        }
    }
}
