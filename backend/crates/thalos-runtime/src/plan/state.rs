/// Lifecycle state of a motion plan.
///
/// Plans are created, activated (when execution begins),
/// and eventually reach a terminal state (Completed, Cancelled, Failed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanState {
    /// Plan has been created but execution has not started.
    Created,
    /// Plan is actively being executed (trajectory advancing).
    Active,
    /// Plan has finished execution successfully.
    Completed,
    /// Plan was cancelled before completion.
    Cancelled,
    /// Plan failed during execution or planning.
    Failed,
}

impl PlanState {
    /// Whether this state is terminal (will not transition further).
    pub fn is_terminal(&self) -> bool {
        matches!(self, PlanState::Completed | PlanState::Cancelled | PlanState::Failed)
    }
}
