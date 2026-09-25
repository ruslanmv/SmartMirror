"""Outfit titles for stylist v2 (additive: one nullable column).

Revision ID: 0003_outfit_titles
Revises: 0002_foundations
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_outfit_titles"
down_revision = "0002_foundations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("outfits") as batch:
        batch.add_column(sa.Column("title", sa.String(length=120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("outfits") as batch:
        batch.drop_column("title")
