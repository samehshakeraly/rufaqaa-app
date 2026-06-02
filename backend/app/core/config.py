from functools import cached_property, lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = True
    TZ: str = "Asia/Kuwait"

    APP_NAME: str = "Rufaqaa API"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: PostgresDsn = Field(
        default=PostgresDsn(
            "postgresql+asyncpg://rufaqaa:rufaqaa_dev_password@localhost:5432/rufaqaa"
        )
    )
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    SECRET_KEY: str = "development_only_change_in_production"
    JWT_SECRET_KEY: str = "development_only_change_in_production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    BCRYPT_ROUNDS: int = 12

    LOGIN_MAX_FAILED_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15

    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"
    # OR-ed with CORS_ORIGINS by the CORS middleware. Defaults to any
    # localhost / 127.0.0.1 port so local dev (frontend :3000, Vite :5173,
    # …) works out of the box. Set to "" in production to rely solely on
    # the explicit CORS_ORIGINS allow-list.
    CORS_ORIGIN_REGEX: str = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"

    RATE_LIMIT_PUBLIC: int = 60  # per minute, anonymous
    RATE_LIMIT_AUTHENTICATED: int = 300  # per minute, with Bearer token
    RATE_LIMIT_ENABLED: bool = True
    # "memory" — per-process (fine for a single worker).
    # "redis"  — shared across workers, recommended in production.
    RATE_LIMIT_BACKEND: Literal["memory", "redis"] = "memory"

    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    LOG_FORMAT: Literal["json", "text"] = "json"

    MYFATOORAH_API_URL: str = "https://apitest.myfatoorah.com"
    MYFATOORAH_API_KEY: str = ""
    MYFATOORAH_WEBHOOK_SECRET: str = ""

    S3_ENDPOINT: str = "http://localhost:9000"
    # Browser-facing S3 origin for presigned GET URLs. boto3 signs against the
    # internal S3_ENDPOINT (e.g. http://minio:9000 inside Docker), which a
    # browser can't reach; when set, only that origin prefix is swapped for this
    # one in generated URLs. Empty = no rewrite (use S3_ENDPOINT as-is).
    S3_PUBLIC_ENDPOINT: str = ""
    S3_ACCESS_KEY: str = "rufaqaa_admin"
    S3_SECRET_KEY: str = "rufaqaa_dev_secret_change_me"
    S3_BUCKET_PRIVATE: str = "rufaqaa-private"
    S3_BUCKET_PUBLIC: str = "rufaqaa-public"
    S3_REGION: str = "us-east-1"
    UPLOAD_MAX_BYTES: int = 10 * 1024 * 1024

    # Outbound email. Defaults target the MailHog dev container; in
    # production set SMTP_HOST/PORT/USER/PASSWORD to a real relay.
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_TLS: bool = False
    EMAIL_FROM: str = "noreply@rufaqaa.app"
    EMAIL_FROM_NAME: str = "رفقاء"
    EMAIL_ENABLED: bool = False  # flip to True once SMTP creds are set
    DEFAULT_LOCALE: Literal["ar", "en"] = "ar"

    # Base URL the SPA is served at — used to build absolute links in
    # transactional emails (invite, password reset, …).
    APP_BASE_URL: str = "http://localhost:5173"

    # Error reporting (optional). Leave SENTRY_DSN empty to disable.
    SENTRY_DSN: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0
    SENTRY_RELEASE: str = ""

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
