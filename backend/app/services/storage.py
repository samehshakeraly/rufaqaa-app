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
from botocore.exceptions import ClientError

from app.core.config import settings


@lru_cache(maxsize=1)
def _s3_client() -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
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


def _presigned_get_sync(bucket: str, key: str, expires_in: int) -> str:
    return _s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )


async def presigned_get_url(bucket: str, key: str, expires_in: int = 3600) -> str:
    return await asyncio.to_thread(_presigned_get_sync, bucket, key, expires_in)
