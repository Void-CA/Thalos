use super::robot_instance::{RobotInstance, RobotInstanceId};

/// Representación estructural del mundo.
///
/// Scene describe **qué** hay en el mundo (robots con su modelo y pose base),
/// no **cómo** se están ejecutando. El estado dinámico de ejecución vive
/// en `RuntimeState` (en `thalos-runtime`).
///
/// Crecimiento futuro previsible:
/// - `obstacles: Vec<Obstacle>`
/// - `tools: Vec<Tool>`
/// - `frames: FrameRegistry`
pub struct Scene {
    robots: Vec<RobotInstance>,
}

impl Scene {
    /// Crea un Scene vacío, sin robots.
    pub fn new() -> Self {
        Self {
            robots: Vec::new(),
        }
    }

    /// Agrega una instancia de robot al Scene.
    pub fn add_robot(&mut self, robot: RobotInstance) {
        self.robots.push(robot);
    }

    /// Elimina un robot por su ID y lo retorna.
    ///
    /// Retorna `None` si no existe un robot con ese ID.
    pub fn remove_robot(&mut self, id: RobotInstanceId) -> Option<RobotInstance> {
        let idx = self.robots.iter().position(|r| r.id == id)?;
        Some(self.robots.swap_remove(idx))
    }

    /// Retorna una referencia al robot con el ID dado, si existe.
    pub fn robot(&self, id: RobotInstanceId) -> Option<&RobotInstance> {
        self.robots.iter().find(|r| r.id == id)
    }

    /// Retorna una referencia mutable al robot con el ID dado, si existe.
    pub fn robot_mut(&mut self, id: RobotInstanceId) -> Option<&mut RobotInstance> {
        self.robots.iter_mut().find(|r| r.id == id)
    }

    /// Retorna un slice con todos los robots del Scene.
    pub fn robots(&self) -> &[RobotInstance] {
        &self.robots
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::factory::{RobotModel, RobotRegistry};
    use crate::prelude::Transform3D;
    use std::sync::Arc;

    fn dummy_robot(id: u32, name: &str) -> RobotInstance {
        let model = RobotRegistry::create_default(RobotModel::Planar3R);
        RobotInstance {
            id: RobotInstanceId::new(id),
            name: name.to_string(),
            model: Arc::new(model),
            base_pose: Transform3D::identity(),
        }
    }

    #[test]
    fn empty_scene() {
        let scene = Scene::new();
        assert!(scene.robots().is_empty());
    }

    #[test]
    fn add_one_robot() {
        let mut scene = Scene::new();
        let robot = dummy_robot(1, "test-bot");
        let id = robot.id;
        scene.add_robot(robot);

        assert_eq!(scene.robots().len(), 1);
        assert!(scene.robot(id).is_some());
    }

    #[test]
    fn remove_robot() {
        let mut scene = Scene::new();
        let robot = dummy_robot(1, "test-bot");
        let id = robot.id;
        scene.add_robot(robot);

        let removed = scene.remove_robot(id);
        assert!(removed.is_some());
        assert!(scene.robots().is_empty());
        assert!(scene.robot(id).is_none());
    }

    #[test]
    fn remove_nonexistent() {
        let mut scene = Scene::new();
        assert!(scene.remove_robot(RobotInstanceId::new(999)).is_none());
    }

    #[test]
    fn robot_mut_allows_modification() {
        let mut scene = Scene::new();
        let robot = dummy_robot(1, "original");
        let id = robot.id;
        scene.add_robot(robot);

        if let Some(r) = scene.robot_mut(id) {
            r.name = "modified".to_string();
        }

        assert_eq!(scene.robot(id).unwrap().name, "modified");
    }

    #[test]
    fn multiple_robots() {
        let mut scene = Scene::new();
        scene.add_robot(dummy_robot(1, "bot-a"));
        scene.add_robot(dummy_robot(2, "bot-b"));

        assert_eq!(scene.robots().len(), 2);
        assert!(scene.robot(RobotInstanceId::new(1)).is_some());
        assert!(scene.robot(RobotInstanceId::new(2)).is_some());
    }
}
