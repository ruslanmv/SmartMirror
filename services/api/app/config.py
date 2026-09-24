from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    smartmirror_env: str = "development"
    smartmirror_host: str = "0.0.0.0"
    smartmirror_port: int = 8100
    smartmirror_database_url: str = "sqlite:///./smartmirror.db"
    smartmirror_redis_url: str = "redis://localhost:6379/0"

    smartmirror_s3_endpoint: str = "http://localhost:9000"
    smartmirror_s3_access_key: str = "smartmirror"
    smartmirror_s3_secret_key: str = "change-me"
    smartmirror_s3_bucket: str = "smartmirror"
    smartmirror_s3_region: str = "us-east-1"

    homepilot_base_url: str = "http://localhost:8000"
    homepilot_api_key: str = ""

    ollabridge_base_url: str = "https://ruslanmv-ollabridge.hf.space"
    ollabridge_token: str = ""
    ollabridge_node_id: str = ""

    smartmirror_public_mcp_url: str = "http://localhost:8100/rpc"
    smartmirror_body_capture_ttl_hours: int = 24
    smartmirror_preview_ttl_hours: int = 168
    smartmirror_max_upload_mb: int = 25

    # Media storage: "local" (default, a folder on the owner's PC) or "s3" (MinIO/S3).
    smartmirror_storage: str = "local"
    smartmirror_media_dir: str = "./media"

    # AI try-on: "homepilot" (images.edit node job on this PC), "ollabridge-cloud", or "none".
    smartmirror_image_provider: str = "homepilot"
    # Run try-on jobs in the API process as soon as they are created (single-PC setup).
    smartmirror_inline_jobs: bool = True
    smartmirror_tryon_timeout_s: int = 600


@lru_cache
def get_settings() -> Settings:
    return Settings()
