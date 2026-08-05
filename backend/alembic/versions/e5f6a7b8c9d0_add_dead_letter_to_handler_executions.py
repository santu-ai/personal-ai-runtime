"""add dead_letter column to handler_executions

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-08-05 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE handler_executions "
        "ADD COLUMN dead_letter INTEGER NOT NULL DEFAULT 0;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_handler_executions_dead_letter "
        "ON handler_executions (dead_letter);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_handler_executions_dead_letter;")
