//! Applied-command history with pre-computed inverses (design D6).
//!
//! PR5 implements `undo` as pop + apply(inverse) in O(1) — the inverse is
//! stored at apply time (PR4) and each entry captures the metrics of the
//! applied plan so the undo endpoint reports the restored health without
//! re-running the analysis pipeline.

use thalos_planning::{
    motion::program::PlanningProgram,
    program_edit::{EditError, ProgramEdit},
};
use thalos_core::motion::segment::MotionSegment;

/// Health metrics captured at apply time (D6) — the undo endpoint reports the
/// restored health from these without re-running the analysis pipeline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CommandMetrics {
    /// Health (0..1) of the plan BEFORE the command was applied.
    pub health_before: f64,
    /// Health (0..1) of the plan AFTER the command was applied.
    pub health_after: f64,
}

impl CommandMetrics {
    pub fn new(health_before: f64, health_after: f64) -> Self {
        Self {
            health_before,
            health_after,
        }
    }

    /// `health_after - health_before` — the delta the applied command produced.
    pub fn improvement(&self) -> f64 {
        self.health_after - self.health_before
    }
}

/// A command applied to the runtime, with its pre-computed inverse (D6).
///
/// PR4 stored the inverse in memory so PR5 can implement `undo` in O(1) via
/// `apply(inverse)` — no replay, no re-derivation. The history lives on
/// `SceneRuntime` close to the mutation surface (design open question:
/// runtime, not planning — it tracks scene mutations).
///
/// R4-001: each entry is LINKED to the program it produced (`applied_program`).
/// Undo must never apply an inverse to a plan that is not that command's
/// pre-state — `matches_applied_program` is the guard that rejects a stale
/// inverse when another path (e.g. a re-schedule) replaced the active plan.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedCommand {
    /// The semantic edit that was applied.
    pub command: ProgramEdit,
    /// The edit that restores the previous program (`command.inverse()`).
    pub inverse: ProgramEdit,
    /// Health metrics of the applied plan — undo reports from these (O(1)).
    pub metrics: CommandMetrics,
    /// The program segments the apply WROTE BACK — the only state this
    /// command's inverse may be applied to (R4-001 stale-undo guard).
    pub applied_program: Vec<MotionSegment>,
}

impl AppliedCommand {
    /// O(1) undo: apply the stored inverse to `program` in a SINGLE call —
    /// never a replay of the history (design D6, spec "Undo is O(1)").
    pub fn undo_program(&self, program: &PlanningProgram) -> Result<PlanningProgram, EditError> {
        self.inverse.apply(program)
    }

    /// True when `program` is the exact program this command produced (R4-001).
    ///
    /// Undo is only safe when the inverse is applied to its own pre-state; if
    /// another path replaced the active plan, the stored inverse is stale.
    pub fn matches_applied_program(&self, program: &PlanningProgram) -> bool {
        self.applied_program == program.segments
    }
}

/// O(1) command history: Vec-backed, push/pop on the tail (design D6).
///
/// `undo` pops the last entry in constant time — the history is never
/// replayed or re-derived.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CommandHistory {
    entries: Vec<AppliedCommand>,
}

