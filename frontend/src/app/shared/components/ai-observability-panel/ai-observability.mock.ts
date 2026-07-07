import type {
  AiObservabilityState,
  ComponentFailureProbability,
  BayesianConfidence,
  SymbolicRuleExplanation,
  AiDecisionRecord,
} from '../../types/ai-observability.types';

// ── Helpers ──

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function rint(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

const JOINT_IDS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'];
const JOINT_NAMES = ['Joint 1', 'Joint 2', 'Joint 3', 'Joint 4', 'Joint 5', 'Joint 6'];

const RULE_TEMPLATES: Omit<SymbolicRuleExplanation, 'active' | 'firedAt'>[] = [
  { ruleId: 'R1', ruleName: 'JointLimit', trigger: 'J3 position > 2.5 rad', explanation: 'Joint limit detected at J3' },
  { ruleId: 'R2', ruleName: 'VelocityThreshold', trigger: 'J5 velocity > 1.2 rad/s', explanation: 'Velocity exceeded threshold J5' },
  { ruleId: 'R3', ruleName: 'SingularityAvoidance', trigger: 'det(Jacobian) < 0.01', explanation: 'Singularity approach detected' },
  { ruleId: 'R4', ruleName: 'TorqueLimit', trigger: 'J2 torque > 85% rated', explanation: 'Torque spike on shoulder joint' },
  { ruleId: 'R5', ruleName: 'SelfCollision', trigger: 'link-dist(J3, J5) < 0.05 m', explanation: 'Self-collision risk between J3 and J5' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMockData(): AiObservabilityState {
  // ── Failure probabilities — mostly low with occasional spikes ──
  const failureProbabilities: ComponentFailureProbability[] = JOINT_IDS.map((id, i) => ({
    componentId: id,
    componentName: JOINT_NAMES[i],
    probability: Math.round(rand(0, 0.45) ** 1.5 * 100) / 100,
    trend: pick(['stable', 'stable', 'increasing', 'decreasing'] as const),
  }));

  // Optionally spike one joint higher
  const spikeIdx = rint(0, 5);
  failureProbabilities[spikeIdx].probability = Math.round(rand(0.5, 0.85) * 100) / 100;
  failureProbabilities[spikeIdx].trend = pick(['increasing', 'increasing', 'stable'] as const);

  // ── Bayesian confidence — overall ~0.85 ──
  const bayesianConfidence: BayesianConfidence = {
    overall: Math.round(rand(0.78, 0.94) * 100) / 100,
    perComponent: JOINT_IDS.map((id) => ({
      componentId: id,
      confidence: Math.round(rand(0.6, 0.98) * 100) / 100,
    })),
  };

  // ── Active rules — 3–5, some inactive ──
  const ruleCount = rint(3, 5);
  const shuffled = [...RULE_TEMPLATES].sort(() => Math.random() - 0.5);
  const now = new Date();
  const activeRules: SymbolicRuleExplanation[] = shuffled.slice(0, ruleCount).map((tpl, i) => ({
    ...tpl,
    active: i < ruleCount - 1, // last one inactive for variety
    firedAt: new Date(now.getTime() - rint(0, 30000)).toISOString(),
  }));

  // ── Decision history — last 10, newest first ──
  const decisionHistory: AiDecisionRecord[] = [];
  for (let i = 0; i < 10; i++) {
    const joint = rint(1, 6);
    const ts = new Date(now.getTime() - i * rint(200, 2000));
    decisionHistory.push({
      timestamp: ts.toISOString(),
      decision: `J${joint}:${pick(['IK solve', 'Filter update', 'Prediction step'])}`,
      joint,
      measurement: Math.round(rand(-1.5, 1.5) * 1000) / 1000,
      estimation: Math.round(rand(-1.5, 1.5) * 1000) / 1000,
      delta: 0,
      confidence: Math.round(rand(0.82, 0.995) * 100) / 100,
    });
    // compute delta post-hoc
    decisionHistory[i].delta =
      Math.round(Math.abs(decisionHistory[i].measurement - decisionHistory[i].estimation) * 1000) / 1000;
  }

  return { failureProbabilities, bayesianConfidence, activeRules, decisionHistory };
}
