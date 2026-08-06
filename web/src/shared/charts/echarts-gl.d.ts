/**
 * Ambient declarations for echarts-gl 2.1.0 (no type definitions shipped).
 *
 * The GL frontier (`gl-adapter.ts`) is the only consumer. The installers are
 * typed as the plain functions the ECharts `use([...])` registry accepts, so
 * no echarts-gl internals leak into the rest of the app.
 */

declare module 'echarts-gl' {
  const installAll: () => void
  export default installAll
}

declare module 'echarts-gl/charts' {
  export const Line3DChart: (registers: unknown) => void
  export const Scatter3DChart: (registers: unknown) => void
  export const Bar3DChart: (registers: unknown) => void
}

declare module 'echarts-gl/components' {
  export const Grid3DComponent: (registers: unknown) => void
}
