use thalos_core::collision::{
    CollisionBody, CollisionChecker, CollisionMatrix, CollisionPair, CollisionResult,
    CollisionType, EntityId,
};
use thalos_core::math::{
    geometry::{rigid::Transform3D, vectors::Vector3},
    traits::products::{Cross, Dot},
};

/// Epsilon para comparaciones de punto flotante en detección de colisiones.
const COLLISION_EPS: f64 = 1e-9;

/// Detector de colisiones O(n²) sin optimizaciones.
///
/// Implementa detección exacta para:
/// - Sphere vs Sphere
/// - Box vs Box (OBB via Separating Axis Theorem)
///
/// Los pares que involucran geometrías no soportadas se ignoran
/// (no se reportan como colisión).
pub struct NaiveCollisionChecker;

impl CollisionChecker for NaiveCollisionChecker {
    fn check(&self, bodies: &[CollisionBody], matrix: &CollisionMatrix) -> CollisionResult {
        let mut collisions = Vec::new();

        for i in 0..bodies.len() {
            for j in (i + 1)..bodies.len() {
                let a = &bodies[i];
                let b = &bodies[j];

                // Si ambos son links, consultar matriz de exclusión
                if let (EntityId::Link(la), EntityId::Link(lb)) = (&a.entity, &b.entity) {
                    if matrix.is_ignored(*la, *lb) {
                        continue;
                    }
                }

                if geometries_intersect(&a.geometry, &a.pose, &b.geometry, &b.pose) {
                    collisions.push(CollisionPair::new(
                        a.entity.clone(),
                        b.entity.clone(),
                        classify_collision(&a.entity, &b.entity),
                    ));
                }
            }
        }

        CollisionResult::new(collisions)
    }
}

/// Determina semánticamente el tipo de colisión según las entidades
/// involucradas.
///
/// - Link ↔ Link → SelfCollision
/// - Cualquier interacción con Obstacle o Tool → EnvironmentCollision
fn classify_collision(a: &EntityId, b: &EntityId) -> CollisionType {
    match (a, b) {
        (EntityId::Link(_), EntityId::Link(_)) => CollisionType::SelfCollision,
        _ => CollisionType::EnvironmentCollision,
    }
}

/// Determina si dos geometrías posicionadas se intersectan.
fn geometries_intersect(
    geo_a: &thalos_core::collision::CollisionGeometry,
    pose_a: &Transform3D,
    geo_b: &thalos_core::collision::CollisionGeometry,
    pose_b: &Transform3D,
) -> bool {
    use thalos_core::collision::CollisionGeometry;
    match (geo_a, geo_b) {
        (CollisionGeometry::Sphere(a), CollisionGeometry::Sphere(b)) => {
            sphere_vs_sphere(a.radius, pose_a, b.radius, pose_b)
        }
        (CollisionGeometry::Box(a), CollisionGeometry::Box(b)) => {
            box_vs_box(a.half_extents, pose_a, b.half_extents, pose_b)
        }
        (CollisionGeometry::Sphere(s), CollisionGeometry::Box(b)) => {
            sphere_vs_box(s.radius, pose_a, b.half_extents, pose_b)
        }
        (CollisionGeometry::Box(b), CollisionGeometry::Sphere(s)) => {
            sphere_vs_box(s.radius, pose_b, b.half_extents, pose_a)
        }
        // Cylinder y otros — no implementados aún, reportar no-colisión
        _ => false,
    }
}

// ─── Sphere-Sphere ───────────────────────────────────────────────

fn sphere_vs_sphere(r1: f64, pose1: &Transform3D, r2: f64, pose2: &Transform3D) -> bool {
    let delta = pose1.translation - pose2.translation;
    let dist_sq = delta.dot(delta);
    let radius_sum = r1 + r2;
    dist_sq <= radius_sum * radius_sum + COLLISION_EPS
}

// ─── Box-Box (SAT) ──────────────────────────────────────────────

