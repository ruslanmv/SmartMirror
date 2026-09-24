"""Wardrobe intelligence, media, sets, shopping, capture hand-off and audit (M0).

Additive: new nullable columns on wardrobe_items and new tables only.

Revision ID: 0002_foundations
Revises: 0001_initial
Create Date: 2026-09-24
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_foundations"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("wardrobe_items") as batch:
        batch.add_column(sa.Column("status", sa.String(length=16), nullable=False, server_default="confirmed"))
        batch.add_column(sa.Column("ai_metadata", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("user_metadata", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("image_asset_id", sa.String(length=64), nullable=True))
    op.create_index("ix_wardrobe_items_status", "wardrobe_items", ["status"])

    op.create_table(
        "assets",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.String(length=256), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_assets_profile_id", "assets", ["profile_id"])
    op.create_index("ix_assets_kind", "assets", ["kind"])
    op.create_index("ix_assets_sha256", "assets", ["sha256"])
    op.create_index("ix_assets_expires_at", "assets", ["expires_at"])

    op.create_table(
        "classification_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("model_id", sa.String(length=128), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("output_json", sa.JSON(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_classification_runs_item_id", "classification_runs", ["item_id"])

    op.create_table(
        "outfit_sets",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("params_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_outfit_sets_profile_id", "outfit_sets", ["profile_id"])

    op.create_table(
        "outfit_set_members",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("set_id", sa.String(length=64), sa.ForeignKey("outfit_sets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("item_ids", sa.JSON(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
    )
    op.create_index("ix_outfit_set_members_set_id", "outfit_set_members", ["set_id"])

    op.create_table(
        "shopping_candidates",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("query", sa.String(length=300), nullable=False),
        sa.Column("gap_category", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("price_text", sa.String(length=64), nullable=True),
        sa.Column("price_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("purchased", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_shopping_candidates_profile_id", "shopping_candidates", ["profile_id"])

    op.create_table(
        "capture_sessions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("purpose", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("asset_id", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_capture_sessions_profile_id", "capture_sessions", ["profile_id"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("event", sa.String(length=64), nullable=False),
        sa.Column("subject_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_profile_id", "audit_events", ["profile_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])


def downgrade() -> None:
    for table in (
        "audit_events",
        "capture_sessions",
        "shopping_candidates",
        "outfit_set_members",
        "outfit_sets",
        "classification_runs",
        "assets",
    ):
        op.drop_table(table)
    op.drop_index("ix_wardrobe_items_status", table_name="wardrobe_items")
    with op.batch_alter_table("wardrobe_items") as batch:
        batch.drop_column("image_asset_id")
        batch.drop_column("user_metadata")
        batch.drop_column("ai_metadata")
        batch.drop_column("status")
