#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."

echo "=== Phase 1: Evidence Export (Rust) ==="
cargo run -p thalos_api --bin evidence_export --release

echo ""
echo "=== Phase 2: Evidence Renderer (Python) ==="
cd "$REPO_ROOT"
python3 tools/render_evidence.py \
  --evidence-dir ./evidence \
  --output-dir ./output

echo ""
echo "=== Phase 3: Verification ==="
SCENARIOS=("happy-path" "multi-object" "repair-alternatives" "safety-rejection")
FIGURES=("manipulability" "quality-before-after" "inference-trace" "candidate-ranking" "decision-table")
ERRORS=0

for scenario in "${SCENARIOS[@]}"; do
  for fig in "${FIGURES[@]}"; do
    FILE="output/figures/${scenario}-${fig}.png"
    if [[ ! -f "$FILE" ]]; then
      echo "MISSING: $FILE"
      ERRORS=$((ERRORS + 1))
    fi
  done
done

if [[ ! -f "output/evidence.html" ]]; then
  echo "MISSING: output/evidence.html"
  ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "FAILED: $ERRORS files missing"
  exit 1
fi

echo "=== All evidence artifacts generated ==="
echo "HTML report: output/evidence.html"
