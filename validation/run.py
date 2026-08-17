"""Validation runner — main entry point."""

import json
import os
import sys
import subprocess
from pathlib import Path

from .checks import run_all_checks, checks_to_json, DEFAULT_TOLERANCES
from .summary import print_summary
from .figures import generate_figures


def get_commit_hash() -> str:
    """Get the current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=str(Path(__file__).parent.parent)
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


def validate_scenario(scenario_dir: str, scenario: str, commit: str) -> dict:
    """Validate a single scenario and return results."""
    evidence_path = Path(scenario_dir) / "evidence.json"

    with open(evidence_path) as f:
        evidence = json.load(f)

    # Run checks
    checks = run_all_checks(evidence, DEFAULT_TOLERANCES)

    # Generate run_id
    run_id = f"{scenario}-{commit}"

    # Create validation.json
    validation = checks_to_json(checks, run_id, scenario, commit)
    validation["evidence_file"] = str(evidence_path)

    # Save validation.json
    validation_path = Path(scenario_dir) / "validation.json"
    with open(validation_path, "w") as f:
        json.dump(validation, f, indent=2)

    # Generate figures
    figures_dir = Path(scenario_dir) / "figures"
    generate_figures(evidence, str(figures_dir), scenario)

    # Print summary
    print_summary(checks, scenario, run_id)

    return validation


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m validation.run <evidence_dir>", file=sys.stderr)
        sys.exit(1)

    evidence_dir = sys.argv[1]
    commit = get_commit_hash()

    print(f"Commit: {commit}")
    print(f"Evidence dir: {evidence_dir}")
    print("")

    # Find all scenarios (only 6dof)
    scenarios = []
    for entry in sorted(Path(evidence_dir).iterdir()):
        if entry.is_dir() and (entry / "evidence.json").exists():
            if entry.name.startswith("6dof"):
                scenarios.append(entry.name)

    if not scenarios:
        print("ERROR: No evidence.json files found", file=sys.stderr)
        sys.exit(1)

    print(f"Scenarios: {', '.join(scenarios)}")
    print("")

    # Validate each scenario
    all_results = []
    all_passed = True

    for scenario in scenarios:
        scenario_dir = str(Path(evidence_dir) / scenario)
        result = validate_scenario(scenario_dir, scenario, commit)
        all_results.append(result)

        if result["summary"]["overall"] != "PASS":
            all_passed = False

    # Overall summary
    total_checks = sum(r["summary"]["total"] for r in all_results)
    total_passed = sum(r["summary"]["passed"] for r in all_results)
    total_failed = sum(r["summary"]["failed"] for r in all_results)
    total_skipped = sum(r["summary"]["skipped"] for r in all_results)

    print("═" * 60)
    print(f"OVERALL: {'PASS' if all_passed else 'FAIL'} ({total_passed}/{total_checks} passed")
    if total_skipped > 0:
        print(f"         {total_skipped} skipped")
    if total_failed > 0:
        print(f"         {total_failed} FAILED")
    print("═" * 60)

    # Exit code
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
