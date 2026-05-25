from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        env_prefix="RUFAQAA_MCP_",
    )

    api_url: str = "http://localhost:8000/api/v1"
    api_email: str = "admin@dev.rufaqaa.app"
    api_password: str = "admin12345"
    http_timeout_seconds: float = 15.0


settings = Settings()
