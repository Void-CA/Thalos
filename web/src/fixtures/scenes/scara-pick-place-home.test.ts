import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoScene, demoTask } from './scara-pick-place-home'

/**
 * Demo fixture tests (spec candidate-alternatives-demo "Demo Reproducibility").
 *
 * The fixture is SCENE-ONLY: it defines the deterministic geometry + task that
 * PROVOKES the counterfactual. It carries NO recorded pipeline output — the
 * counterfactual numbers EMERGE from the live backend pipeline and are proven
 * by the API integration test
 * `analyze_live_pipeline_returns_candidate_ranking_with_alternate_elbow`
 * (`backend/crates/thalos-api/tests/api_tests.rs`, the production composition:
 * load Scara → joints at the seed home → schedule the crossing → analyze →
 * candidate_ranking with Direct + AlternateElbow, selected AlternateElbow,
 * AlternateElbow risk < Direct risk).
 */

describe('demo fixture — scene + task configuration', () => {
  it('defines a deterministic SCARA scene (pure geometry, no assessment data)', () => {
    const scene = demoScene()
    expect(scene.referenceDimension).toBe(1)
    expect(scene.frames.map((f) => f.id)).toEqual([
      'base',
      'joint_1',
      'joint_2',
      'joint_3',
      'flange',
    ])
    expect(scene.primitives.map((p) => p.id)).toEqual(['bolt-1', 'tray-1'])
    // The primitives sit at the crossing poses (bolt @ cross, tray @ goal).
    expect(scene.primitives[0].translation).toEqual([1.240459, 1.192391, 0.35])
    expect(scene.primitives[1].translation).toEqual([1.429181, -0.100004, 0.35])
  })

  it('defines the Pick → Wait → Place → Home task with the middle-segment crossing', () => {
    const task = demoTask()
    expect(task.program.operations.map((op) => op.type)).toEqual([
      'pick',
      'wait',
      'place',
      'home',
    ])
    // The pick (bolt @ cross) → place (tray @ goal) leg is the MIDDLE motion.
    expect(task.scene.objects[0].id).toBe('bolt-1')
    expect(task.scene.locations[0].id).toBe('tray-1')
    const ops = task.program.operations
    expect(ops[0]).toMatchObject({ type: 'pick', object: 'bolt-1' })
    expect(ops[2]).toMatchObject({ type: 'place', destination: 'tray-1' })
    expect(ops[1]).toMatchObject({ type: 'wait', duration: { secs: 1, nanos: 0 } })
  })
})

describe('demo fixture — SCENE-ONLY (no recorded pipeline output)', () => {
  it('the production fixture carries NO recorded counterfactual numbers and NO ranking (they emerge from the live pipeline)', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'scara-pick-place-home.ts'),
      'utf8',
    )
    // The recorded demo-instance literals must never live in the production
    // fixture — the live backend pipeline produces them (proven by the API
    // integration test). Only test files may reference them.
    expect(source).not.toContain('0.5571')
    expect(source).not.toContain('0.1625')
    // No recorded wire data of any shape: no report builder, no ranking object.
    expect(source).not.toContain('demoReport')
    expect(source).not.toContain('ranked:')
  })
})
