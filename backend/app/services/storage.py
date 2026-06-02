"""S3 / MinIO storage helpers.

The backend uses boto3's sync S3 client behind asyncio.to_thread so the
event loop stays unblocked. For local development the bucket lives in
the MinIO container started by docker-compose.
"""

from __future__ import annotations

import asyncio
from functools import lru_cache

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings

# Fail fast when the bucket service is unreachable: a single attempt with a 2s
# connect timeout, so a down/unreachable MinIO surfaces in ~2s (then mapped to a
# 503 by register_exception_handlers) instead of botocore's default ~9s of
# connection retries tying up the to_thread worker.
_S3_CONFIG = Config(
    connect_timeout=2,
    read_timeout=5,
    retries={"max_attempts": 1, "mode": "standard"},
)


@lru_cache(maxsize=1)
def _s3_client() -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=_S3_CONFIG,
    )


def _ensure_bucket_sync(bucket: str) -> None:
    client = _s3_client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"404", "NoSuchBucket"}:
            client.create_bucket(Bucket=bucket)
        else:
            raise


async def ensure_bucket(bucket: str) -> None:
    await asyncio.to_thread(_ensure_bucket_sync, bucket)


def _put_sync(bucket: str, key: str, body: bytes, content_type: str) -> None:
    _s3_client().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)


async def put_object(
    bucket: str, key: str, body: bytes, content_type: str = "application/octet-stream"
) -> None:
    await asyncio.to_thread(_put_sync, bucket, key, body, content_type)


def _swap_presigned_host(url: str, internal_endpoint: str, public_endpoint: str) -> str:
    """Rewrite a signed URL's origin so a browser can reach the object.

    boto3 signs against ``internal_endpoint`` (e.g. ``http://minio:9000`` inside
    Docker), which a browser on the host can't resolve. When ``public_endpoint``
    is set we swap *only* that origin (scheme+host[:port]) prefix for the public
    one, leaving the path, query and ``X-Amz-Signature`` untouched — path-style
    MinIO signs over the path + query, not the Host header, so the swap keeps the
    signature valid. Empty ``public_endpoint`` (the default) is a no-op, and a
    URL that doesn't start with ``internal_endpoint`` is returned unchanged.
    """
    public = public_endpoint.rstrip("/")
    if not public:
        return url
    internal = internal_endpoint.rstrip("/")
    if url.startswith(internal):
        return public + url[len(internal) :]
    return url


def _presigned_get_sync(bucket: str, key: str, expires_in: int) -> str:
    url = _s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )
    return _swap_presigned_host(str(url), settings.S3_ENDPOINT, settings.S3_PUBLIC_ENDPOINT)


async def presigned_get_url(bucket: str, key: str, expires_in: int = 3600) -> str:
    return await asyncio.to_thread(_presigned_get_sync, bucket, key, expires_in)
