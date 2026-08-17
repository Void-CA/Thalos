"""Evidence loading and output path helpers."""

import json
import os
from pathlib import Path

from .config import SCENARIO_IDS


def load_evidence(evidence_dir: str) -> dict[str, dict]:
    """Load all evidence.json files from a directory, keyed by scenario ID."""
    evidence = {}
    for scenario_id in SCENARIO_IDS:
        path = Path(evidence_dir) / scenario_id / "evidence.json"
        if path.exists():
            with open(path) as f:
                evidence[scenario_id] = json.load(f)
    return evidence


def ensure_output_dirs(output_dir: str) -> None:
    """Create the output directory structure."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    (Path(output_dir) / "figures").mkdir(parents=True, exist_ok=True)


def figure_path(output_dir: str, scenario: str, figure_type: str) -> Path:
    """Return the path for a scenario figure."""
    return Path(output_dir) / "figures" / f"{scenario}-{figure_type}.png"


def summary_path(output_dir: str, name: str) -> Path:
    """Return the path for a cross-scenario summary figure."""
    return Path(output_dir) / "figures" / f"summary-{name}.png"
