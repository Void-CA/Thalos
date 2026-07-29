//! # thalos-semantic
//!
//! Task-level programming model for Thalos. Defines `SemanticProgram` —
//! a linear sequence of logical operations that represent *what* the robot
//! should achieve, independent of geometry, constraints, or motion planning.
//!
//! ## Module Structure
//!
//! - `resource` — Logical resource identifiers (`ObjectId`, `LocationId`, `ToolId`)
//! - `operation` — `SemanticOperation` enum with five variants
//! - `program` — `SemanticProgram` container with ordered operations
//! - `validation` — Two-level validation pipeline (Level 1: sequence rules, Level 2: resource resolution)

pub mod operation;
pub mod program;
pub mod resource;
pub mod validation;
