"""Figure 2: Quality before/after (repair comparison or baseline)."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..config import COLORS, FIGURE_DPI, FIGURE_SIZE


def render_quality(scenario: str, evidence: dict, output_path: str) -> None:
    summary = evidence.get("summary", {})
    actions = evidence.get("actions", [])
    quality_index = summary.get("quality_index", 0.0)

    fig, ax = plt.subplots(figsize=FIGURE_SIZE, dpi=FIGURE_DPI)

    has_repair = len(actions) > 0

    if has_repair:
        # Attempt to find before/after quality from candidate ranking or metrics
        ranking = evidence.get("candidate_ranking", {})
        ranked = ranking.get("ranked", [])

        # Before = baseline quality, After = best candidate quality (if any)
        before = quality_index
        after = quality_index  # default: same if no improvement data

        # Try to derive improvement from strategy comparison if available
        if ranked:
            selected = ranking.get("selected", "")
            for r in ranked:
                if r.get("strategy") == selected:
                    # Use risk as proxy: quality ~ 1 - risk
                    after = 1.0 - r.get("risk", 1.0 - quality_index)
                    break

        x = np.arange(2)
        bars = ax.bar(x, [before, after], width=0.5,
                      color=[COLORS["primary"], COLORS["secondary"]],
                      edgecolor="white", linewidth=1.2)
        ax.set_xticks(x)
        ax.set_xticklabels(["Before", "After"], fontsize=11)

        for bar, val in zip(bars, [before, after]):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                    f"{val:.3f}", ha="center", va="bottom", fontsize=10, fontweight="bold")

        delta = after - before
        sign = "+" if delta >= 0 else ""
        ax.text(0.5, 0.95, f"Δ = {sign}{delta:.3f}",
                ha="center", va="top", transform=ax.transAxes,
                fontsize=10, color=COLORS["secondary"] if delta >= 0 else COLORS["accent"],
                fontweight="bold")
    else:
        ax.bar([0], [quality_index], width=0.4,
               color=COLORS["primary"], edgecolor="white", linewidth=1.2)
        ax.set_xticks([0])
        ax.set_xticklabels(["Baseline"], fontsize=11)
        ax.text(0, quality_index + 0.01, f"{quality_index:.3f}",
                ha="center", va="bottom", fontsize=10, fontweight="bold")
        ax.text(0.5, 0.5, "No repair attempted", ha="center", va="center",
                fontsize=12, color="gray", style="italic",
                transform=ax.transAxes)

    ax.set_ylabel("Quality Index")
    ax.set_title(f"{scenario} — Quality Assessment")
    ax.set_ylim(0, 1.1)
    ax.grid(True, alpha=0.3, axis="y")

    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
