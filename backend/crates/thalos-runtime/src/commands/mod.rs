/// Typed commands that can be executed against the runtime.
///
/// Each command represents a mutation of the runtime state. Commands are
/// processed by [`SceneService::execute`](crate::services::scene::SceneService::execute)
/// which applies the mutation and returns the resulting snapshot.
#[derive(Debug, Clone)]
pub enum Command {
    /// Set the joint angles of the active robot.
    SetJoints(Vec<f64>),

    /// Load a robot model by its string identifier.
    LoadRobot(String),
}
