//! Analysis modules over workspace datasets, trajectory configurations, and
//! the canonical observation language shared across all analyzers.
//!
//! # Layers
//!
//! - **Observation model** ([`attribute_value`], [`location`],
//!   [`observation`]): the machine-readable, artifact-anchored vocabulary every
//!   analyzer emits (see [`crate::analysis::observation`] and `README.md`).
//! - **Domain analyzers**: [`singularity`], [`manipulability`], [`workspace`],
//!   [`constraints`], [`region`] — analyzers over the fundamental
//!   [`Workspace`](workspace::Workspace) dataset.
//!
//! Each submodule consumes the fundamental [`Workspace`](workspace::Workspace)
//! dataset and produces a derived analysis (singularity, manipulability, …).

pub mod attribute_value;
pub mod constraints;
pub mod location;
pub mod manipulability;
pub mod observation;
pub mod region;
pub mod singularity;
pub mod workspace;

pub use attribute_value::AttributeValue;
pub use location::Location;
pub use observation::{ArtifactRef, Observation, ObservationId, ObservationKind, Severity};
