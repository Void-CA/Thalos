"""Evidence renderer configuration constants."""

SCENARIO_IDS = [
    "happy-path",
    "multi-object",
    "repair-alternatives",
    "safety-rejection",
]

SCENARIO_LABELS = {
    "happy-path": "Happy Path (Direct)",
    "multi-object": "Multi-Object",
    "repair-alternatives": "Repair Alternatives",
    "safety-rejection": "Safety Rejection",
}

FIGURE_TYPES = [
    "manipulability",
    "quality-before-after",
    "inference-trace",
    "candidate-ranking",
    "decision-table",
]

# J-score component weights (from thalos-planning candidate/ranking.rs)
J_WEIGHTS = {
    "risk": 0.5,
    "duration": 0.2,
    "manipulability": 0.2,
    "length": 0.1,
}

EPSILON = 1e-4  # deadband threshold

# Matplotlib style
COLORS = {
    "primary": "#4C72B0",
    "secondary": "#55A868",
    "accent": "#C44E52",
    "warning": "#DD8452",
    "muted": "#8172B3",
    "light": "#937860",
    "bg": "#EAEAF2",
}

FIGURE_SIZE = (10, 6)
FIGURE_DPI = 100
