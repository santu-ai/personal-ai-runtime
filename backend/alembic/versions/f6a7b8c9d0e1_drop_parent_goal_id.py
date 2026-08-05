"""drop work_items.parent_goal_id; unify on parent_work_id

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-08-05 14:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: raw DDL / older DBs may already lack the column.
    conn = op.get_bind()
    cols = {
        row[1]
        for row in conn.exec_driver_sql("PRAGMA table_info(work_items)").fetchall()
    }
    if "parent_goal_id" in cols:
        op.execute("ALTER TABLE work_items DROP COLUMN parent_goal_id;")


def downgrade() -> None:
    op.execute("ALTER TABLE work_items ADD COLUMN parent_goal_id TEXT;")
