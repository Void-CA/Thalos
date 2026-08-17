"""Minimal figure generator — only figures that prove something."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import json
from pathlib import Path

from .checks import J_WEIGHTS


def generate_figures(evidence: dict, output_dir: str, scenario: str):
    """Generate minimal figures that prove specific claims."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Figure 1: Decision cascade (proves the causal chain)
    _fig_decision_cascade(evidence, scenario, f"{output_dir}/{scenario}-decision-cascade.png")

    # Figure 2: Candidate anatomy (proves why one won)
    _fig_candidate_anatomy(evidence, scenario, f"{output_dir}/{scenario}-candidate-anatomy.png")

    # Figure 3: Manipulability (proves the condition detected)
    _fig_manipulability(evidence, scenario, f"{output_dir}/{scenario}-manipulability.png")

    # Figure 4: Trajectory comparison (only if trajectories differ)
    ranking = evidence.get("intelligence", {}).get("candidate_ranking") or {}
    ranked = ranking.get("ranked", [])
    if len(ranked) >= 2:
        durations = [c.get("duration", 0) for c in ranked]
        if max(durations) - min(durations) > 0.5:
            _fig_trajectory_comparison(evidence, scenario, f"{output_dir}/{scenario}-trajectory-comparison.png")


def _fig_decision_cascade(evidence: dict, scenario: str, path: str):
    """Decision cascade: observation → inference → generation → evaluation → decision → execution."""
    intel = evidence.get("intelligence", {})
    observations = intel.get("observations", [])
    assessment = intel.get("assessment", {})
    ranking = intel.get("candidate_ranking") or {}
    baseline = evidence.get("baseline", {})

    fig, ax = plt.subplots(figsize=(8, 12), dpi=100)
    ax.axis("off")
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 14)

    stages = [
        ("OBSERVATION", _observation_text(observations), "#DD8452"),
        ("INFERENCE", _inference_text(assessment), "#8172B3"),
        ("GENERATION", _generation_text(ranking), "#4C72B0"),
        ("EVALUATION", _evaluation_text(ranking), "#C44E52"),
        ("DECISION", _decision_text(ranking), "#55A868"),
        ("EXECUTION", _execution_text(baseline, ranking), "#937860"),
    ]

    y = 12.5
    for title, content, color in stages:
        rect = mpatches.FancyBboxPatch(
            (1, y - 1.5), 8, 1.5,
            boxstyle="round,pad=0.1",
            facecolor=color, alpha=0.2,
            edgecolor=color, linewidth=2
        )
        ax.add_patch(rect)
        ax.text(1.3, y - 0.3, title, fontsize=11, fontweight="bold", color=color)
        ax.text(1.3, y - 0.7, content, fontsize=8, fontfamily="monospace", verticalalignment="top")
        y -= 2.0

        if title != "EXECUTION":
            ax.annotate("", xy=(5, y + 0.3), xytext=(5, y + 0.7),
                       arrowprops=dict(arrowstyle="->", color="gray", lw=1.5))

    ax.set_title(f"{scenario} — Decision Cascade", fontsize=13, fontweight="bold", pad=15)
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def _fig_candidate_anatomy(evidence: dict, scenario: str, path: str):
    """Candidate anatomy: detailed J breakdown."""
    ranking = evidence.get("intelligence", {}).get("candidate_ranking") or {}
    ranked = ranking.get("ranked", [])
    selected = ranking.get("selected", "")

    if not ranked:
        return

    fig, ax = plt.subplots(figsize=(8, 4), dpi=100)
    ax.axis("off")

    headers = ["Metric", "Weight"]
    for c in ranked:
        s = c.get("strategy", "?")
        marker = " *" if s == selected else ""
        headers.append(f"{s}{marker}")
    headers.append("Δ")

    metrics = [
        ("Risk", "risk", J_WEIGHTS["risk"]),
        ("Duration (s)", "duration", J_WEIGHTS["duration"]),
        ("Manipulability", "manipulability", J_WEIGHTS["manipulability"]),
        ("Path Length (m)", "length", J_WEIGHTS["length"]),
    ]

    rows = []
    for label, key, weight in metrics:
        vals = [c.get(key, 0) for c in ranked]
        delta = vals[1] - vals[0] if len(vals) >= 2 else 0
        rows.append([label, f"{weight:.1f}"] + [f"{v:.4f}" for v in vals] + [f"{delta:+.4f}"])

    d_cost = ranked[0].get("cost", 0) if ranked else 0
    a_cost = ranked[1].get("cost", 0) if len(ranked) >= 2 else 0
    rows.append(["J (total)", "1.0", f"{d_cost:.4f}", f"{a_cost:.4f}", f"{a_cost - d_cost:+.4f}"])

    cell_data = rows
    col_colors = ["#4C72B0"] * len(headers)

    table = ax.table(
        cellText=cell_data,
        colLabels=headers,
        loc="center",
        colColours=col_colors,
    )
    table.auto_set_font_size(False)
    table.set_fontsize(9)
    table.scale(1.0, 1.5)

    for j in range(len(headers)):
        table[0, j].set_text_props(color="white", fontweight="bold")

    ax.set_title(f"{scenario} — Candidate Anatomy (Selected: {selected})", fontsize=11, fontweight="bold", pad=12)
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def _fig_manipulability(evidence: dict, scenario: str, path: str):
    """Manipulability profile: proves the condition detected."""
    series = evidence.get("intelligence", {}).get("manipulability_series", [])

    if not series:
        return

    fig, ax = plt.subplots(figsize=(8, 4), dpi=100)

    xs = [p.get("waypoint", i) for i, p in enumerate(series)]
    ys = [p.get("normalized_yoshikawa", p.get("yoshikawa", 0)) for p in series]

    ax.plot(xs, ys, color="#4C72B0", linewidth=1.5, label="Manipulability")
    ax.fill_between(xs, 0, ys, alpha=0.15, color="#4C72B0")

    # Threshold line
    threshold = 0.3
    ax.axhline(y=threshold, color="#C44E52", linestyle="--", linewidth=1, label=f"Threshold ({threshold})")

    ax.set_xlabel("Waypoint")
    ax.set_ylabel("Manipulability")
    ax.set_title(f"{scenario} — Manipulability Profile")
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(fontsize=8)

    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def _fig_trajectory_comparison(evidence: dict, scenario: str, path: str):
    """Trajectory comparison: only when trajectories differ."""
    baseline_traj = evidence.get("baseline", {}).get("trajectory", {}).get("waypoints", [])
    selected_traj = evidence.get("selected", {}).get("trajectory", {}).get("waypoints", [])

    if not baseline_traj or not selected_traj:
        return

    # Check if they're actually different
    if len(baseline_traj) == len(selected_traj):
        max_diff = max(
            abs(baseline_traj[i][j] - selected_traj[i][j])
            for i in range(min(len(baseline_traj), len(selected_traj)))
            for j in range(len(baseline_traj[0]))
        )
        if max_diff < 1e-4:
            return  # Identical — don't plot

    fig, axes = plt.subplots(2, 2, figsize=(8, 6), dpi=100)
    axes = axes.flatten()

    n_joints = min(len(baseline_traj[0]), 4) if baseline_traj else 0
    for j in range(n_joints):
        ax = axes[j]
        base_vals = [wp[j] for wp in baseline_traj]
        sel_vals = [wp[j] for wp in selected_traj]

        ax.plot(base_vals, color="#4C72B0", linewidth=1.2, label="Baseline")
        ax.plot(sel_vals, color="#DD8452", linewidth=1.2, linestyle="--", label="Selected")
        ax.set_title(f"J{j+1}")
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=7)

    for j in range(n_joints, 4):
        axes[j].set_visible(False)

    fig.suptitle(f"{scenario} — Trajectory Comparison", fontsize=11, fontweight="bold")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def _observation_text(observations):
    if not observations:
        return "No observations"
    obs = observations[0]
    kind = obs.get("kind", "?")
    value = obs.get("attributes", {}).get("value", {}).get("Number", "?")
    threshold = obs.get("attributes", {}).get("threshold", {}).get("Number", "?")
    return f"{kind}\n  value={value}, threshold={threshold}"


