// ── Domain → DTO conversions ──

use thalos_visual::{
    ChangedFrame, FrameStyle, PrimitiveGeometry, SceneDiff, VisualFrame, VisualJointAxis,
    VisualLink, VisualPrimitive, VisualScene, VisualTwist,
};

use crate::features::scene::dto::{
    ChangedFrameDto, FrameStyleDto, PrimitiveGeometryDto, SceneDiffDto, VisualFrameDto,
    VisualJointAxisDto, VisualLinkDto, VisualPrimitiveDto, VisualSceneDto, VisualTwistDto,
};

impl From<FrameStyle> for FrameStyleDto {
    fn from(s: FrameStyle) -> Self {
        Self {
            axis_length: s.axis_length,
            axis_radius: s.axis_radius,
            origin_radius: s.origin_radius,
            show_labels: s.show_labels,
            color_x: s.color_x,
            color_y: s.color_y,
            color_z: s.color_z,
        }
    }
}

impl From<VisualFrame> for VisualFrameDto {
    fn from(f: VisualFrame) -> Self {
        Self {
            id: f.id,
            parent: f.parent,
            translation: f.translation,
            rotation: f.rotation,
            style: f.style.map(Into::into),
        }
    }
}

impl From<VisualLink> for VisualLinkDto {
    fn from(l: VisualLink) -> Self {
        Self {
            id: l.id,
            start: l.start,
            end: l.end,
        }
    }
}

impl From<VisualJointAxis> for VisualJointAxisDto {
    fn from(a: VisualJointAxis) -> Self {
        Self {
            origin: a.origin,
            axis: a.axis,
        }
    }
}

impl From<VisualTwist> for VisualTwistDto {
    fn from(t: VisualTwist) -> Self {
        Self {
            origin: t.origin,
            linear: t.linear,
            angular: t.angular,
        }
    }
}

impl From<PrimitiveGeometry> for PrimitiveGeometryDto {
    fn from(g: PrimitiveGeometry) -> Self {
        match g {
            PrimitiveGeometry::Cylinder { radius, height } => Self::Cylinder { radius, height },
            PrimitiveGeometry::Sphere { radius } => Self::Sphere { radius },
            PrimitiveGeometry::Box { width, height, depth } => Self::Box { width, height, depth },
        }
    }
}

impl From<VisualPrimitive> for VisualPrimitiveDto {
    fn from(p: VisualPrimitive) -> Self {
        Self {
            id: p.id,
            frame_id: p.frame_id,
            translation: p.translation,
            rotation: p.rotation,
            geometry: p.geometry.into(),
            color: p.color,
        }
    }
}

impl From<VisualScene> for VisualSceneDto {
    fn from(s: VisualScene) -> Self {
        Self {
            frames: s.frames.into_iter().map(Into::into).collect(),
            links: s.links.into_iter().map(Into::into).collect(),
            joint_axes: s.joint_axes.into_iter().map(Into::into).collect(),
            twists: s.twists.into_iter().map(Into::into).collect(),
            primitives: s.primitives.into_iter().map(Into::into).collect(),
            reference_dimension: s.reference_dimension,
        }
    }
}

impl From<ChangedFrame> for ChangedFrameDto {
    fn from(c: ChangedFrame) -> Self {
        Self {
            id: c.id,
            translation_delta: c.translation_delta,
            rotation_angle_deg: c.rotation_angle_deg,
        }
    }
}

impl From<SceneDiff> for SceneDiffDto {
    fn from(d: SceneDiff) -> Self {
        Self {
            frames_removed: d.frames_removed,
            frames_added: d.frames_added,
            changed_frames: d.changed_frames.into_iter().map(Into::into).collect(),
        }
    }
}


// ── DTO → Domain conversions ──

impl From<FrameStyleDto> for FrameStyle {
    fn from(s: FrameStyleDto) -> Self {
        Self {
            axis_length: s.axis_length,
            axis_radius: s.axis_radius,
            origin_radius: s.origin_radius,
            show_labels: s.show_labels,
            color_x: s.color_x,
            color_y: s.color_y,
            color_z: s.color_z,
        }
    }
}

impl From<VisualFrameDto> for VisualFrame {
    fn from(f: VisualFrameDto) -> Self {
        Self {
            id: f.id,
            parent: f.parent,
            translation: f.translation,
            rotation: f.rotation,
            style: f.style.map(Into::into),
        }
    }
}

impl From<VisualLinkDto> for VisualLink {
    fn from(l: VisualLinkDto) -> Self {
        Self {
            id: l.id,
            start: l.start,
            end: l.end,
        }
    }
}

impl From<VisualJointAxisDto> for VisualJointAxis {
    fn from(a: VisualJointAxisDto) -> Self {
        Self {
            origin: a.origin,
            axis: a.axis,
        }
    }
}

impl From<VisualTwistDto> for VisualTwist {
    fn from(t: VisualTwistDto) -> Self {
        Self {
            origin: t.origin,
            linear: t.linear,
            angular: t.angular,
        }
    }
}

impl From<PrimitiveGeometryDto> for PrimitiveGeometry {
    fn from(g: PrimitiveGeometryDto) -> Self {
        match g {
            PrimitiveGeometryDto::Cylinder { radius, height } => Self::Cylinder { radius, height },
            PrimitiveGeometryDto::Sphere { radius } => Self::Sphere { radius },
            PrimitiveGeometryDto::Box { width, height, depth } => Self::Box { width, height, depth },
        }
    }
}

impl From<VisualPrimitiveDto> for VisualPrimitive {
    fn from(p: VisualPrimitiveDto) -> Self {
        Self {
            id: p.id,
            frame_id: p.frame_id,
            translation: p.translation,
            rotation: p.rotation,
            geometry: p.geometry.into(),
            color: p.color,
        }
    }
}

impl From<VisualSceneDto> for VisualScene {
    fn from(s: VisualSceneDto) -> Self {
        Self {
            frames: s.frames.into_iter().map(Into::into).collect(),
            links: s.links.into_iter().map(Into::into).collect(),
            joint_axes: s.joint_axes.into_iter().map(Into::into).collect(),
            twists: s.twists.into_iter().map(Into::into).collect(),
            primitives: s.primitives.into_iter().map(Into::into).collect(),
            reference_dimension: s.reference_dimension,
        }
    }
}
