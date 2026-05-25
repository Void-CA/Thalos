use thalos_core::{
    kinematics::{
        forward::ForwardKinematics,
        jacobian::{GeometricJacobian, JacobianSolver},
    },
    robot::serial_chain::SerialChain,
};
use thalos_visual::{
    SceneBuilder, SceneDiff, SceneError, SceneValidator, VisualScene,
};

pub struct SceneService {
    fk: ForwardKinematics,
    builder: SceneBuilder,
    validator: SceneValidator,
    jacobian: Option<GeometricJacobian>,
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
            jacobian: None,
        }
    }

    pub fn with_jacobian(mut self) -> Self {
        let end_effector = self.fk.robot().end_effector().clone();
        let geom = GeometricJacobian::new(self.fk.clone(), end_effector);
        self.jacobian = Some(geom);
        self
    }

    pub fn build_scene(&self, q: &[f64]) -> Result<VisualScene, SceneError> {
        let result = self.fk.evaluate(q);
        let scene = self.builder.from_fk(&result);
        self.validator.validate(&scene)?;
        Ok(scene)
    }

    pub fn build_scene_with_jacobian(&self, q: &[f64]) -> Result<VisualScene, SceneError> {
        let result = self.fk.evaluate(q);
        let scene = match &self.jacobian {
            Some(jac) => {
                let jacobian = jac.evaluate(q);
                self.builder.from_fk_with_jacobian(&result, &jacobian)
            }
            None => self.builder.from_fk(&result),
        };
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
