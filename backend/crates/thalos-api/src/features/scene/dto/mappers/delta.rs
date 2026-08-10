use thalos_core::kinematics::forward::result::FKResult;
use thalos_core::robot::serial_chain::SerialChain;
use thalos_core::spatial::frame::FrameId;
use thalos_runtime::plan::ExecutionMode;
use thalos_runtime::TickDelta;

use super::super::{ExecutionDto, ExecutionStatusDto, RuntimeDelta, TransformUpdate};

/// Convierte un `TickDelta` del runtime en un `RuntimeDelta` DTO.
pub fn to_delta_response(delta: &TickDelta) -> RuntimeDelta {
    let transforms = build_transform_updates(&delta.chain, &delta.fk_result);

    let execution = delta
        .execution
        .as_ref()
        .map(|exe| {
            let status = match exe.status {
                thalos_runtime::SessionStatus::Ready => ExecutionStatusDto::Ready,
                thalos_runtime::SessionStatus::Running => ExecutionStatusDto::Running,
                thalos_runtime::SessionStatus::Paused => ExecutionStatusDto::Paused,
                thalos_runtime::SessionStatus::Completed => ExecutionStatusDto::Completed,
                thalos_runtime::SessionStatus::Cancelled => ExecutionStatusDto::Cancelled,
                thalos_runtime::SessionStatus::Failed => ExecutionStatusDto::Failed,
            };

            ExecutionDto {
                status,
                progress: exe.progress(delta.plan_duration),
                elapsed_secs: exe.current_time,
                source: Some(exe.source.to_string()),
                mode: exe.mode,
                iteration: exe.iteration,
                total_iterations: exe.total_iterations,
            }
        })
        .unwrap_or(ExecutionDto {
            status: ExecutionStatusDto::Idle,
            progress: 0.0,
            elapsed_secs: 0.0,
            source: None,
            mode: ExecutionMode::Once,
            iteration: 1,
            total_iterations: None,
        });

    RuntimeDelta {
        joints: delta.joints.clone(),
        transforms,
        execution,
    }
}

/// Construye la lista de `TransformUpdate` para todos los objetos visuales
/// que cambian en cada tick: frames (ejes de coordenadas) y links (cilindros).
///
/// Los frames se actualizan con su pose directa del FK (translation + rotation,
/// scale = [1,1,1]).
///
/// Los links se representan como cilindros unitarios centrados en el punto
/// medio del segmento, con rotación alineada a la dirección y scale.y = longitud.
/// Esto permite al renderer tratarlos como Object3D genéricos sin lógica especial.
fn build_transform_updates(chain: &SerialChain, fk: &FKResult) -> Vec<TransformUpdate> {
    let mut transforms = Vec::new();

    // ── Frame transforms (pose directa del FK) ──
    for frame_id in fk.frames() {
        let Some(pose) = fk.pose(frame_id) else {
            continue;
        };
        let tx = pose.transform();

        let visual_id = match frame_id {
            FrameId::World => "world".into(),
            id => chain
                .frames
                .get(id)
                .map(|f| f.name().to_string())
                .unwrap_or_default(),
        };

        transforms.push(TransformUpdate {
            id: visual_id,
            translation: [tx.translation.x, tx.translation.y, tx.translation.z],
            rotation: [
                tx.rotation.inner().w,
                tx.rotation.inner().x,
                tx.rotation.inner().y,
                tx.rotation.inner().z,
            ],
            scale: [1.0, 1.0, 1.0],
        });
    }

    // ── Link transforms (cilindro entre parent→child) ──
    for segment in &chain.segments {
        if segment.joint.dof() == 0 {
            continue;
        }

        let Some(child_pose) = fk.pose(&segment.child) else {
            continue;
        };
        let Some(parent_pose) = fk.pose(&segment.parent) else {
            continue;
        };

        let start = parent_pose.translation();
        let end = child_pose.translation();
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let dz = end.z - start.z;
        let len = (dx * dx + dy * dy + dz * dz).sqrt();

        if len < 1e-10 {
            continue;
        }

        let midpoint = [
            (start.x + end.x) / 2.0,
            (start.y + end.y) / 2.0,
            (start.z + end.z) / 2.0,
        ];
        let dir = [dx / len, dy / len, dz / len];
        let rotation = align_y_to(dir);

        transforms.push(TransformUpdate {
            id: segment.joint.id().to_string(),
            translation: midpoint,
            rotation,
            scale: [1.0, len, 1.0],
        });
    }

    transforms
}

/// Devuelve un quaternion `[w, x, y, z]` que rota el eje Y (0,1,0) para
/// alinearse con `direction`. El eje Y es el default de CylinderGeometry en
/// Three.js — esta rotación permite que un cilindro apunte en cualquier dirección.
fn align_y_to(direction: [f64; 3]) -> [f64; 4] {
    let norm =
        (direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2])
            .sqrt();
    if norm < 1e-15 {
        return [1.0, 0.0, 0.0, 0.0];
    }
    let dir = [
        direction[0] / norm,
        direction[1] / norm,
        direction[2] / norm,
    ];

    let y = [0.0, 1.0, 0.0];
    let dot = y[0] * dir[0] + y[1] * dir[1] + y[2] * dir[2];

    if dot > 0.9999 {
        return [1.0, 0.0, 0.0, 0.0];
    }
    if dot < -0.9999 {
        return [0.0, 0.0, 0.0, 1.0];
    }

    let axis = [
        y[1] * dir[2] - y[2] * dir[1],
        y[2] * dir[0] - y[0] * dir[2],
        y[0] * dir[1] - y[1] * dir[0],
    ];
    let axis_norm = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
    let axis = [
        axis[0] / axis_norm,
        axis[1] / axis_norm,
        axis[2] / axis_norm,
    ];

    let half = dot.acos() / 2.0;
    let s = half.sin();

    [half.cos(), axis[0] * s, axis[1] * s, axis[2] * s]
}
