//! Analysis modules over workspace datasets and trajectory configurations.
//!
//! Each submodule consumes the fundamental [`Workspace`](workspace::Workspace)
//! dataset and produces a derived analysis (singularity, manipulability, …).
//!
//! [`constraints`] provides symbolic constraint evaluation for configurations.
//! [`trajectory_analysis`] provides per-waypoint analysis types used by planning.

pub mod workspace;
pub mod singularity;
pub mod manipulability;
pub mod constraints;
