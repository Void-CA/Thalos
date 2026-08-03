//! Concrete [`ObservationIntentionOperator`] implementations.
//!
//! Each module in this directory provides one operator that implements the
//! [`ObservationIntentionOperator`](crate::feedback::operator::ObservationIntentionOperator)
//! trait over the unified observation model.
//!
//! # Operators
//!
//! - [`observation_switch_strategy`] — `SwitchMoveStrategy` (PR 4b): proposes a
//!   strategy switch over the runtime tracking phenomena — new model.
//!
//! The legacy segment-transforming `switch_strategy` operator was removed in
//! PR 4d: its materialization logic now lives in
//! [`ProposalMaterializer`](crate::feedback::materializer::ProposalMaterializer),
//! which works over [`ActionProposal`](crate::feedback::operator::ActionProposal)s
//! instead of legacy execution findings.

pub mod observation_switch_strategy;
