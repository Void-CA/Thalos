export interface ComponentFailureProbability {
  componentId: string;
  componentName: string;
  probability: number; // 0..1
  trend: 'stable' | 'increasing' | 'decreasing';
}

export interface BayesianConfidence {
  overall: number; // 0..1
  perComponent: { componentId: string; confidence: number }[];
}

export interface SymbolicRuleExplanation {
  ruleId: string;
  ruleName: string;
  trigger: string;
  explanation: string;
  active: boolean;
  firedAt: string; // ISO timestamp
}

export interface AiDecisionRecord {
  timestamp: string;
  decision: string;
  joint: number;
  measurement: number;
  estimation: number;
  delta: number;
  confidence: number;
}

export interface AiObservabilityState {
  failureProbabilities: ComponentFailureProbability[];
  bayesianConfidence: BayesianConfidence;
  activeRules: SymbolicRuleExplanation[];
  decisionHistory: AiDecisionRecord[];
}
