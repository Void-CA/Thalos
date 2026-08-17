#!/usr/bin/env python3
"""Thalos Intelligence Evidence Renderer.

Generates figures (PNG) and an HTML report from evidence.json files
produced by the Rust evidence_export binary.

Usage:
    python tools/render_evidence.py --evidence-dir ./evidence --output-dir ./output
    python tools/render_evidence.py --evidence-dir ./evidence  # output defaults to ./output
"""

import argparse
import sys
import os
from pathlib import Path

# Add the tools directory to the path so relative imports work.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from render.config import SCENARIO_IDS
from render.io import load_evidence, ensure_output_dirs
from render.figures.manipulability import render_manipulability
from render.figures.quality import render_quality
from render.figures.inference_trace import render_inference_trace
from render.figures.candidate_ranking import render_candidate_ranking
from render.figures.decision_table import render_decision_table
from render.summary import render_summary_figures
from render.html_report import build_html_report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render Thalos Intelligence evidence as figures + HTML report."
    )
    parser.add_argument(
        "--evidence-dir", required=True,
        help="Directory containing evidence.json files (one per scenario)."
    )
    parser.add_argument(
        "--output-dir", default="output",
        help="Output directory for figures and HTML report (default: output)."
    )
    args = parser.parse_args()

    evidence_dir = args.evidence_dir
    output_dir = args.output_dir

    print(f"=== Evidence Renderer ===")
    print(f"Evidence dir: {evidence_dir}")
    print(f"Output dir:   {output_dir}")

    # Load evidence
    evidence = load_evidence(evidence_dir)
    if not evidence:
        print(f"ERROR: No evidence.json files found in {evidence_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"\nLoaded evidence for: {', '.join(evidence.keys())}")

    # Create output dirs
    ensure_output_dirs(output_dir)

    # Generate per-scenario figures
    for scenario in SCENARIO_IDS:
        if scenario not in evidence:
            print(f"  [SKIP] {scenario} — no evidence.json")
            continue

        ev = evidence[scenario]
        out = str(Path(output_dir) / "figures")

        print(f"\n--- {scenario} ---")

        # Figure 1: Manipulability
        path = str(Path(out) / f"{scenario}-manipulability.png")
        render_manipulability(scenario, ev, path)
        print(f"  [OK] {scenario}-manipulability.png")

        # Figure 2: Quality
        path = str(Path(out) / f"{scenario}-quality-before-after.png")
        render_quality(scenario, ev, path)
        print(f"  [OK] {scenario}-quality-before-after.png")

        # Figure 3: Inference trace
        path = str(Path(out) / f"{scenario}-inference-trace.png")
        render_inference_trace(scenario, ev, path)
        print(f"  [OK] {scenario}-inference-trace.png")

        # Figure 4: Candidate ranking
        path = str(Path(out) / f"{scenario}-candidate-ranking.png")
        render_candidate_ranking(scenario, ev, path)
        print(f"  [OK] {scenario}-candidate-ranking.png")

        # Figure 5: Decision table
        path = str(Path(out) / f"{scenario}-decision-table.png")
        render_decision_table(scenario, ev, path)
        print(f"  [OK] {scenario}-decision-table.png")

    # Cross-scenario summary
    print(f"\n--- Cross-scenario summary ---")
    summary = render_summary_figures(evidence, output_dir)
    print(f"  [OK] summary-risk.png")
    print(f"  [OK] summary-j.png")

    # HTML report
    print(f"\n--- HTML report ---")
    html = build_html_report(evidence, summary, output_dir)
    html_path = Path(output_dir) / "evidence.html"
    with open(html_path, "w") as f:
        f.write(html)
    print(f"  [OK] evidence.html ({len(html)} bytes)")

    print(f"\n=== Done ===")
    print(f"Report: {html_path}")
    print(f"Figures: {Path(output_dir) / 'figures'}")


if __name__ == "__main__":
    main()
