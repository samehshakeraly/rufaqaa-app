from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.api.deps import get_db
from app.core.config import settings

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "version": __version__,
        "environment": settings.ENVIRONMENT,
    }


@router.get("/health/db")
async def health_db(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    result = await db.scalar(text("SELECT 1"))
    return {"database": "ok" if result == 1 else "error"}
