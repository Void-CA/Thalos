"""Terminal summary generator for validation results."""

import json
from typing import TextIO
import sys

from .checks import CheckResult


def print_summary(checks: list[CheckResult], scenario: str, run_id: str, output: TextIO = None):
    """Print a compact, deterministic terminal summary."""
    if output is None:
        output = sys.stdout

    w = 60  # line width

    output.write("\n")
    output.write("═" * w + "\n")
    output.write(f"Scenario: {scenario}\n")
    output.write(f"Run ID:   {run_id}\n")
    output.write("═" * w + "\n\n")

    for check in checks:
        status_icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "○"}[check.status]
        status_color = {"PASS": "\033[32m", "FAIL": "\033[31m", "SKIP": "\033[33m"}[check.status]
        reset = "\033[0m"

        name = check.name.ljust(22)
        message = check.message[:40].ljust(40)
        status = f"{status_color}{check.status}{reset}"

        output.write(f"  {name} {message} {status}\n")

    output.write("\n" + "─" * w + "\n")

    passed = sum(1 for c in checks if c.status == "PASS")
    failed = sum(1 for c in checks if c.status == "FAIL")
    skipped = sum(1 for c in checks if c.status == "SKIP")
    total = len(checks)

    overall = "PASS" if all(c.status in ("PASS", "SKIP") for c in checks) else "FAIL"
    overall_color = "\033[32m" if overall == "PASS" else "\033[31m"
    reset = "\033[0m"

    output.write(f"  Overall: {overall_color}{overall}{reset} ({passed}/{total} passed")
    if skipped > 0:
        output.write(f", {skipped} skipped")
    if failed > 0:
        output.write(f", {failed} FAILED")
    output.write(")\n")
    output.write("═" * w + "\n\n")


def print_summary_json(checks: list[CheckResult], scenario: str, run_id: str):
    """Print JSON summary for machine consumption."""
    from .checks import checks_to_json
    result = checks_to_json(checks, scenario, run_id, "")
    print(json.dumps(result, indent=2))