fn box_vs_box(
    he_a: Vector3,
    pose_a: &Transform3D,
    he_b: Vector3,
    pose_b: &Transform3D,
) -> bool {
    let axes_a = obb_axes(&pose_a.rotation);
    let axes_b = obb_axes(&pose_b.rotation);

    // Los 15 ejes de prueba: 3 de A, 3 de B, 9 productos cruz
    // Solo probamos cross products donde las aristas no son paralelas
    for axis in sat_axes(&axes_a, &axes_b) {
        let proj_a = obb_projection_radius(&axes_a, he_a, &axis);
        let proj_b = obb_projection_radius(&axes_b, he_b, &axis);

        let center = pose_b.translation - pose_a.translation;
        let center_proj = center.dot(axis).abs();

        // COLLISION_EPS evita falsos negativos por error de punto flotante
        // en casos donde las cajas están apenas tocándose.
        if center_proj > proj_a + proj_b + COLLISION_EPS {
            return false; // Separados en este eje
        }
    }

    true // No hay eje separador → colisión
}

/// Retorna los 3 ejes locales del OBB en el marco global.
fn obb_axes(rotation: &thalos_core::math::geometry::rotations::UnitQuaternion) -> [Vector3; 3] {
    let x = rotation.rotate_vector(Vector3::new(1.0, 0.0, 0.0));
    let y = rotation.rotate_vector(Vector3::new(0.0, 1.0, 0.0));
    let z = rotation.rotate_vector(Vector3::new(0.0, 0.0, 1.0));
    [x, y, z]
}

/// Radio de proyección de un OBB sobre un eje.
///
/// Equivale a: Σ |half_extents[i] · dot(axis_i, test_axis)|
fn obb_projection_radius(axes: &[Vector3; 3], half_extents: Vector3, test_axis: &Vector3) -> f64 {
    let h = half_extents;
    h.x * axes[0].dot(*test_axis).abs()
        + h.y * axes[1].dot(*test_axis).abs()
        + h.z * axes[2].dot(*test_axis).abs()
}

/// Genera los 15 ejes de prueba para SAT entre dos OBBs.
///
/// Omite ejes degenerados (producto cruz con magnitud casi cero).
fn sat_axes(axes_a: &[Vector3; 3], axes_b: &[Vector3; 3]) -> Vec<Vector3> {
    let mut axes = Vec::with_capacity(15);

    // 3 ejes de A
    axes.extend_from_slice(axes_a);
    // 3 ejes de B
    axes.extend_from_slice(axes_b);

    // 9 productos cruz A_i × B_j
    //
    // NOTA sobre normalización: SAT funciona correctamente con ejes no
    // normalizados siempre que proj_a, proj_b y center_proj se calculen
    // contra el MISMO vector (como hacemos acá). Si en el futuro alguien
    // reusa estos ejes en otro contexto (ej. distancia de penetración),
    // va a necesitar normalizar.
    let cross_eps = 1e-12;
    for i in 0..3 {
        for j in 0..3 {
            let cross = axes_a[i].cross(axes_b[j]);
            if cross.dot(cross) > cross_eps {
                axes.push(cross);
            }
        }
    }

    axes
}

// ─── Sphere-Box ─────────────────────────────────────────────────

fn sphere_vs_box(
    sphere_radius: f64,
    sphere_pose: &Transform3D,
    box_he: Vector3,
    box_pose: &Transform3D,
) -> bool {
    let center = sphere_pose.translation - box_pose.translation;

    // Llevamos el centro de la esfera al marco local del OBB
    let inv_rot = box_pose.rotation.inverse();
    let local_center = inv_rot.rotate_vector(center);

    // Distancia al punto más cercano del OBB (clamp)
    let closest = Vector3::new(
        local_center.x.clamp(-box_he.x, box_he.x),
        local_center.y.clamp(-box_he.y, box_he.y),
        local_center.z.clamp(-box_he.z, box_he.z),
    );

    let delta = local_center - closest;
    delta.dot(delta) <= sphere_radius * sphere_radius + COLLISION_EPS
}

#[cfg(test)]
mod tests {
    use super::*;
    use thalos_core::collision::{CollisionGeometry, Sphere, Box3D};
    use thalos_core::prelude::EntityId;

    fn body(geometry: CollisionGeometry, pose: Transform3D) -> CollisionBody {
        CollisionBody::new(EntityId::Link(0), geometry, pose)
    }

    #[test]
    fn spheres_not_intersecting() {
        let a = body(
            CollisionGeometry::Sphere(Sphere::new(1.0)),
            Transform3D::identity(),
        );
        let b = body(
            CollisionGeometry::Sphere(Sphere::new(1.0)),
            Transform3D::from_translation(Vector3::new(3.0, 0.0, 0.0)),
        );
        let result = NaiveCollisionChecker.check(&[a, b], &CollisionMatrix::new());
        assert!(result.is_empty());
    }

