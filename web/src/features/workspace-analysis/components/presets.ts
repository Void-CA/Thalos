/** Sampling presets — preset picks a samples count; advanced config overrides. */
export const WORKSPACE_PRESETS = [
  { key: 'quick', label: 'Quick 1k', samples: 1_000 },
  { key: 'balanced', label: 'Balanced 10k', samples: 10_000 },
  { key: 'precise', label: 'Precise 50k', samples: 50_000 },
] as const

export const DEFAULT_PRESET_KEY = 'balanced'
