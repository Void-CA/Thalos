use crate::math::geometry::rigid::Transform3D;
use super::{CollisionGeometry, EntityId};

/// Un cuerpo posicionado en el espacio global, listo para ser evaluado
/// por un `CollisionChecker`.
///
/// Es un concepto de dominio: cualquier subsistema (planning, runtime,
/// visualización, colisión) puede producirlo o consumirlo sin acoplarse
/// al algoritmo de detección.
#[derive(Debug, Clone)]
pub struct CollisionBody {
    pub entity: EntityId,
    pub geometry: CollisionGeometry,
    pub pose: Transform3D,
}

impl CollisionBody {
    pub fn new(entity: impl Into<EntityId>, geometry: CollisionGeometry, pose: Transform3D) -> Self {
        Self {
            entity: entity.into(),
            geometry,
            pose,
        }
    }
}
