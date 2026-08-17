"""Figure 1: Manipulability vs waypoint with problem regions overlaid."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..config import COLORS, FIGURE_DPI, FIGURE_SIZE


def render_manipulability(scenario: str, evidence: dict, output_path: str) -> None:
    series = evidence.get("manipulability_series", [])
    regions = evidence.get("problem_regions", [])

    fig, ax = plt.subplots(figsize=FIGURE_SIZE, dpi=FIGURE_DPI)

    if not series:
        ax.text(0.5, 0.5, "No manipulability data available",
                ha="center", va="center", fontsize=14, color="gray",
                transform=ax.transAxes)
        ax.set_title(f"{scenario} — Manipulability Profile")
        fig.tight_layout()
        fig.savefig(output_path)
        plt.close(fig)
        return

    xs = [p.get("waypoint", i) for i, p in enumerate(series)]
    ys = [p.get("normalized_yoshikawa", p.get("yoshikawa", 0.0)) for p in series]
    raw = [p.get("yoshikawa", 0.0) for p in series]

    # Use normalized if available, else raw
    use_normalized = any(v is not None and v != 0.0 for v in ys)
    plot_ys = ys if use_normalized else raw

    ax.plot(xs, plot_ys, color=COLORS["primary"], linewidth=1.8,
            label="Manipulability (normalized)" if use_normalized else "Manipulability (raw)")
    ax.fill_between(xs, 0, plot_ys, alpha=0.15, color=COLORS["primary"])

    # Overlay problem regions
    for region in regions:
        ws = region.get("waypoint_start", 0)
        we = region.get("waypoint_end", 0)
        severity = region.get("severity", "warning")
        color = {"critical": COLORS["accent"], "high": COLORS["warning"],
                 "medium": COLORS["warning"], "low": COLORS["muted"]}.get(
            severity, COLORS["warning"])
        ax.axvspan(ws, we, alpha=0.2, color=color, label=f"Region: {region.get('kind', '?')}")
        mid = (ws + we) / 2
        ax.text(mid, 0.02, region.get("kind", ""), ha="center", va="bottom",
                fontsize=7, color=color, rotation=90 if we - ws > 3 else 0)

    ax.set_xlabel("Waypoint")
    ax.set_ylabel("Manipulability" + (" (normalized)" if use_normalized else " (raw)"))
    ax.set_title(f"{scenario} — Manipulability Profile")
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)

    # Deduplicate legend
    handles, labels = ax.get_legend_handles_labels()
    by_label = dict(zip(labels, handles))
    ax.legend(by_label.values(), by_label.keys(), fontsize=8, loc="upper right")

    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)
