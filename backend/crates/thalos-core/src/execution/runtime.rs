use std::time::Duration;

use crate::ids::OperationId;
use crate::motion::target::{OutputChannel, OutputValue};

// ---------------------------------------------------------------------------
// RuntimeAction — what the runtime should do (non-planifiable actions)
// ---------------------------------------------------------------------------

/// A runtime action that cannot be planned geometrically.
///
/// Two variants exist in v1:
/// - `Delay`: wait for a specified duration
/// - `SetOutput`: set a digital/analog output channel to a value
#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeAction {
    Delay(Duration),
    SetOutput {
        channel: OutputChannel,
        value: OutputValue,
    },
}

// ---------------------------------------------------------------------------
// RuntimeEvent — an event in a RuntimeProgram with operation-level tracing
// ---------------------------------------------------------------------------

/// A single event in a `RuntimeProgram`, linked back to the originating
/// operation via `operation_id`.
#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeEvent {
    pub operation_id: OperationId,
    pub action: RuntimeAction,
}

// ---------------------------------------------------------------------------
// RuntimeProgram — the complete set of runtime events for one execution
// ---------------------------------------------------------------------------

/// The complete set of runtime events for one execution.
///
/// Contains a linear `Vec<RuntimeEvent>` in program order. The runtime
/// interprets this alongside the `CompiledPlan` to produce the final
/// execution timeline.
#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeProgram {
    pub events: Vec<RuntimeEvent>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::motion::target::*;

    // ── RuntimeAction construction ───────────────────────────────────────

    #[test]
    fn delay_action_constructs_with_duration() {
        let action = RuntimeAction::Delay(Duration::from_secs(5));
        match &action {
            RuntimeAction::Delay(d) => assert_eq!(*d, Duration::from_secs(5)),
            _ => panic!("Expected Delay variant"),
        }
    }

    #[test]
    fn delay_action_milliseconds() {
        let action = RuntimeAction::Delay(Duration::from_millis(1500));
        match &action {
            RuntimeAction::Delay(d) => assert_eq!(*d, Duration::from_millis(1500)),
            _ => panic!("Expected Delay variant"),
        }
    }

    #[test]
    fn set_output_action_constructs_with_channel_and_value() {
        let channel = OutputChannel {
            name: "gripper".into(),
            channel_type: "digital".into(),
        };
        let value = OutputValue::Bool(true);

        let action = RuntimeAction::SetOutput {
            channel: channel.clone(),
            value: value.clone(),
        };

        match &action {
            RuntimeAction::SetOutput { channel: c, value: v } => {
                assert_eq!(*c, channel);
                assert_eq!(*v, value);
            }
            _ => panic!("Expected SetOutput variant"),
        }
    }

    #[test]
    fn set_output_analog_value() {
        let channel = OutputChannel {
            name: "vacuum".into(),
            channel_type: "analog".into(),
        };
        let value = OutputValue::Integer(75);

        let action = RuntimeAction::SetOutput { channel, value };
        match &action {
            RuntimeAction::SetOutput { channel: c, value: v } => {
                assert_eq!(c.name, "vacuum");
                assert_eq!(*v, OutputValue::Integer(75));
            }
            _ => panic!("Expected SetOutput variant"),
        }
    }

    // ── RuntimeAction equality ───────────────────────────────────────────

    #[test]
    fn delay_actions_equal() {
        let a = RuntimeAction::Delay(Duration::from_secs(3));
        let b = RuntimeAction::Delay(Duration::from_secs(3));
        assert_eq!(a, b);
    }

    #[test]
    fn delay_actions_inequal() {
        let a = RuntimeAction::Delay(Duration::from_secs(3));
        let b = RuntimeAction::Delay(Duration::from_secs(5));
        assert_ne!(a, b);
    }

    #[test]
    fn set_output_actions_equal() {
        let a = RuntimeAction::SetOutput {
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };
        let b = RuntimeAction::SetOutput {
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };
        assert_eq!(a, b);
    }

    #[test]
    fn set_output_actions_inequal_channel() {
        let a = RuntimeAction::SetOutput {
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };
        let b = RuntimeAction::SetOutput {
            channel: OutputChannel {
                name: "vacuum".into(),
                channel_type: "analog".into(),
            },
            value: OutputValue::Bool(true),
        };
        assert_ne!(a, b);
    }

    #[test]
    fn different_variants_not_equal() {
        let delay = RuntimeAction::Delay(Duration::from_secs(1));
        let output = RuntimeAction::SetOutput {
            channel: OutputChannel {
                name: "gripper".into(),
                channel_type: "digital".into(),
            },
            value: OutputValue::Bool(true),
        };
        assert_ne!(delay, output);
    }

    // ── RuntimeEvent construction ────────────────────────────────────────

    #[test]
    fn runtime_event_holds_operation_id_and_action() {
        let op_id = OperationId("op-42".to_string());
        let action = RuntimeAction::Delay(Duration::from_secs(2));

        let event = RuntimeEvent {
            operation_id: op_id.clone(),
            action,
        };

        assert_eq!(event.operation_id, OperationId("op-42".to_string()));
        match &event.action {
            RuntimeAction::Delay(d) => assert_eq!(*d, Duration::from_secs(2)),
            _ => panic!("Expected Delay"),
        }
    }

    #[test]
    fn runtime_event_set_output_with_origin() {
        let op_id = OperationId("set-1".to_string());
        let event = RuntimeEvent {
            operation_id: op_id.clone(),
            action: RuntimeAction::SetOutput {
                channel: OutputChannel {
                    name: "gripper".into(),
                    channel_type: "digital".into(),
                },
                value: OutputValue::Bool(false),
            },
        };

        assert_eq!(event.operation_id, OperationId("set-1".to_string()));
        match &event.action {
            RuntimeAction::SetOutput { value, .. } => {
                assert_eq!(*value, OutputValue::Bool(false));
            }
            _ => panic!("Expected SetOutput"),
        }
    }

    #[test]
    fn runtime_event_equality() {
        let a = RuntimeEvent {
            operation_id: OperationId("evt-1".to_string()),
            action: RuntimeAction::Delay(Duration::from_secs(3)),
        };
        let b = RuntimeEvent {
            operation_id: OperationId("evt-1".to_string()),
            action: RuntimeAction::Delay(Duration::from_secs(3)),
        };
        assert_eq!(a, b);
    }

    #[test]
    fn runtime_event_inequality_operation_id() {
        let a = RuntimeEvent {
            operation_id: OperationId("evt-1".to_string()),
            action: RuntimeAction::Delay(Duration::from_secs(3)),
        };
        let b = RuntimeEvent {
            operation_id: OperationId("evt-2".to_string()),
            action: RuntimeAction::Delay(Duration::from_secs(3)),
        };
        assert_ne!(a, b);
    }

    // ── RuntimeProgram construction ──────────────────────────────────────

    #[test]
    fn runtime_program_empty_valid() {
        let program = RuntimeProgram { events: vec![] };
        assert_eq!(program.events.len(), 0);
    }

    #[test]
    fn runtime_program_empty_iterable() {
        let program = RuntimeProgram { events: vec![] };
        assert_eq!(program.events.iter().count(), 0);
    }

    #[test]
    fn runtime_program_with_multiple_events() {
        let program = RuntimeProgram {
            events: vec![
                RuntimeEvent {
                    operation_id: OperationId("op-1".to_string()),
                    action: RuntimeAction::Delay(Duration::from_secs(2)),
                },
                RuntimeEvent {
                    operation_id: OperationId("op-2".to_string()),
                    action: RuntimeAction::SetOutput {
                        channel: OutputChannel {
                            name: "gripper".into(),
                            channel_type: "digital".into(),
                        },
                        value: OutputValue::Bool(true),
                    },
                },
            ],
        };

        assert_eq!(program.events.len(), 2);
        assert!(
            matches!(program.events[0].action, RuntimeAction::Delay(_)),
            "First event should be Delay"
        );
        assert!(
            matches!(program.events[1].action, RuntimeAction::SetOutput { .. }),
            "Second event should be SetOutput"
        );
    }

    #[test]
    fn runtime_program_order_preserved() {
        let program = RuntimeProgram {
            events: vec![
                RuntimeEvent {
                    operation_id: OperationId("first".to_string()),
                    action: RuntimeAction::Delay(Duration::from_secs(1)),
                },
                RuntimeEvent {
                    operation_id: OperationId("second".to_string()),
                    action: RuntimeAction::Delay(Duration::from_secs(2)),
                },
                RuntimeEvent {
                    operation_id: OperationId("third".to_string()),
                    action: RuntimeAction::Delay(Duration::from_secs(3)),
                },
            ],
        };

        let ids: Vec<&str> = program
            .events
            .iter()
            .map(|e| e.operation_id.as_str())
            .collect();
        assert_eq!(ids, vec!["first", "second", "third"]);
    }

    #[test]
    fn runtime_program_clone_and_eq() {
        let program = RuntimeProgram {
            events: vec![
                RuntimeEvent {
                    operation_id: OperationId("op-1".to_string()),
                    action: RuntimeAction::Delay(Duration::from_secs(5)),
                },
            ],
        };

        let cloned = program.clone();
        assert_eq!(program, cloned);
    }
}
