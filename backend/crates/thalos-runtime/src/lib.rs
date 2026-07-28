pub mod backends;
pub mod commands;
pub mod comparison;
pub mod error;
pub mod execution_analysis;
pub mod execution_boundary;
pub mod motion_recorder;
pub mod motion_trace;
pub mod plan;
pub mod robot_command;
pub mod services;
pub mod session;
pub mod snapshots;
pub mod state;
pub mod telemetry;

pub use backends::controller::{BackendCapabilities, RobotController};
pub use backends::execution::ExecutionBackend;
pub use commands::dispatch::Command;
pub use error::{ControllerError, RuntimeError};
pub use execution_analysis::{ExecutionAnalyzer, ExecutionThresholds};
pub use execution_boundary::{
    ExecutionAdapter, ExecutionCommand, ExecutionError, ExecutionReport, ExecutionSegmentBoundary,
    ExecutionStatus,
};
pub use motion_trace::{MotionSample, MotionTrace};
pub use plan::{ActiveMotionPlan, ExecutionSession, MotionType, PlanState, SessionStatus};
pub use robot_command::RobotCommand;
pub use services::manipulability::ManipulabilityService;
pub use services::plan_analysis::{PlanAnalysisResult, PlanAnalysisService};
pub use services::scene::SceneService;
pub use services::singularity::SingularityService;
pub use services::workspace::WorkspaceService;
pub use session::{ExecutionSource, SessionData, SessionManager, SessionWithTrace};
pub use snapshots::scene::RuntimeSnapshot;
pub use snapshots::scene::TickDelta;
pub use state::robot_state::{
    CartesianState, ConnectionState, DeviceState, Diagnostics, ExecutionState, JointState,
    MotionMode, MotionState, RobotError, RobotState,
};
pub use telemetry::{
    ExecutionEvent, ExecutionObserver, ExecutionRecorder, ExecutionSample, ExecutionStatistics,
    ExecutionTrace, TraceAnalyzer, TraceMetadata,
};
