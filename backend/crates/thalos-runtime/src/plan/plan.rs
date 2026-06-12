use chrono::{DateTime, Utc};

use thalos_core::prelude::Trajectory;

use super::motion_type::MotionType;
use super::state::PlanState;

/// A first-class motion plan within the runtime.
///
/// Wraps a planned trajectory with lifecycle state, timestamps,
/// and metadata. This is the entity the frontend interacts with
/// when inspecting or managing planned motion.
#[derive(Debug, Clone)]
pub struct ActiveMotionPlan {
    /// Unique identifier for this plan.
    pub plan_id: String,
    /// Current lifecycle state.
    pub state: PlanState,
    /// The planned trajectory (time-parameterised joint sequence).
    pub trajectory: Trajectory,
    /// How the trajectory was generated (joint-space vs cartesian).
    pub motion_type: MotionType,
    /// When the plan was created.
    pub created_at: DateTime<Utc>,
    /// When execution started (None if not yet started).
    pub started_at: Option<DateTime<Utc>>,
    /// When execution finished (None if not yet completed).
    pub completed_at: Option<DateTime<Utc>>,
}

impl ActiveMotionPlan {
    /// Create a new plan in `Completed` state.
    ///
    /// This is the common case for `PlanAndMoveJ` / `PlanAndMoveL`
    /// where the runtime immediately sets joints to the final position.
    pub fn completed(
        plan_id: impl Into<String>,
        trajectory: Trajectory,
        motion_type: MotionType,
    ) -> Self {
        let now = Utc::now();
        Self {
            plan_id: plan_id.into(),
            state: PlanState::Completed,
            trajectory,
            motion_type,
            created_at: now,
            started_at: Some(now),
            completed_at: Some(now),
        }
    }

    /// Create a new plan in `Created` state (execution deferred).
    pub fn created(
        plan_id: impl Into<String>,
        trajectory: Trajectory,
        motion_type: MotionType,
    ) -> Self {
        Self {
            plan_id: plan_id.into(),
            state: PlanState::Created,
            trajectory,
            motion_type,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
        }
    }

    /// Transition to `Active` state, recording start time.
    pub fn start(&mut self) {
        self.state = PlanState::Active;
        self.started_at = Some(Utc::now());
    }

    /// Transition to `Completed` state.
    pub fn complete(&mut self) {
        self.state = PlanState::Completed;
        self.completed_at = Some(Utc::now());
    }

    /// Cancel the plan.
    pub fn cancel(&mut self) {
        self.state = PlanState::Cancelled;
        self.completed_at = Some(Utc::now());
    }

    /// Mark the plan as failed.
    pub fn fail(&mut self) {
        self.state = PlanState::Failed;
        self.completed_at = Some(Utc::now());
    }

    /// Progress of the trajectory as a fraction 0.0–1.0.
    ///
    /// Terminal states always return 1.0. `Created` returns 0.0.
    /// `Active` computes progress from elapsed wall-clock time
    /// since `started_at` vs trajectory duration.
    pub fn progress(&self) -> f64 {
        match self.state {
            PlanState::Completed | PlanState::Cancelled | PlanState::Failed => 1.0,
            PlanState::Created => 0.0,
            PlanState::Active => {
                let duration = self.trajectory.duration();
                if duration <= 0.0 {
                    return 1.0;
                }
                let elapsed = self
                    .started_at
                    .map(|start| (Utc::now() - start).num_seconds() as f64)
                    .unwrap_or(0.0);
                (elapsed / duration).clamp(0.0, 1.0)
            }
        }
    }
}
