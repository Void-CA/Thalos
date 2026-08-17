"""Figure 5: Decision table — strategy metrics, ε deadband, tie-break."""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from ..config import COLORS, EPSILON, FIGURE_DPI, FIGURE_SIZE, J_WEIGHTS


def render_decision_table(scenario: str, evidence: dict, output_path: str) -> None:
    ranking = evidence.get("candidate_ranking", {})
    strategies = ranking.get("ranked", [])
    selected = ranking.get("selected", "")
    reason = ranking.get("reason", {})

    fig, ax = plt.subplots(figsize=(FIGURE_SIZE[0], FIGURE_SIZE[1] * 0.75), dpi=FIGURE_DPI)
    ax.axis("off")

    if not strategies:
        ax.text(0.5, 0.5, "No decision data available",
                ha="center", va="center", fontsize=14, color="gray",
                transform=ax.transAxes)
        ax.set_title(f"{scenario} — Decision Table")
        fig.tight_layout()
        fig.savefig(output_path)
        plt.close(fig)
        return

    # Build table data
    headers = ["Strategy", "Risk", "Duration", "Manip", "Length", "J Score", "Selected"]
    cell_data = []
    cell_colors = []

    for s in strategies:
        name = s.get("strategy", "?")
        is_selected = (name == selected)
        bg = "#E8F5E9" if is_selected else "white"

        cell_data.append([
            f"{'→ ' if is_selected else ''}{name}",
            f"{s.get('risk', 0):.4f}",
            f"{s.get('duration', 0):.6f}",
            f"{s.get('manipulability', 0):.4f}",
            f"{s.get('length', 0):.4f}",
            f"{s.get('cost', 0):.4f}",
            "YES" if is_selected else "",
        ])
        cell_colors.append([bg] * len(headers))

    # ε deadband row
    cell_data.append(["ε deadband", f"{EPSILON:.0e}", "", "", "", "", ""])
    cell_colors.append([COLORS["bg"]] * len(headers))

    # Tie-break row
    cell_data.append(["Tie-break", "first-in-order", "", "(stable sort)", "", "", ""])
    cell_colors.append([COLORS["bg"]] * len(headers))

    # Result row
    result_kind = reason.get("kind", "unknown")
    if result_kind == "selected":
        result_str = f"Selected: {selected}"
    else:
        result_str = f"No admissible candidate: {reason.get('reason', '?')}"
    cell_data.append(["Result", result_str, "", "", "", "", ""])
    cell_colors.append(["#FFF9C4"] * len(headers))

    table = ax.table(
        cellText=cell_data,
        colLabels=headers,
        loc="center",
        cellColours=cell_colors,
        colColours=[COLORS["primary"]] * len(headers),
    )
    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.scale(1.0, 1.4)

    # Style header text white
    for j in range(len(headers)):
        cell = table[0, j]
        cell.set_text_props(color="white", fontweight="bold")

    # Bold selected row
    for i, s in enumerate(strategies):
        if s.get("strategy") == selected:
            for j in range(len(headers)):
                table[i + 1, j].set_text_props(fontweight="bold")

    # Degenerate annotation
    if len(strategies) >= 2:
        j_scores = [s.get("cost", 0) for s in strategies]
        delta = max(j_scores) - min(j_scores)
        if delta < EPSILON * 10:
            ax.text(0.5, -0.02,
                    f"All strategies within {delta:.2e} (sub-10ε) — tie-break by candidate order",
                    ha="center", va="top", transform=ax.transAxes,
                    fontsize=7, color="gray", style="italic")

    ax.set_title(f"{scenario} — Decision Table", fontsize=11, fontweight="bold", pad=12)

    fig.tight_layout()
    fig.savefig(output_path)
    plt.close(fig)


def render_decision_table_html(scenario: str, evidence: dict) -> str:
    """Return raw HTML table string for embedding in the report."""
    ranking = evidence.get("candidate_ranking", {})
    strategies = ranking.get("ranked", [])
    selected = ranking.get("selected", "")
    reason = ranking.get("reason", {})

    rows = []
    for s in strategies:
        name = s.get("strategy", "?")
        is_sel = name == selected
        cls = ' class="selected"' if is_sel else ""
        rows.append(
            f"<tr{cls}>"
            f"<td>{'→ ' if is_sel else ''}{name}</td>"
            f"<td>{s.get('risk', 0):.4f}</td>"
            f"<td>{s.get('duration', 0):.6f}</td>"
            f"<td>{s.get('manipulability', 0):.4f}</td>"
            f"<td>{s.get('length', 0):.4f}</td>"
            f"<td><strong>{s.get('cost', 0):.4f}</strong></td>"
            f"<td>{'YES' if is_sel else ''}</td>"
            f"</tr>"
        )

    result_kind = reason.get("kind", "unknown")
    if result_kind == "selected":
        result_str = f"Selected: <strong>{selected}</strong>"
    else:
        result_str = f"No admissible candidate: {reason.get('reason', '?')}"

    html = f"""
    <table class="decision-table">
      <thead>
        <tr>
          <th>Strategy</th><th>Risk</th><th>Duration</th>
          <th>Manip</th><th>Length</th><th>J Score</th><th>Selected</th>
        </tr>
      </thead>
      <tbody>
        {''.join(rows)}
        <tr class="meta"><td>ε deadband</td><td>{EPSILON:.0e}</td><td colspan="5"></td></tr>
        <tr class="meta"><td>Tie-break</td><td colspan="2">first-in-order (stable sort)</td><td colspan="4"></td></tr>
        <tr class="result"><td colspan="7">Result: {result_str}</td></tr>
      </tbody>
    </table>
    """
    return html
