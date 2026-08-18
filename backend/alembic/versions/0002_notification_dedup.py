"""Enforce durable notification de-duplication.

Older databases may contain duplicate notification projections because the
invariant was previously enforced only by application reads.  The cleanup is
performed as a migration so it is explicit, versioned, and runs before the
unique partial index is created.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0002_notification_dedup"
down_revision: Union[str, None] = "0001_consolidated"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0001 in some installations already created the index; dropping it first
    # makes this migration safe for both those databases and older baselines.
    op.execute("DROP INDEX IF EXISTS ux_notifications_dedup_key")
    op.execute(
        """
        DELETE FROM notifications
        WHERE dedup_key IS NOT NULL AND dedup_key != ''
          AND rowid NOT IN (
            SELECT MIN(rowid)
            FROM notifications
            WHERE dedup_key IS NOT NULL AND dedup_key != ''
            GROUP BY dedup_key
          )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX ux_notifications_dedup_key
        ON notifications (dedup_key)
        WHERE dedup_key IS NOT NULL AND dedup_key != ''
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_notifications_dedup_key")
