"""Architecture guard for product read-port boundaries."""

import ast
from pathlib import Path


def test_dashboard_uses_execution_read_port():
    """Product dashboards must not scan durable executions through Kernel directly."""
    dashboard = (
        Path(__file__).resolve().parents[2] / "app" / "product" / "personal_dashboard.py"
    )
    tree = ast.parse(dashboard.read_text(encoding="utf-8"))
    forbidden = {
        "read_scheduled_executions",
        "count_scheduled_executions_by_status",
        "list_dead_letter_executions",
    }
    offenders = [
        f"{dashboard.name}:{node.lineno}:{node.attr}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr in forbidden
    ]
    assert not offenders, f"dashboard bypasses execution read port: {offenders}"
