use thalos_core::{
    kinematics::forward::ForwardKinematics,
    robot::serial_chain::SerialChain,
};
use thalos_visual::{
    SceneBuilder, SceneDiff, SceneError, SceneValidator, VisualScene,
};

pub struct SceneService {
    fk: ForwardKinematics,
    builder: SceneBuilder,
    validator: SceneValidator,
}

impl SceneService {
    pub fn new(chain: SerialChain) -> Self {
        let fk = ForwardKinematics::new(chain.clone());
        let builder = SceneBuilder::new(&chain);
        let validator = SceneValidator::default();
        Self {
            fk,
            builder,
            validator,
        }
    }

    pub fn build_scene(&self, q: &[f64]) -> Result<VisualScene, SceneError> {
        let result = self.fk.evaluate(q);
        let scene = self.builder.from_fk(&result);
        self.validator.validate(&scene)?;
        Ok(scene)
    }

    pub fn validate(&self, scene: &VisualScene) -> Result<(), SceneError> {
        self.validator.validate(scene)
    }

    pub fn diff(&self, old: &VisualScene, new: &VisualScene, epsilon: f64) -> SceneDiff {
        SceneDiff::between(old, new, epsilon)
    }
}
