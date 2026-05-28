use std::sync::RwLock;

use thalos_core::{
    kinematics::forward::ForwardKinematics,
    models::{RobotModel, RobotRegistry},
};

use thalos_visual::{
    SceneBuilder,
    SceneDiff,
    SceneError,
    SceneValidator,
    VisualScene,
};

use crate::features::scene::runtime::{ActiveRobot, SceneRuntime};

pub struct SceneService {
    runtime: RwLock<SceneRuntime>,
    validator: SceneValidator,
}

impl SceneService {
    pub fn new(model: RobotModel) -> Self {
        let chain = RobotRegistry::create_default(model);
        let active_robot = ActiveRobot::new(model, chain, vec![0.0; model.metadata().dof]);
        let runtime = SceneRuntime::new(active_robot);

        Self {
            runtime: RwLock::new(runtime),
            validator: SceneValidator::default(),
        }
    }

    pub fn build_scene(&self) -> Result<VisualScene, SceneError> {
        let runtime = self.runtime.read().unwrap();

        let fk = ForwardKinematics::new(runtime.active_robot.chain.clone());

        let builder = SceneBuilder::new(&runtime.active_robot.chain);

        let result = fk.evaluate(&runtime.active_robot.joints);

        let scene = builder.from_fk(&result);

        self.validator.validate(&scene)?;

        Ok(scene)
    }

    pub fn set_joints(&self, joints: Vec<f64>) {
        let mut runtime = self.runtime.write().unwrap();
        runtime.active_robot.joints = joints;
    }

    pub fn load_robot(&self, model: RobotModel) {
        let chain = RobotRegistry::create_default(model);

        let mut runtime = self.runtime.write().unwrap();

        runtime.active_robot = ActiveRobot::new(model, chain, vec![0.0; model.metadata().dof]);
    }

    pub fn current_robot(&self) -> RobotModel {
        self.runtime.read().unwrap().active_robot.model
    }

    pub fn current_robot_metadata(&self) -> thalos_core::models::RobotMetadata {
        self.runtime.read().unwrap().active_robot.model.metadata()
    }

    pub fn current_joints(&self) -> Vec<f64> {
        self.runtime.read().unwrap().active_robot.joints.clone()
    }

    pub fn validate(&self, scene: &VisualScene) -> Result<(), SceneError> {
        self.validator.validate(scene)
    }

    pub fn diff(&self, old: &VisualScene, new: &VisualScene, epsilon: f64) -> SceneDiff {
        SceneDiff::between(old, new, epsilon)
    }
}

