//! Concrete `IntentionOperator` implementations.
//!
//! Each module in this directory provides one operator that implements
//! the [`IntentionOperator`](crate::feedback::operator::IntentionOperator) trait.
//!
//! # Operators
//!
//! - [`switch_strategy`] — `SwitchMoveStrategy` (MoveL → MoveJ via IK)

pub mod switch_strategy;
