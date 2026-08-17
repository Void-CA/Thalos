"""Cross-scenario summary figures and data."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .config import COLORS, FIGURE_DPI, FIGURE_SIZE, SCENARIO_LABELS
from .io import summary_path


def render_summary_figures(evidence: dict, output_dir: str) -> dict:
    """Generate summary-risk.png and summary-j.png, return summary data."""
    scenarios = list(evidence.keys())
    labels = [SCENARIO_LABELS.get(s, s) for s in scenarios]

    risks = []
    qualities = []
    j_scores = []
    selected_strategies = []
    candidates_counts = []
    has_repair = []

    for s in scenarios:
        ev = evidence[s]
        assessment = ev.get("assessment", {})
        ranking = ev.get("candidate_ranking", {})
        summary = ev.get("summary", {})

        risks.append(assessment.get("risk", "unknown"))
        qualities.append(summary.get("quality_index", 0.0))
        selected_strategies.append(ranking.get("selected", "none"))
        candidates_counts.append(len(ranking.get("ranked", [])))
        has_repair.append(len(ev.get("actions", [])) > 0)

        ranked = ranking.get("ranked", [])
        selected_name = ranking.get("selected", "")
        j_val = 0.0
        for r in ranked:
            if r.get("strategy") == selected_name:
                j_val = r.get("cost", 0.0)
                break
        j_scores.append(j_val)

    # Summary risk figure
    risk_map = {"low": 0.1, "medium": 0.375, "high": 0.625, "critical": 0.875}
    risk_vals = [risk_map.get(r, 0.5) for r in risks]

    fig, ax = plt.subplots(figsize=FIGURE_SIZE, dpi=FIGURE_DPI)
    bars = ax.bar(range(len(scenarios)), risk_vals,
                  color=[COLORS["accent"] if v >= 0.75 else
                         COLORS["warning"] if v >= 0.5 else
                         COLORS["secondary"] for v in risk_vals],
                  edgecolor="white", linewidth=1.2)
    ax.set_xticks(range(len(scenarios)))
    ax.set_xticklabels(labels, fontsize=9, rotation=15, ha="right")
    ax.set_ylabel("Risk (mapped)")
    ax.set_title("Cross-Scenario Risk Comparison")
    ax.set_ylim(0, 1.1)

    # Threshold lines
    for level, (name, val) in enumerate([("Low/Med", 0.25), ("Med/High", 0.5), ("High/Crit", 0.75)]):
        ax.axhline(y=val, color="#999", linestyle="--", linewidth=0.8, alpha=0.6)
        ax.text(len(scenarios) - 0.5, val + 0.01, name, fontsize=6, color="#999", ha="right")

    fig.tight_layout()
    fig.savefig(str(summary_path(output_dir, "risk")))
    plt.close(fig)

    # Summary J figure
    fig, ax = plt.subplots(figsize=FIGURE_SIZE, dpi=FIGURE_DPI)
    bars = ax.bar(range(len(scenarios)), j_scores,
                  color=[COLORS["primary"]] * len(scenarios),
                  edgecolor="white", linewidth=1.2)
    ax.set_xticks(range(len(scenarios)))
    ax.set_xticklabels(labels, fontsize=9, rotation=15, ha="right")
    ax.set_ylabel("J Score (selected)")
    ax.set_title("Cross-Scenario J Score Comparison")
    for i, j in enumerate(j_scores):
        ax.text(i, j + 0.001, f"{j:.4f}", ha="center", va="bottom", fontsize=8)
    fig.tight_layout()
    fig.savefig(str(summary_path(output_dir, "j")))
    plt.close(fig)

    # Summary table data
    summary_data = []
    for i, s in enumerate(scenarios):
        summary_data.append({
            "scenario": SCENARIO_LABELS.get(s, s),
            "scenario_id": s,
            "verdict": risks[i],
            "quality": qualities[i],
            "selected_strategy": selected_strategies[i],
            "j": j_scores[i],
            "candidates_count": candidates_counts[i],
            "has_repair": has_repair[i],
        })

    return {
        "summary_data": summary_data,
    }


def render_summary_table_html(summary_data: list) -> str:
    """Return raw HTML for the cross-scenario summary table."""
    rows = []
    for row in summary_data:
        verdict_cls = f"verdict-{row['verdict']}"
        rows.append(
            f"<tr>"
            f"<td>{row['scenario']}</td>"
            f"<td class=\"{verdict_cls}\">{row['verdict'].upper()}</td>"
            f"<td>{row['quality']:.3f}</td>"
            f"<td>{row['selected_strategy']}</td>"
            f"<td>{row['j']:.4f}</td>"
            f"<td>{row['candidates_count']}</td>"
            f"<td>{'Yes' if row['has_repair'] else 'No'}</td>"
            f"</tr>"
        )

    return f"""
    <table class="summary-table">
      <thead>
        <tr>
          <th>Scenario</th><th>Verdict</th><th>Quality</th>
          <th>Selected Strategy</th><th>J Score</th><th>Candidates</th><th>Repair</th>
        </tr>
      </thead>
      <tbody>
        {''.join(rows)}
      </tbody>
    </table>
    """
