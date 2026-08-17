#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Thalos Intelligence Validation Protocol ==="
echo ""

# Step 1: Export evidence
EVIDENCE_DIR="$SCRIPT_DIR/evidence"
if [ ! -d "$EVIDENCE_DIR/6dof-near-singular" ]; then
    echo "Step 1: Exporting evidence..."
    cd "$REPO_ROOT/backend"
    cargo run --bin evidence_export -- "$EVIDENCE_DIR/" 2>&1 | grep -E "6dof|Done"
    cd "$REPO_ROOT"
else
    echo "Step 1: Evidence already exists, skipping export"
fi

# Step 2: Filter to 6dof only
echo ""
echo "Step 2: Filtering to 6dof scenarios..."
for dir in "$EVIDENCE_DIR"/*/; do
    scenario=$(basename "$dir")
    if [[ ! "$scenario" =~ ^6dof ]]; then
        rm -rf "$dir"
    fi
done

# Remove 6dof-repair if it has empty data
if [ -f "$EVIDENCE_DIR/6dof-repair/evidence.json" ]; then
    waypoints=$(python3 -c "
import json
with open('$EVIDENCE_DIR/6dof-repair/evidence.json') as f:
    d = json.load(f)
print(len(d.get('baseline', {}).get('trajectory', {}).get('waypoints', [])))
" 2>/dev/null || echo "0")
    if [ "$waypoints" = "0" ]; then
        echo "  Removing 6dof-repair (empty data)"
        rm -rf "$EVIDENCE_DIR/6dof-repair"
    fi
fi

echo "  Scenarios: $(ls -d "$EVIDENCE_DIR"/*/ 2>/dev/null | xargs -I{} basename {} | tr '\n' ', ')"

# Step 3: Run validation
echo ""
echo "Step 3: Running validation checks..."
cd "$SCRIPT_DIR"
python3 -m validation.run "$EVIDENCE_DIR"
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "=== Validation PASSED ==="
else
    echo "=== Validation FAILED ==="
fi

exit $EXIT_CODE
