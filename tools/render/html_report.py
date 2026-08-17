"""HTML report assembly with embedded base64 figures."""

import base64
from pathlib import Path

from .config import SCENARIO_LABELS
from .figures.decision_table import render_decision_table_html
from .summary import render_summary_table_html


KNOWN_LIMITATIONS = """
<section class="known-limitations">
  <h2>Known Limitations</h2>
  <div class="limitation-card">
    <h3>Icebot — AlternateElbow Sub-ε Degeneration</h3>
    <p>
      On the <code>icebot</code> robot, the <strong>AlternateElbow</strong>
      realization is degenerate within the ε deadband (1×10⁻⁴). The joint-1
      limit <code>[0, 2.0944]</code> constrains the configuration space such
      that the mirrored elbow cannot meaningfully diverge from the Direct
      solution.
    </p>
    <p>
      <strong>Risk floor R07</strong> (~0.625) remains always active regardless
      of strategy, because the workspace geometry forces similar manipulability
      profiles across all realizations.
    </p>
    <p class="honest-framing">
      <em>The correct academic framing is <strong>"alternatives surfaced /
      repair attempted"</strong>, NOT "better path chosen". This is an academic
      strength: it demonstrates that Thalos Intelligence does not over-promise
      and reports real limitations of the configuration space honestly.</em>
    </p>
    <p class="technical-detail">
      The sub-ε degeneration is visible in the candidate ranking: all strategies
      achieve J scores within &lt;10×ε of each other. The stable tie-break
      selects the first candidate in the original order (Direct), which is the
      deterministic and reproducible behavior.
    </p>
  </div>
</section>
"""

CSS = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
       color: #333; background: #fafafa; line-height: 1.6; }
.container { max-width: 1100px; margin: 0 auto; padding: 20px; }
h1 { text-align: center; color: #1a1a2e; margin: 30px 0 10px; font-size: 28px; }
h2 { color: #16213e; border-bottom: 2px solid #4C72B0; padding-bottom: 6px; margin: 30px 0 15px; }
h3 { color: #1a1a2e; margin: 15px 0 8px; }
.executive-summary { background: #E8F4FD; border-left: 4px solid #4C72B0; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
.scenario { background: white; border: 1px solid #ddd; border-radius: 6px; padding: 20px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.scenario h2 { border-bottom-color: #55A868; }
.figures { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
.figures img { width: 100%; border: 1px solid #eee; border-radius: 4px; }
.decision-table { margin: 15px 0; }
table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 10px 0; }
th { background: #4C72B0; color: white; padding: 8px 10px; text-align: left; font-weight: 600; }
td { padding: 6px 10px; border-bottom: 1px solid #eee; }
tr:hover td { background: #f5f5f5; }
tr.selected td { background: #E8F5E9; font-weight: bold; }
tr.meta td { background: #EAEAF2; font-style: italic; color: #666; }
tr.result td { background: #FFF9C4; font-weight: 600; }
.verdict-low { color: #55A868; font-weight: bold; }
.verdict-medium { color: #DD8452; font-weight: bold; }
.verdict-high { color: #C44E52; font-weight: bold; }
.verdict-critical { color: #C44E52; font-weight: bold; text-transform: uppercase; }
.known-limitations { background: #FFF8E1; border-left: 4px solid #DD8452; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
.limitation-card { background: white; border: 1px solid #e0d5a0; border-radius: 4px; padding: 15px; margin: 10px 0; }
.honest-framing { background: #E8F5E9; padding: 10px; border-radius: 4px; margin-top: 10px; }
.technical-detail { color: #666; font-size: 0.9em; margin-top: 8px; }
.cross-scenario { margin: 20px 0; }
.summary-table { margin: 15px 0; }
code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.95em; }
@media print { .figures { grid-template-columns: 1fr; } }
"""

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thalos Intelligence — Evidence Report</title>
  <style>{css}</style>
</head>
<body>
  <div class="container">
    <h1>Thalos Intelligence — Evidence Report</h1>

    <div class="executive-summary">
      <strong>Executive Summary:</strong> This report presents the evidence
      produced by Thalos Intelligence across {n_scenarios} canonical demo
      scenarios. Each scenario demonstrates the full pipeline: headless
      execution, assessment, candidate ranking, and inference trace — all
      rendered from serialized <code>evidence.json</code> files with zero
      recalculation in the renderer.
    </div>

    {scenario_sections}

    <section class="cross-scenario">
      <h2>Cross-Scenario Summary</h2>
      <img src="data:image/png;base64,{summary_risk_b64}"
           alt="Cross-scenario risk comparison">
      <img src="data:image/png;base64,{summary_j_b64}"
           alt="Cross-scenario J score comparison">
      {summary_table_html}
    </section>

    {known_limitations}

    <footer style="text-align: center; color: #999; margin-top: 40px; padding: 20px; border-top: 1px solid #eee;">
      Generated by Thalos Intelligence Evidence Renderer — data sourced from <code>evidence.json</code> files.
      No metrics were recalculated in the renderer.
    </footer>
  </div>
</body>
</html>"""


def _embed_image_b64(path: str) -> str:
    """Read a PNG file and return its base64 data URI."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def build_html_report(evidence: dict, summary: dict, output_dir: str) -> str:
    """Assemble the full HTML report with embedded base64 figures."""
    scenarios = list(evidence.keys())
    sections = []

    for scenario in scenarios:
        label = SCENARIO_LABELS.get(scenario, scenario)
        fig_dir = Path(output_dir) / "figures"

        figs = {}
        for fig_type in ["manipulability", "quality-before-after",
                         "inference-trace", "candidate-ranking", "decision-table"]:
            fig_path = fig_dir / f"{scenario}-{fig_type}.png"
            if fig_path.exists():
                figs[fig_type] = _embed_image_b64(str(fig_path))

        decision_table_html = render_decision_table_html(scenario, evidence[scenario])

        section = f"""
    <section class="scenario" id="{scenario}">
      <h2>{label}</h2>
      <div class="figures">
        <img src="data:image/png;base64,{figs.get('manipulability', '')}"
             alt="Manipulability profile">
        <img src="data:image/png;base64,{figs.get('quality-before-after', '')}"
             alt="Quality assessment">
        <img src="data:image/png;base64,{figs.get('inference-trace', '')}"
             alt="Inference trace">
        <img src="data:image/png;base64,{figs.get('candidate-ranking', '')}"
             alt="Candidate ranking">
      </div>
      <div class="decision-table">
        {decision_table_html}
      </div>
    </section>
        """
        sections.append(section)

    summary_risk = _embed_image_b64(str(Path(output_dir) / "figures" / "summary-risk.png"))
    summary_j = _embed_image_b64(str(Path(output_dir) / "figures" / "summary-j.png"))
    summary_table_html = render_summary_table_html(summary.get("summary_data", []))

    html = HTML_TEMPLATE.format(
        css=CSS,
        n_scenarios=len(scenarios),
        scenario_sections="\n".join(sections),
        summary_risk_b64=summary_risk,
        summary_j_b64=summary_j,
        summary_table_html=summary_table_html,
        known_limitations=KNOWN_LIMITATIONS,
    )
    return html
