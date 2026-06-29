#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Ready,
    Running,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

impl SessionStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, SessionStatus::Completed | SessionStatus::Cancelled | SessionStatus::Failed)
    }

    pub fn is_active(&self) -> bool {
        matches!(self, SessionStatus::Running | SessionStatus::Paused)
    }
}
