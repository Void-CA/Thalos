use chrono::{DateTime, Utc};

use super::session_status::SessionStatus;

/// Mutable execution state for a compiled plan.
///
/// Created when the user presses Start. Advances through the plan's
/// trajectory until completion or cancellation. The plan itself
/// (`CompiledPlan`) is immutable and shared.
#[derive(Debug, Clone)]
pub struct ExecutionSession {
    pub plan_id: String,
    pub status: SessionStatus,
    /// Current time position in the trajectory (seconds).
    pub current_time: f64,
    pub started_at: Option<DateTime<Utc>>,
    pub paused_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl ExecutionSession {
    pub fn new(plan_id: impl Into<String>) -> Self {
        Self {
            plan_id: plan_id.into(),
            status: SessionStatus::Ready,
            current_time: 0.0,
            started_at: None,
            paused_at: None,
            completed_at: None,
        }
    }

    /// Start (or restart) execution — transitions to Running.
    pub fn start(&mut self) {
        self.status = SessionStatus::Running;
        self.started_at = Some(Utc::now());
        self.current_time = 0.0;
    }

    /// Advance the current time by `dt` seconds.
    ///
    /// Returns the new progress fraction 0.0–1.0.
    /// If the trajectory duration is reached, transitions to Completed.
    pub fn advance(&mut self, dt: f64, trajectory_duration: f64) -> f64 {
        if self.status != SessionStatus::Running {
            return self.progress(trajectory_duration);
        }

        self.current_time += dt;

        if trajectory_duration > 0.0 && self.current_time >= trajectory_duration {
            self.current_time = trajectory_duration;
            self.status = SessionStatus::Completed;
            self.completed_at = Some(Utc::now());
        }

        self.progress(trajectory_duration)
    }

    pub fn pause(&mut self) {
        if self.status == SessionStatus::Running {
            self.status = SessionStatus::Paused;
            self.paused_at = Some(Utc::now());
        }
    }

    pub fn resume(&mut self) {
        if self.status == SessionStatus::Paused {
            self.status = SessionStatus::Running;
        }
    }

    pub fn cancel(&mut self) {
        if !self.status.is_terminal() {
            self.status = SessionStatus::Cancelled;
            self.completed_at = Some(Utc::now());
        }
    }

    pub fn fail(&mut self) {
        if !self.status.is_terminal() {
            self.status = SessionStatus::Failed;
            self.completed_at = Some(Utc::now());
        }
    }

    /// Reset the session for re-execution — keeps the plan_id, resets state.
    pub fn reset(&mut self) {
        self.status = SessionStatus::Ready;
        self.current_time = 0.0;
        self.started_at = None;
        self.paused_at = None;
        self.completed_at = None;
    }

    /// Progress as fraction of trajectory duration (0.0–1.0).
    pub fn progress(&self, trajectory_duration: f64) -> f64 {
        if self.status.is_terminal() {
            return 1.0;
        }
        if trajectory_duration <= 0.0 {
            return 1.0;
        }
        (self.current_time / trajectory_duration).clamp(0.0, 1.0)
    }

    /// Create a derived session from external state (status + progress).
    /// Used by RuntimeSnapshot/TickDelta to represent controller state
    /// in the legacy execution session format.
    pub fn derived(status: SessionStatus, progress: f64) -> Self {
        let current_time = if progress >= 1.0 && status.is_terminal() {
            1.0
        } else {
            progress
        };
        Self {
            plan_id: String::new(),
            status,
            current_time,
            started_at: Some(Utc::now()),
            paused_at: None,
            completed_at: if status.is_terminal() {
                Some(Utc::now())
            } else {
                None
            },
        }
    }
}
