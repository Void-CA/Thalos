//! Concrete `IntentionOperator` implementations.
//!
//! Each module in this directory provides one operator that implements
//! the [`IntentionOperator`](crate::feedback::operator::IntentionOperator) trait.
//!
//! # Operators
//!
//! - [`switch_strategy`] — `SwitchMoveStrategy` (MoveL → MoveJ via IK)
//! - [`observation_switch_strategy`] — `SwitchMoveStrategy` over
//!   [`Observation`](thalos_core::analysis::observation::Observation) (PR 4b,
//!   proposes a strategy switch — new model, see module docs)

pub mod observation_switch_strategy;
pub mod switch_strategy;
