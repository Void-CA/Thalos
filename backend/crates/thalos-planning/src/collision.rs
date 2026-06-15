use thalos_core::{
    collision::{CollisionBodyBuilder, CollisionChecker, CollisionMatrix},
    kinematics::forward::ForwardKinematics,
    robot::serial_chain::SerialChain,
    trajectory::Trajectory,
};

use crate::error::PlanningError;

/// Valida que una trayectoria completa esté libre de colisiones.
///
/// Para cada waypoint de la trayectoria:
/// 1. Calcula FK → poses globales de cada link
/// 2. Construye `CollisionBody` para cada link con geometría
/// 3. Ejecuta el `CollisionChecker`
///
/// Retorna `CollisionDetected` en el primer waypoint con colisión,
/// o `Ok(())` si toda la trayectoria es válida.
pub fn validate_trajectory(
    chain: &SerialChain,
    trajectory: &Trajectory,
    checker: &dyn CollisionChecker,
    matrix: &CollisionMatrix,
) -> Result<(), PlanningError> {
    let fk = ForwardKinematics::new(chain.clone());

    for waypoint in trajectory.waypoints().iter() {
        let fk_result = fk.evaluate(waypoint.joints());
        let bodies = CollisionBodyBuilder::build(chain, &fk_result);

        let result = checker.check(&bodies, matrix);

        if let Some(pair) = result.collisions.into_iter().next() {
            return Err(PlanningError::CollisionDetected {
                involved: (pair.a, pair.b),
            });
        }
    }

    Ok(())
}