    #[test]
    fn spheres_intersecting() {
        let a = body(
            CollisionGeometry::Sphere(Sphere::new(1.0)),
            Transform3D::identity(),
        );
        let b = body(
            CollisionGeometry::Sphere(Sphere::new(1.0)),
            Transform3D::from_translation(Vector3::new(1.5, 0.0, 0.0)),
        );
        let result = NaiveCollisionChecker.check(&[a, b], &CollisionMatrix::new());
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn boxes_not_intersecting() {
        let a = body(
            CollisionGeometry::Box(Box3D::new(1.0, 1.0, 1.0)),
            Transform3D::identity(),
        );
        let b = body(
            CollisionGeometry::Box(Box3D::new(1.0, 1.0, 1.0)),
            Transform3D::from_translation(Vector3::new(2.0, 0.0, 0.0)),
        );
        let result = NaiveCollisionChecker.check(&[a, b], &CollisionMatrix::new());
        assert!(result.is_empty());
    }

    #[test]
    fn boxes_intersecting() {
        let a = body(
            CollisionGeometry::Box(Box3D::new(2.0, 2.0, 2.0)),
            Transform3D::identity(),
        );
        let b = body(
            CollisionGeometry::Box(Box3D::new(2.0, 2.0, 2.0)),
            Transform3D::from_translation(Vector3::new(1.0, 0.0, 0.0)),
        );
        let result = NaiveCollisionChecker.check(&[a, b], &CollisionMatrix::new());
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn ignored_pairs_are_skipped() {
        // Dos spheres que intersectarían, pero su par está ignorado
        let a_link1 = CollisionBody::new(EntityId::Link(1), CollisionGeometry::Sphere(Sphere::new(1.0)), Transform3D::identity());
        let b_link2 = CollisionBody::new(EntityId::Link(2), CollisionGeometry::Sphere(Sphere::new(1.0)), Transform3D::from_translation(Vector3::new(0.5, 0.0, 0.0)));

        let mut matrix = CollisionMatrix::new();
        matrix.ignore(1, 2);

        let result = NaiveCollisionChecker.check(&[a_link1, b_link2], &matrix);
        assert!(result.is_empty(), "ignored pair should not collide");
    }

    #[test]
    fn sphere_box_intersecting() {
        let sphere = body(
            CollisionGeometry::Sphere(Sphere::new(0.5)),
            Transform3D::identity(),
        );
        let box_body = body(
            CollisionGeometry::Box(Box3D::new(2.0, 2.0, 2.0)),
            Transform3D::identity(),
        );
        let result = NaiveCollisionChecker.check(&[sphere, box_body], &CollisionMatrix::new());
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn self_collision_classified_for_links() {
        let a = CollisionBody::new(EntityId::Link(1), CollisionGeometry::Sphere(Sphere::new(1.0)), Transform3D::identity());
        let b = CollisionBody::new(EntityId::Link(2), CollisionGeometry::Sphere(Sphere::new(1.0)), Transform3D::from_translation(Vector3::new(0.5, 0.0, 0.0)));
        let result = NaiveCollisionChecker.check(&[a, b], &CollisionMatrix::new());
        assert_eq!(result.collisions[0].collision_type, CollisionType::SelfCollision);
    }

    #[test]
    fn environment_collision_classified_for_obstacle() {
        let link = CollisionBody::new(EntityId::Link(0), CollisionGeometry::Sphere(Sphere::new(1.0)), Transform3D::identity());
        let obstacle = CollisionBody::new(EntityId::Obstacle(0), CollisionGeometry::Sphere(Sphere::new(1.0)), Transform3D::from_translation(Vector3::new(0.5, 0.0, 0.0)));
        let result = NaiveCollisionChecker.check(&[link, obstacle], &CollisionMatrix::new());
        assert_eq!(result.collisions[0].collision_type, CollisionType::EnvironmentCollision);
    }

    #[test]
    fn sphere_box_not_intersecting() {
        let sphere = body(
            CollisionGeometry::Sphere(Sphere::new(0.5)),
            Transform3D::from_translation(Vector3::new(5.0, 0.0, 0.0)),
        );
        let box_body = body(
            CollisionGeometry::Box(Box3D::new(2.0, 2.0, 2.0)),
            Transform3D::identity(),
        );
        let result = NaiveCollisionChecker.check(&[sphere, box_body], &CollisionMatrix::new());
        assert!(result.is_empty());
    }
}
