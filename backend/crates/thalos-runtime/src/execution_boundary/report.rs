use std::time::Duration;

use thiserror::Error;

use crate::error::ControllerError;
use crate::motion_trace::MotionTrace;

/// Summary of what happened during execution of a prepared command.
///
/// Uses the existing `MotionTrace` for sample data — does NOT create a new
/// trace type. Plan comparison (planned vs. actual) belongs to SDD-006.
#[derive(Debug)]
pub struct ExecutionReport {
    /// Chronological trace of robot states during execution.
    pub trace: MotionTrace,
    /// Total execution duration (matches `ExecutionCommand::duration`).
    pub duration: Duration,
    /// High-level outcome of the execution.
    pub status: ExecutionStatus,
}

/// High-level outcome of an execution attempt.
#[derive(Debug)]
pub enum ExecutionStatus {
    /// Execution completed normally (progress reached 1.0).
    Completed,
    /// Execution was interrupted (e.g., stop or estop).
    Interrupted,
    /// Execution failed with an error.
    Failed,
}

/// Errors produced by the execution boundary adapter.
#[derive(Error, Debug)]
pub enum ExecutionError {
    /// The plan contains no executable segments (no trajectory waypoints).
    #[error("plan has no executable segments")]
    EmptyPlan,

    /// The underlying controller returned an error.
    #[error("controller error: {0}")]
    Controller(#[from] ControllerError),
}
