use thalos_core::{
    kinematics::forward::result::FKResult,
    robot::serial_chain::SerialChain,
};

use crate::builder::{cylinder_between, SceneBuilder};
use crate::scene::{VisualPrimitive, VisualScene};

/// Builder visual específico para el robot SCARA.
///
/// Genera primitives geométricas que representan la estructura visual del SCARA:
/// - **base column**: cilindro vertical en el origen (soporte fijo)
/// - **link 1 body**: cilindro desde world hasta link_1 (primer brazo)
/// - **link 2 body**: cilindro desde link_1 hasta link_2 (segundo brazo)
///
/// Usa el `FKResult` para posicionar cada primitiva, por lo que sigue
/// correctamente los cambios de configuración articular (q).
pub struct ScaraVisualBuilder;

impl ScaraVisualBuilder {
    /// Construye una `VisualScene` completa con frames, links, axes y primitives.
    pub fn build(fk: &FKResult, chain: &SerialChain) -> VisualScene {
        let builder = SceneBuilder::new(chain);
        let mut scene = builder.from_fk(fk);

        // Los frames link_1 y link_2 son los hijos de los segmentos 0 y 1.
        // Esto es específico del SCARA (orden: World → link_1 → link_2 → ...).
        let link1_id = &chain.segments[0].child;
        let link2_id = &chain.segments[1].child;

        let link1_pose = fk.pose(link1_id).expect("SCARA must have link_1 frame");
        let link2_pose = fk.pose(link2_id).expect("SCARA must have link_2 frame");

        let t_link1: [f64; 3] = [
            link1_pose.transform().translation.x,
            link1_pose.transform().translation.y,
            link1_pose.transform().translation.z,
        ];
        let t_link2: [f64; 3] = [
            link2_pose.transform().translation.x,
            link2_pose.transform().translation.y,
            link2_pose.transform().translation.z,
        ];

        // 1. Base column — cilindro vertical fijo en el origen
        scene.primitives.push(VisualPrimitive::cylinder("base_column", 0.08, 0.4)
            .with_translation([0.0, 0.0, -0.2]));

        // 2. Link 1 — cilindro desde world (0,0,0) hasta link_1 frame
        scene.primitives.push(
            cylinder_between("link_1_body", [0.0, 0.0, 0.0], t_link1, 0.045),
        );

        // 3. Link 2 — cilindro desde link_1 hasta link_2
        scene.primitives.push(
            cylinder_between("link_2_body", t_link1, t_link2, 0.035),
        );

        scene
    }
}
