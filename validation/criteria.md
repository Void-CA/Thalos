# Thalos Intelligence — Validation Criteria

## What "works correctly" means

Intelligence works correctly when it:

1. **Detects** the anomalous condition (LowManipulability, singularity, etc.)
2. **Infers** the correct rules (R07, R08, etc.)
3. **Generates** at least one valid alternative
4. **Validates** IK solutions (converged, within limits)
5. **Diversifies** kinematically different solutions (when applicable)
6. **Scores** J consistently with component metrics
7. **Selects** the candidate with the best J
8. **Executes** the selected trajectory

## Check Classification

### UNIVERSAL (all scenarios)

| Check | What it verifies | PASS criterion |
|---|---|---|
| OBS_DETECTED | Intelligence observed the condition | observations non-empty |
| INFERENCE_OK | Correct rules triggered | triggered_rules non-empty, risk valid |
| CANDIDATES_GENERATED | Alternatives generated | ≥2 generated in strategy_trace |
| IK_SOLUTIONS_VALID | IK solutions converged | All candidates have valid metrics |
| CARTESIAN_ERROR | Solutions reach target | All candidates have finite, non-negative metrics |
| JOINT_LIMITS | Solutions respect limits | Candidates passed admissibility gate |
| METRICS_VALID | Metrics are valid numbers | All metrics >= 0 and finite |
| J_SCORES_VALID | J scores consistent | J in [0, 1] for all candidates |
| SELECTION_CONSISTENT | Selection matches argmin(J) | selected == strategy with lowest J |
| EXECUTION_CONSISTENT | Execution matches selection | selected_strategy == executed_strategy |

### STRATEGY-SPECIFIC (conditional)

| Check | When it applies | PASS criterion |
|---|---|---|
| IK_DIVERSITY | AlternateElbow on 6+ DOF robots | Δduration > 0.5s (proxy for Δq) |

## Scenario Matrix

### 6dof-near-singular

| Hypothesis | Expected | Evidence |
|---|---|---|
| Detection | LowManipulability at WP 0 | value=0.027 < threshold=0.3 |
| Inference | R07 triggered | triggered_rules includes R07_low_manipulability |
| Generation | Direct + AlternateElbow | strategy_trace shows 2 generated |
| IK Diversity | Different configurations | Δduration > 0.5s |
| Scoring | Direct J < AlternateElbow J | 0.25 < 0.75 |
| Selection | Direct selected | selected == Direct |

### 6dof-elbow-swap

| Hypothesis | Expected | Evidence |
|---|---|---|
| Detection | LowManipulability at WP 0 | value=0.027 < threshold=0.3 |
| Inference | R07 triggered | triggered_rules includes R07_low_manipulability |
| Generation | Direct + AlternateElbow | strategy_trace shows 2 generated |
| IK Diversity | Different configurations | Δduration > 0.5s |
| Scoring | Direct J < AlternateElbow J | 0.25 < 0.75 |
| Selection | Direct selected | selected == Direct |

## Tolerances

| Parameter | Default | Description |
|---|---|---|
| cartesian_error_max | 1e-3 m | Max IK error |
| ik_diversity_min | 0.1 rad | Min Δq for diversity |
| j_recomputation_epsilon | 1e-6 | Max J recomputation error |
| manipulability_min | 0.0 | Min manipulability |
| risk_max | 1.0 | Max risk |
| duration_min | 0.0 | Min duration |

## Reproducibility

Each validation run produces:
- `evidence.json` — raw data from pipeline
- `validation.json` — check results (machine-readable)
- `figures/*.png` — minimal visual evidence
- Terminal summary — human-readable pass/fail

The `run_id` encodes: `{scenario}-{commit_hash}`.
Results are deterministic for the same commit and inputs.