impl CommandHistory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Append an applied command with its pre-computed inverse + metrics.
    pub fn push(&mut self, entry: AppliedCommand) {
        self.entries.push(entry);
    }

    /// O(1) — remove and return the LAST applied command (no replay).
    pub fn pop(&mut self) -> Option<AppliedCommand> {
        self.entries.pop()
    }

    /// O(1) — peek the last applied command without removing it.
    pub fn last(&self) -> Option<&AppliedCommand> {
        self.entries.last()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use thalos_core::ids::OperationId;
    use thalos_core::motion::segment::MotionSegment;

    /// A single-MoveJ program whose target moves under each edit.
    fn sample_program() -> PlanningProgram {
        PlanningProgram::new(vec![MotionSegment::MoveJ {
            origin: OperationId("op-0".to_string()),
            target: vec![0.0, 0.0],
            max_velocity: Some(500.0),
            max_acceleration: Some(1000.0),
        }])
    }

    /// A MoveWaypoint edit with a captured old target — the exact shape the
    /// apply pipeline records (design D6: pre-computed roundtrip inverse).
    fn move_waypoint_edit(new_target: f64) -> ProgramEdit {
        ProgramEdit::MoveWaypoint {
            segment_index: 0,
            new_target: vec![new_target, new_target],
            old_target: Some(vec![new_target - 1.0, new_target - 1.0]),
        }
    }

    /// Target of the single MoveJ segment (behavior signature — the segment
    /// struct is verbose; the target is what each edit moves).
    fn target_of(program: &PlanningProgram) -> Vec<f64> {
        match &program.segments[0] {
            MotionSegment::MoveJ { target, .. } => target.clone(),
            other => panic!("expected a MoveJ segment, got {other:?}"),
        }
    }

    #[test]
    fn undo_is_o1_with_100_plus_history_entries_no_replay() {
        // Spec command-endpoints "Undo is O(1)": a session with N > 100
        // applied commands — undo must be CONSTANT TIME. It pops ONE entry and
        // applies ONE stored inverse; it never replays the history.
        let program = sample_program();
        let mut history = CommandHistory::new();
        for i in 1..=150 {
            let cmd = move_waypoint_edit(i as f64);
            history.push(AppliedCommand {
                command: cmd.clone(),
                inverse: cmd.inverse(),
                metrics: CommandMetrics::new(0.4, 0.5),
                applied_program: program.segments.clone(),
            });
        }

        let start = Instant::now();
        let popped = history.pop().expect("150 entries → pop must succeed");
        let restored = popped.undo_program(&program).expect("single inverse apply");
        let elapsed = start.elapsed();

        // Exactly ONE entry was consumed — undo never walks the history.
        assert_eq!(
            history.len(),
            149,
            "undo must pop exactly one entry (not replay N-1 commands)"
        );
        // The single inverse apply restores the program to the state BEFORE
        // the last command (target 149), not a replay of all 150 edits.
        assert_eq!(
            target_of(&restored),
            vec![149.0, 149.0],
            "the stored inverse must restore the previous state in one apply"
        );
        // Constant-time guard: pop + one inverse apply is microseconds; an
        // O(n) replay with recompiles blows far past this ceiling.
        assert!(
            elapsed < Duration::from_secs(1),
            "undo with 150 history entries must be O(1), took {elapsed:?}"
        );
    }

    #[test]
    fn undo_with_1000_entries_still_pops_a_single_entry() {
        // Triangulation — a DIFFERENT scale (10x the spec's N > 100): the
        // operation count must stay constant regardless of history size.
        let program = sample_program();
        let mut history = CommandHistory::new();
        for i in 1..=1000 {
            let cmd = move_waypoint_edit(i as f64);
            history.push(AppliedCommand {
                command: cmd.clone(),
                inverse: cmd.inverse(),
                metrics: CommandMetrics::new(0.4, 0.5),
                applied_program: program.segments.clone(),
            });
        }

        let popped = history.pop().expect("1000 entries → pop must succeed");
        let restored = popped.undo_program(&program).expect("single inverse apply");

        assert_eq!(history.len(), 999, "one entry popped at any scale");
        assert_eq!(target_of(&restored), vec![999.0, 999.0]);
    }

    #[test]
    fn pop_on_empty_history_returns_none() {
        // Edge: an empty history has nothing to pop (the API maps this to the
        // 409 "Undo with empty history" scenario).
        let mut history = CommandHistory::new();
        assert!(history.is_empty());
        assert_eq!(history.len(), 0);
        assert!(history.pop().is_none(), "empty history → pop returns None");
        assert!(history.last().is_none(), "empty history → last returns None");
    }
}
