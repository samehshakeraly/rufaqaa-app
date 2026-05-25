from fastapi import APIRouter

from app.api.v1 import auth, donors, health, orphans, partners

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(orphans.router, prefix="/orphans", tags=["orphans"])
api_router.include_router(donors.router, prefix="/donors", tags=["donors"])
api_router.include_router(partners.router, prefix="/partners", tags=["partners"])
