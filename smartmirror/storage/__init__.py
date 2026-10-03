"""Media storage for photos, cut-outs and try-on previews.

Everything stays on the owner's side: a local folder by default, or the
MinIO/S3 bucket from infra/compose. Keys are opaque; callers never build paths.
Objects are never public: the bucket must not grant anonymous access, and the
only way to fetch an object without credentials is a short-lived signed URL
(see ``smartmirror.media.signed_url``).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Protocol

_KEY = re.compile(r"^[a-z0-9_-]{1,40}/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{2,5}$")

EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class MediaStore(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


def make_key(kind: str, asset_id: str, content_type: str) -> str:
    key = f"{kind}/{asset_id}.{EXTENSIONS.get(content_type, 'bin')}"
    if not _KEY.match(key):
        raise ValueError("invalid storage key")
    return key


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class LocalMediaStore:
    def __init__(self, root: str | os.PathLike[str]):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        if not _KEY.match(key):
            raise ValueError("invalid storage key")
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class PublicBucketError(RuntimeError):
    """The bucket grants anonymous access; SmartMirror refuses to store photos in it."""


def _is_public_policy(policy: str) -> bool:
    try:
        statements = json.loads(policy).get("Statement", [])
    except (ValueError, AttributeError):
        return True  # unreadable policy: treat as unsafe
    if isinstance(statements, dict):
        statements = [statements]
    for st in statements:
        if st.get("Effect") != "Allow":
            continue
        principal = st.get("Principal")
        aws = principal.get("AWS") if isinstance(principal, dict) else principal
        values = aws if isinstance(aws, list) else [aws]
        if "*" in values:
            return True
    return False


class S3MediaStore:
    """MinIO/S3 bucket (boto3 is already a SmartMirror dependency).

    On start the bucket is created if missing (private by default) and checked:
    a policy that lets anyone read it stops SmartMirror with PublicBucketError.
    """

    def __init__(self, *, endpoint: str, access_key: str, secret_key: str, bucket: str, region: str, client=None):
        if client is None:
            import boto3
            from botocore.config import Config

            client = boto3.client(
                "s3",
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name=region,
                config=Config(signature_version="s3v4"),
            )
        self.bucket = bucket
        self.client = client
        self.ensure_private_bucket()

    def ensure_private_bucket(self) -> None:
        from botocore.exceptions import ClientError

        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            self.client.create_bucket(Bucket=self.bucket)
        try:
            policy = self.client.get_bucket_policy(Bucket=self.bucket).get("Policy", "")
        except ClientError:
            return  # no policy: private
        if policy and _is_public_policy(policy):
            raise PublicBucketError(f"bucket {self.bucket!r} allows anonymous access; remove its public policy")

    def presign(self, key: str, expires_in: int) -> str:
        if not _KEY.match(key):
            raise ValueError("invalid storage key")
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=int(expires_in)
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


_store: MediaStore | None = None


def get_store() -> MediaStore:
    global _store
    if _store is None:
        from services.api.app.config import get_settings

        s = get_settings()
        if s.smartmirror_storage == "s3":
            _store = S3MediaStore(
                endpoint=s.smartmirror_s3_endpoint,
                access_key=s.smartmirror_s3_access_key,
                secret_key=s.smartmirror_s3_secret_key,
                bucket=s.smartmirror_s3_bucket,
                region=s.smartmirror_s3_region,
            )
        else:
            _store = LocalMediaStore(s.smartmirror_media_dir)
    return _store


def set_store(store: MediaStore | None) -> None:
    """Tests and embedding apps can swap the store."""
    global _store
    _store = store
