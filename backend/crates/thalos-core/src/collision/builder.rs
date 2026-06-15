use crate::kinematics::forward::result::FKResult;
use crate::robot::serial_chain::SerialChain;
use super::{CollisionBody, EntityId};

/// Construye `Vec<CollisionBody>` a partir del resultado de FK y
/// el modelo cinemático del robot.
///
/// Esto mantiene desacoplada la detección de colisiones del
/// cálculo de cinemática directa: el checker nunca necesita saber
/// cómo se llegó a las poses de los cuerpos.
pub struct CollisionBodyBuilder;

impl CollisionBodyBuilder {
    /// Produce un `CollisionBody` por cada link del robot que tenga
    /// geometría de colisión definida.
    ///
    /// La pose de cada cuerpo se obtiene del `FKResult` usando el
    /// frame del segmento (child frame), que es el frame cuya pose
    /// global FK calcula.
    pub fn build(chain: &SerialChain, fk: &FKResult) -> Vec<CollisionBody> {
        let mut bodies = Vec::new();

        for segment in &chain.segments {
            let geometry = match &segment.link.collision_geometry {
                Some(g) => g.clone(),
                None => continue,
            };

            let pose = match fk.pose(&segment.child) {
                Some(p) => p.transform().clone(),
                None => continue,
            };

            bodies.push(CollisionBody {
                entity: EntityId::Link(segment.link.id),
                geometry,
                pose,
            });
        }

        bodies
    }
}
