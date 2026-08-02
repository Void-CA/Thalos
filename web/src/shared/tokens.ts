/**
 * Tokens de color centralizados.
 *
 * Todas las referencias a colores en Three.js, Tailwind y componentes
 * deberían venir de acá. Cambiar un valor en este archivo actualiza
 * TODOS los lugares que lo usan.
 */

// ── Scene / Viewport ──

export const SCENE_BG = 0x1a1a1a
export const GRID_COLOR_CENTER = 0x666666
export const GRID_COLOR_LINE = 0x444444

// ── Links ──

export const LINK_COLOR = 0x3399ff
export const LINK_OPACITY = 0.35

// ── Frame axes ──

export const AXIS_X = [1.0, 0.5, 0.0] as const
export const AXIS_Y = [0.0, 0.8, 0.0] as const
export const AXIS_Z = [0.0, 0.5, 1.0] as const
export const AXIS_ORIGIN = 0xcccccc

// ── Trajectory / Waypoints ──

export const SEGMENT_PALETTE = [
  0x3b82f6, 0x22c55e, 0xf59e0b, 0xef4444,
  0x8b5cf6, 0xec4899, 0x14b8a6, 0xf97316,
]

export const WAYPOINT_TYPE: Record<string, number> = {
  Start: 0x22c55e,
  Goal: 0xef4444,
  Via: 0x3b82f6,
}

export const TRAJECTORY_LINE = 0x3b82f6

export const WAYPOINT_ACTIVE = 0xffffff

// ── Severity / Analysis ──

export const SEVERITY: Record<string, number> = {
  good: 0x44cc44,
  warning: 0xeebb22,
  critical: 0xee3333,
  nodata: 0x888888,
}

export const MANIP_HIGH = 0x44cc44
export const MANIP_MED = 0xeebb22
export const MANIP_LOW = 0xee3333

export const SINGULAR_NORMAL = 0x44cc44
export const SINGULAR_NEAR = 0xeebb22
export const SINGULAR_SINGULAR = 0xee3333

// ── Workspace point cloud ──

export const CLOUD_WORKSPACE = 0xff8800
export const CLOUD_GENERIC = 0xcccccc

// ── IK Gizmo ──

export const IK_COLOR = 0xff6600

// ── TCP Overlay ──

export const TCP_COLOR = 0x00ffff

// ── IK panel button variants (hex para Tailwind bg) ──

export const BTN_SOLVE_BG = '#1a5a9c'
export const BTN_SOLVE_BORDER = '#2a6ab0'

export const BTN_EXECUTE_BG = '#2a6a2a'
export const BTN_EXECUTE_BORDER = '#3a8a3a'

// ── Planning segment colors ──

export const PLAN_SEGMENT_PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
]
