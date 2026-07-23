/**
 * NOTE: These tests require vitest + @analogjs/vitest-angular to execute.
 * The project has no test runner configured for frontend yet.
 *
 * These specs document the expected behavior for when the test infrastructure
 * is in place and serve as manual verification checklists.
 */

// import { ProjectStateStore } from './project-state.store';
// import type { ProjectState } from '../types/project-state';

// ── Test plan ──

// Given: no robot loaded (runtime === null)
//   → state should be 'no_robot'
//
// Given: robot loaded (runtime.robot exists), no active plan
//   → state should be 'robot_loaded'
//
// Given: robot loaded, active plan exists, no analysis result
//   → state should be 'plan_compiled', isPlanCompiled === true
//
// Given: robot loaded, active plan exists, analysis has result
//   → state should be 'plan_analyzed', isPlanCompiled === true, isPlanAnalyzed === true
//
// Given: active plan transitions from non-null to null (plan deleted)
//   → state should transition from plan_compiled/plan_analyzed to robot_loaded
//   → isPlanCompiled should become false
