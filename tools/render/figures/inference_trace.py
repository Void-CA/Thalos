"""Figure 3: Inference trace timeline (rules fired in order)."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch

from ..config import COLORS, FIGURE_DPI, FIGURE_SIZE


SEVERITY_COLORS = {
    "low": COLORS["secondary"],
    "medium": "#DDAA33",
    "high": COLORS["warning"],
    "critical": COLORS["accent"],
}


def _rule_color(entry: dict) -> str:
    """Infer color from bindings or derived_output."""
    derived = entry.get("derived_output", {})
    if derived.get("critical", False):
        return SEVERITY_COLORS["critical"]
    if derived.get("danger_zone", False):
        return SEVERITY_COLORS["high"]
    if any("low" in str(v).lower() for v in derived.values()):
        return SEVERITY_COLORS["medium"]
    return SEVERITY_COLORS["low"]


def render_inference_trace(scenario: str, evidence: dict, output_path: str) -> None:
    assessment = evidence.get("assessment", {})
    trace = assessment.get("trace", [])

    fig, ax = plt.subplots(figsize=FIGURE_SIZE, dpi=FIGURE_DPI)

    if not trace:
        ax.text(0.5, 0.5, "No inference trace available",
                ha="center", va="center", fontsize=14, color="gray",
                transform=ax.transAxes)
        ax.set_title(f"{scenario} — Inference Trace")
        ax.axis("off")
        fig.tight_layout()
        fig.savefig(output_path)
        plt.close(fig)
        return

    ax.set_xlim(0, 10)
    ax.set_ylim(-0.5, len(trace) - 0.5)
    ax.axis("off")
    ax.set_title(f"{scenario} — Inference Trace", fontsize=13, fontweight="bold", pad=15)

    box_width = 8.5
    box_height = 0.7
    x_start = 0.75
    y_step = 1.2

    for i, entry in enumerate(trace):
        y = (len(trace) - 1 - i) * y_step
        color = _rule_color(entry)

        # Box
        bbox = FancyBboxPatch(
            (x_start, y - box_height / 2), box_width, box_height,
            boxstyle="round,pad=0.1",
            facecolor=color, alpha=0.18, edgecolor=color, linewidth=1.5
        )
        ax.add_patch(bbox)

        # Rule name
        rule_id = entry.get("rule_id", "?")
        priority = entry.get("priority", "?")
        ax.text(x_start + 0.2, y + 0.12, f"R{rule_id}",
                fontsize=8, fontweight="bold", color=color, va="center")

        # Bindings
        bindings = entry.get("bindings", {})
        binding_str = ", ".join(f"{k}={v}" for k, v in list(bindings.items())[:3])
        ax.text(x_start + 0.2, y - 0.12, binding_str,
                fontsize=7, color="#555", va="center")

        # Priority badge
        ax.text(x_start + box_width - 0.3, y, f"P{priority}",
                fontsize=7, ha="right", va="center", color=color,
                bbox=dict(boxstyle="round,pad=0.15", facecolor=color, alpha=0.25))

        # Arrow to next box
        if i < len(trace) - 1:
            next_y = (len(trace) - 1 - (i + 1)) * y_step
            ax.annotate("", xy=(x_start + box_width / 2, next_y + box_height / 2),
                        xytext=(x_start + box_width / 2, y - box_height / 2),
                        arrowprops=dict(arrowstyle="->", color="#999", lw=1.2))

    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
