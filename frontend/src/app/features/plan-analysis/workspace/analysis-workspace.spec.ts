/**
 * NOTE: These tests require vitest + @analogjs/vitest-angular to execute.
 * The project has no test runner configured for frontend yet.
 */

// ── Test plan ──
//
// AnalysisWorkspace is now a presentational component:
//   @Input() projectState: ProjectState
//   @Input() hasResult: boolean
//   @Output() analyze = EventEmitter<void>
//   @Output() close = EventEmitter<void>
//
// Given: projectState is 'no_robot' or 'robot_loaded'
//   → emptyState should be 'not-available'
//   → Template should show: "Compilá un plan para analizar la trayectoria."
//   → No analyze button, no close button check
//
// Given: projectState is 'plan_compiled', hasResult is false
//   → emptyState should be 'not-analyzed'
//   → Template should show: "Este plan no se ha analizado aún." + "Analizar plan" button
//   → Clicking "Analizar plan" should emit analyze event
//
// Given: projectState is 'plan_compiled' or 'plan_analyzed', hasResult is true
//   → emptyState should be 'ready'
//   → Template should show: "Analysis content will appear here."
//
// Given: close button is clicked
//   → close event should be emitted
