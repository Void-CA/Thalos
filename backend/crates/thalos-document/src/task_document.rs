use serde::{Deserialize, Serialize};

use crate::id::TaskDocumentId;
use crate::project::Metadata as DocumentMetadata;
use crate::scene::SceneContent;
use thalos_semantic::program::SemanticProgram;

// ---------------------------------------------------------------------------
// TaskDocument — the top-level document for task-level programming
// ---------------------------------------------------------------------------

/// A complete task document for task-level programming.
///
/// Contains a unique identity (`TaskDocumentId`), document metadata
/// (name, version, timestamps), the logical scene model (`SceneContent`),
/// and a semantic program that references scene resources by ID.
///
/// This is the input to the semantic lowering pipeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskDocument {
    /// Unique document identifier.
    pub id: TaskDocumentId,
    /// Document metadata (name, version, timestamps).
    pub metadata: DocumentMetadata,
    /// The logical scene model (objects, locations, tools, home pose).
    pub scene: SceneContent,
    /// The semantic program referencing scene resources by ID.
    pub program: SemanticProgram,
}
