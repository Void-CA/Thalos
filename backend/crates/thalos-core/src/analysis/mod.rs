//! Analysis modules over workspace datasets.
//!
//! Each submodule consumes the fundamental [`Workspace`](workspace::Workspace)
//! dataset and produces a derived analysis (singularity, manipulability, …).

pub mod workspace;
pub mod singularity;
pub mod manipulability;
