from fastapi import APIRouter

from app.api.v1 import (
    audit,
    auth,
    donors,
    health,
    orphans,
    partners,
    payments,
    reports,
    sponsorships,
    stats,
    webhooks,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(orphans.router, prefix="/orphans", tags=["orphans"])
api_router.include_router(donors.router, prefix="/donors", tags=["donors"])
api_router.include_router(partners.router, prefix="/partners", tags=["partners"])
api_router.include_router(sponsorships.router, prefix="/sponsorships", tags=["sponsorships"])
api_router.include_router(payments.router, prefix="/payments", tags=["payments"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
api_router.include_router(stats.router, prefix="/stats", tags=["stats"])
