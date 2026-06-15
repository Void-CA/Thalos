use crate::robot::link::LinkId;

pub type ObstacleId = u32;
pub type ToolId = u32;

/// Identificador extensible de una entidad que puede participar en
/// una colisión.
///
/// Diseñado para que el sistema pueda crecer sin romper APIs:
/// hoy solo necesitamos `Link` y `Obstacle`, pero `Tool` ya está
/// contemplado aunque todavía no exista en el dominio.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EntityId {
    Link(LinkId),
    Obstacle(ObstacleId),
    Tool(ToolId),
}

impl From<LinkId> for EntityId {
    fn from(id: LinkId) -> Self {
        EntityId::Link(id)
    }
}

// ObstacleId y ToolId son type aliases de u32, por lo que no
// implementamos From para evitar conflictos con From<u32>.
// Los usuarios pueden construir EntityId::Obstacle(id) directamente.
