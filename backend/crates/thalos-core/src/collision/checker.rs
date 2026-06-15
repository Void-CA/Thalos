use super::{CollisionBody, CollisionMatrix, CollisionResult};

/// Contrato para detectores de colisión.
///
/// Core define **qué** es una colisión y **cómo se consulta**.
/// La implementación concreta (naïve, BVH, GJK, etc.) vive en
/// `thalos-collision` u otros crates.
pub trait CollisionChecker {
    /// Evalúa colisiones entre un conjunto de cuerpos posicionados.
    ///
    /// Cada `CollisionBody` tiene su geometría y transformación al
    /// espacio global, por lo que el checker no necesita conocer la
    /// estructura del robot ni la escena — solo cuerpos.
    fn check(&self, bodies: &[CollisionBody], matrix: &CollisionMatrix) -> CollisionResult;
}
