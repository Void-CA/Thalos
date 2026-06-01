use std::sync::RwLock;

use thalos_core::{
    kinematics::forward::ForwardKinematics,
    models::{RobotModel, RobotRegistry},
};
use thalos_visual::{SceneBuilder, SceneDiff, SceneValidator, VisualScene};

use crate::backends::RobotBackend;
use crate::commands::Command;
use crate::error::RuntimeError;
use crate::snapshots::RuntimeSnapshot;
use crate::state::robot::{ActiveRobot, SceneRuntime};


pub struct SceneService {
    runtime: RwLock<SceneRuntime>,
    validator: SceneValidator,
    backend: Box<dyn RobotBackend + Send + Sync>,
}

impl SceneService {
    /// Creates a new service with the given backend and initial robot model.
    pub fn new(backend: Box<dyn RobotBackend + Send + Sync>, model: RobotModel) -> Self {
        let chain = RobotRegistry::create_default(model);
        let active_robot = ActiveRobot::new(model, chain, vec![0.0; model.metadata().dof]);
        let runtime = SceneRuntime::new(active_robot);

        Self {
            runtime: RwLock::new(runtime),
            validator: SceneValidator::default(),
            backend,
        }
    }

    /// Returns a snapshot of the current runtime state, building the visual scene
    /// from the active robot's joint configuration.
    pub fn snapshot(&self) -> Result<RuntimeSnapshot, RuntimeError> {
        let runtime = self.runtime.read().unwrap();

        let fk = ForwardKinematics::new(runtime.active_robot.chain.clone());
        let builder = SceneBuilder::new(&runtime.active_robot.chain);
        let result = fk.evaluate(&runtime.active_robot.joints);
        let scene = builder.from_fk(&result);

        self.validator.validate(&scene)?;

        Ok(RuntimeSnapshot {
            robot: runtime.active_robot.model,
            joints: runtime.active_robot.joints.clone(),
            scene,
            generated_at: chrono::Utc::now(),
        })
    }

    /// Applies a command and returns the resulting snapshot.
    pub fn execute(&self, cmd: Command) -> Result<RuntimeSnapshot, RuntimeError> {
        match cmd {
            Command::SetJoints(joints) => {
                let mut runtime = self.runtime.write().unwrap();
                runtime.active_robot.joints = joints;
            }
            Command::LoadRobot(id) => {
                let model = self.backend.resolve_model(&id)?;
                let chain = RobotRegistry::create_default(model);
                let dof = model.metadata().dof;

                let mut runtime = self.runtime.write().unwrap();
                runtime.active_robot = ActiveRobot::new(model, chain, vec![0.0; dof]);
            }
        }

        self.snapshot()
    }

    /// Validates a visual scene against structural rules.
    pub fn validate_scene(&self, scene: &VisualScene) -> Result<(), RuntimeError> {
        self.validator.validate(scene)?;
        Ok(())
    }

    /// Computes the diff between two visual scenes.
    pub fn diff(&self, old: &VisualScene, new: &VisualScene, epsilon: f64) -> SceneDiff {
        SceneDiff::between(old, new, epsilon)
    }
}
