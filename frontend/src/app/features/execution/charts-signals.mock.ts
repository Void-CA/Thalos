// ── Mock data generators for Charts & Signals panel ──

/**
 * Generates a mock torque value from a joint position using
 * a structural wave + noise model.
 */
export function mockTorqueFromPosition(jointPosition: number, now: number): number {
  const t =
    0.3 * Math.sin(jointPosition * 2 + now / 2000) +
    0.1 * Math.sin(now / 500) +
    (Math.random() - 0.5) * 0.15 +
    0.15;
  return Math.max(0.01, t);
}

/**
 * Generates a mock current value proportional to torque + noise.
 */
export function mockCurrentFromTorque(torque: number): number {
  const c = torque * 2.5 + (Math.random() - 0.5) * 0.3 + 0.2;
  return Math.max(0.01, c);
}

/**
 * Mock network round-trip latency in milliseconds.
 */
export function mockLatency(): number {
  return Math.round(5 + Math.random() * 15);
}

/**
 * Mock jitter in milliseconds.
 */
export function mockJitter(): number {
  return Math.round(1 + Math.random() * 4);
}

/**
 * Check if a torque value exceeds the saturation threshold (0.85 Nm).
 */
export function isSaturated(torque: number): boolean {
  return torque > 0.85;
}

export const TORQUE_SATURATION_THRESHOLD = 0.85;
