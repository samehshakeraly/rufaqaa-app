"""Inbound webhook log + replay.

Captures every inbound delivery — successful or failed — so operators
can audit and replay events without depending on the gateway's own
log retention.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE inbound_webhook_log (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            source VARCHAR(50) NOT NULL,
            payload JSONB NOT NULL,
            signature TEXT,
            response_status INT,
            response_body TEXT,
            error TEXT,
            received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            replayed_from UUID REFERENCES inbound_webhook_log(id),
            replayed_count INT NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_inbound_webhook_log_received
            ON inbound_webhook_log (received_at DESC);
        CREATE INDEX idx_inbound_webhook_log_source
            ON inbound_webhook_log (source, received_at DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS inbound_webhook_log;")
