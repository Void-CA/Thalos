"""Figure 4: Candidate ranking — stacked bar chart of J components."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..config import COLORS, FIGURE_DPI, FIGURE_SIZE, J_WEIGHTS


def render_candidate_ranking(scenario: str, evidence: dict, output_path: str) -> None:
    ranking = evidence.get("candidate_ranking", {})
    strategies = ranking.get("ranked", [])
    selected = ranking.get("selected", "")

    fig, ax = plt.subplots(figsize=FIGURE_SIZE, dpi=FIGURE_DPI)

    if not strategies:
        ax.text(0.5, 0.5, "No candidate ranking available",
                ha="center", va="center", fontsize=14, color="gray",
                transform=ax.transAxes)
        ax.set_title(f"{scenario} — Candidate Ranking")
        fig.tight_layout()
        fig.savefig(output_path)
        plt.close(fig)
        return

    names = [s.get("strategy", "?") for s in strategies]
    n = len(names)
    x = np.arange(n)

    # Compute weighted components for each strategy
    risk_vals = [s.get("risk", 0.0) * J_WEIGHTS["risk"] for s in strategies]
    dur_vals = [s.get("duration", 0.0) * J_WEIGHTS["duration"] for s in strategies]
    manip_vals = [(1.0 - s.get("manipulability", 0.0)) * J_WEIGHTS["manipulability"]
                  for s in strategies]
    len_vals = [s.get("length", 0.0) * J_WEIGHTS["length"] for s in strategies]

    bottom = np.zeros(n)
    component_data = [
        ("risk (0.5)", risk_vals, COLORS["accent"]),
        ("duration (0.2)", dur_vals, COLORS["warning"]),
        ("1 - manip (0.2)", manip_vals, COLORS["primary"]),
        ("length (0.1)", len_vals, COLORS["muted"]),
    ]

    for label, vals, color in component_data:
        vals_arr = np.array(vals)
        ax.bar(x, vals_arr, bottom=bottom, width=0.55, label=label,
               color=color, alpha=0.85, edgecolor="white", linewidth=0.8)
        bottom += vals_arr

    # J scores as text above bars
    j_scores = [s.get("cost", r + d + m + l)
                for s, r, d, m, l in zip(strategies, risk_vals, dur_vals,
                                          manip_vals, len_vals)]
    for i, j in enumerate(j_scores):
        ax.text(i, bottom[i] + 0.005, f"J={j:.4f}",
                ha="center", va="bottom", fontsize=8, fontweight="bold")

    # Highlight selected
    for i, name in enumerate(names):
        if name == selected:
            ax.get_children()[i * 4].set_edgecolor(COLORS["accent"])
            ax.get_children()[i * 4].set_linewidth(2.5)
            ax.text(i, -0.02, "★", ha="center", va="top", fontsize=14,
                    color=COLORS["accent"])

    ax.set_xticks(x)
    ax.set_xticklabels(names, fontsize=10)
    ax.set_ylabel("Weighted J Components")
    ax.set_title(f"{scenario} — Candidate Ranking\n"
                 f"J = 0.5·risk + 0.2·dur + 0.2·(1-manip) + 0.1·len",
                 fontsize=11)
    ax.set_ylim(0, max(bottom) * 1.25 if max(bottom) > 0 else 1.0)
    ax.grid(True, alpha=0.3, axis="y")
    ax.legend(fontsize=7, loc="upper right", ncol=2)

    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
