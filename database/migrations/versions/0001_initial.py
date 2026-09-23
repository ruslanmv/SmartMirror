"""Initial SmartMirror schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wardrobe_items",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("subcategory", sa.String(length=64), nullable=True),
        sa.Column("color", sa.String(length=64), nullable=True),
        sa.Column("material", sa.String(length=64), nullable=True),
        sa.Column("fit", sa.String(length=64), nullable=True),
        sa.Column("length", sa.String(length=64), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_wardrobe_items_profile_id", "wardrobe_items", ["profile_id"])
    op.create_index("ix_wardrobe_items_category", "wardrobe_items", ["category"])
    op.create_index("ix_wardrobe_items_color", "wardrobe_items", ["color"])

    op.create_table(
        "styling_requests",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("normalized_intent", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_styling_requests_profile_id", "styling_requests", ["profile_id"])

    op.create_table(
        "outfits",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("styling_request_id", sa.String(length=64), sa.ForeignKey("styling_requests.id"), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("item_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_outfits_styling_request_id", "outfits", ["styling_request_id"])

    op.create_table(
        "generation_jobs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("profile_id", sa.String(length=128), nullable=False),
        sa.Column("job_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("provider_job_id", sa.String(length=128), nullable=True),
        sa.Column("request_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_generation_jobs_profile_id", "generation_jobs", ["profile_id"])
    op.create_index("ix_generation_jobs_job_type", "generation_jobs", ["job_type"])
    op.create_index("ix_generation_jobs_status", "generation_jobs", ["status"])


def downgrade() -> None:
    op.drop_table("generation_jobs")
    op.drop_table("outfits")
    op.drop_table("styling_requests")
    op.drop_table("wardrobe_items")