def _inference_text(assessment):
    risk = assessment.get("risk", "?")
    rules = assessment.get("triggered_rules", [])
    rule_ids = [r.get("id", "?") for r in rules[:3]]
    return f"risk={risk}\n  rules: {', '.join(rule_ids)}"


def _generation_text(ranking):
    trace = ranking.get("strategy_trace", [])
    generated = [t.get("strategy", "?") for t in trace if t.get("outcome", {}).get("kind") == "generated"]
    skipped = [t.get("strategy", "?") for t in trace if t.get("outcome", {}).get("kind") == "skipped"]
    return f"generated: {', '.join(generated)}\n  skipped: {', '.join(skipped)}"


def _evaluation_text(ranking):
    ranked = ranking.get("ranked", [])
    lines = []
    for c in ranked:
        s = c.get("strategy", "?")
        j = c.get("cost", 0)
        lines.append(f"{s}: J={j:.4f}")
    return "\n  ".join(lines)


def _decision_text(ranking):
    selected = ranking.get("selected", "?")
    return f"selected: {selected}\n  (lowest J score)"


def _execution_text(baseline, ranking):
    selected = ranking.get("selected", "?")
    waypoints = len(baseline.get("trajectory", {}).get("waypoints", []))
    return f"executed: {selected}\n  trajectory: {waypoints} waypoints"
