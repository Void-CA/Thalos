/**
 * Demo scene fixture — SCARA Pick → Wait → Place → Home with a MIDDLE-segment
 * crossing through full extension (spec candidate-alternatives-demo "Demo
 * Reproducibility"). SCENE-ONLY: this module defines the deterministic
 * geometry + task configuration of the demo instance — the seed that PROVOKES
 * the counterfactual. It carries NO recorded pipeline output (no ranking, no
 * assessment numbers).
 *
 * The counterfactual EMERGES from the live backend pipeline through the
 * PRODUCTION composition — proven by the API integration test
 * `analyze_live_pipeline_returns_candidate_ranking_with_alternate_elbow`
 * (`backend/crates/thalos-api/tests/api_tests.rs`): load Scara → joints at
 * the seed home → schedule the three-segment crossing → POST /plan/analyze →
 * `candidate_ranking` with Direct + AlternateElbow, selected AlternateElbow,
 * AlternateElbow risk strictly below Direct. The numbers are never
 * pre-injected here.
 *
 * The joint-space seed mirrors `crossing_seed()` from the backend contract
 * test `backend/crates/thalos-planning/tests/candidate_counterfactual.rs`
 * (three MoveJ structure, validated 2026-08-13):
 *   home  [0.0, -1.31, -0.1,  0.0]   → cartesian (1.206280, -0.772948, 0.400)
 *   cross [0.5,  0.6,  -0.15, 0.0]   → cartesian (1.240459, 1.192391, 0.350)
 *   goal  [0.5, -1.31, -0.15, 0.0]   → cartesian (1.429181, -0.100004, 0.350)
 * (cartesian poses computed with the REAL FK of the canonical SCARA —
 * a1 = 1.0, a2 = 0.8, base height 0.5 — see thalos-core/models/scara/spec.rs).
 * The middle motion (pick → place) interpolates q2 from +0.6 to −1.31,
 * passing through q2 = 0 (full extension) → the crossing event.
 */

import type { TaskDocument } from '@/shared/contracts'
import type { SceneData } from '@/features/viewport/types'

// ─── Scene (deterministic SCARA geometry — canonical: a1 1.0, a2 0.8, base 0.5)

/** The canonical SCARA as a viewport `SceneData`: four joint frames + links
 *  + z-axes + twists + the bolt/tray primitives at the crossing poses. Pure
 *  geometry — no assessment data. */
export function demoScene(): SceneData {
  return {
    frames: [
      { id: 'base', parent: null, translation: [0, 0, 0], rotation: [1, 0, 0, 0], style: null },
      { id: 'joint_1', parent: 'base', translation: [0, 0, 0.5], rotation: [1, 0, 0, 0], style: null },
      { id: 'joint_2', parent: 'joint_1', translation: [1.0, 0, 0.5], rotation: [1, 0, 0, 0], style: null },
      { id: 'joint_3', parent: 'joint_2', translation: [1.8, 0, 0.5], rotation: [1, 0, 0, 0], style: null },
      { id: 'flange', parent: 'joint_3', translation: [1.8, 0, 0.4], rotation: [1, 0, 0, 0], style: null },
    ],
    links: [
      { id: 'link-base', start: [0, 0, 0], end: [0, 0, 0.5] },
      { id: 'link-arm1', start: [0, 0, 0.5], end: [1.0, 0, 0.5] },
      { id: 'link-arm2', start: [1.0, 0, 0.5], end: [1.8, 0, 0.5] },
      { id: 'link-vertical', start: [1.8, 0, 0.5], end: [1.8, 0, 0.4] },
    ],
    jointAxes: [
      { origin: [0, 0, 0.5], axis: [0, 0, 1] },
      { origin: [1.0, 0, 0.5], axis: [0, 0, 1] },
      { origin: [1.8, 0, 0.5], axis: [0, 0, 1] },
      { origin: [1.8, 0, 0.5], axis: [0, 0, 1] },
    ],
    twists: [
      { origin: [0, 0, 0.5], linear: [0, 0, 0], angular: [0, 0, 1] },
      { origin: [1.0, 0, 0.5], linear: [0, 0, 0], angular: [0, 0, 1] },
      { origin: [1.8, 0, 0.5], linear: [0, 0, 1], angular: [0, 0, 0] },
      { origin: [1.8, 0, 0.5], linear: [0, 0, 0], angular: [0, 0, 1] },
    ],
    primitives: [
      {
        id: 'bolt-1',
        frameId: 'base',
        translation: [1.240459, 1.192391, 0.35],
        rotation: [1, 0, 0, 0],
        geometry: { type: 'cylinder', radius: 0.02, height: 0.04 },
        color: [0.8, 0.6, 0.2, 1],
      },
      {
        id: 'tray-1',
        frameId: 'base',
        translation: [1.429181, -0.100004, 0.35],
        rotation: [1, 0, 0, 0],
        geometry: { type: 'box', width: 0.12, height: 0.02, depth: 0.12 },
        color: [0.3, 0.6, 0.9, 1],
      },
    ],
    referenceDimension: 1,
  }
}

// ─── Task (Pick → Wait → Place → Home, middle-segment crossing)

/** The deterministic task program: pick the bolt at the CROSS pose, wait,
 *  place it on the tray at the GOAL pose, return home. The pick → place leg
 *  is the middle motion whose joint-space interpolation crosses full
 *  extension (the validated counterfactual event). No assessment data. */
export function demoTask(): TaskDocument {
  return {
    id: 'demo-scara-pick-place-home',
    metadata: {
      name: 'SCARA Pick → Wait → Place → Home',
      version: 1,
      created_at: '2026-08-13T00:00:00Z',
      modified_at: '2026-08-13T00:00:00Z',
    },
    scene: {
      objects: [
        {
          id: 'bolt-1',
          name: 'Bolt',
          // The CROSS pose (cartesian FK of the crossing joint target).
          pose: { position: [1.240459, 1.192391, 0.35], orientation: [1, 0, 0, 0] },
        },
      ],
      locations: [
        {
          id: 'tray-1',
          name: 'Tray',
          // The GOAL pose (cartesian FK of the same-side elbow joint target).
          pose: { position: [1.429181, -0.100004, 0.35], orientation: [1, 0, 0, 0] },
        },
      ],
      tools: [],
      // The HOME pose (cartesian FK of the seed's starting joint config).
      home_pose: { position: [1.206280, -0.772948, 0.4], orientation: [1, 0, 0, 0] },
      approach_height: 0.05,
    },
    program: {
      operations: [
        { type: 'pick', origin: 'op_1', object: 'bolt-1' },
        { type: 'wait', origin: 'op_2', duration: { secs: 1, nanos: 0 } },
        { type: 'place', origin: 'op_3', object: 'bolt-1', destination: 'tray-1' },
        { type: 'home', origin: 'op_4' },
      ],
    },
  }
}
