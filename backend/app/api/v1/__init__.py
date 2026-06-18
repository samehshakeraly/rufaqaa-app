from fastapi import APIRouter

from app.api.v1 import (
    audit,
    auth,
    bank_transfers,
    countries,
    documents,
    donor_portal,
    donor_self,
    donors,
    families,
    guardian_self,
    health,
    marketing_channels,
    media,
    messages,
    organization,
    orphan_self,
    orphanage_self,
    orphanages,
    orphans,
    partners,
    payments,
    platform,
    public,
    reports,
    sponsorships,
    stats,
    twofa,
    users,
    webhooks,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(twofa.router, prefix="/auth/2fa", tags=["auth"])
api_router.include_router(orphans.router, prefix="/orphans", tags=["orphans"])
api_router.include_router(donors.router, prefix="/donors", tags=["donors"])
api_router.include_router(partners.router, prefix="/partners", tags=["partners"])
api_router.include_router(
    marketing_channels.router, prefix="/marketing-channels", tags=["marketing-channels"]
)
api_router.include_router(sponsorships.router, prefix="/sponsorships", tags=["sponsorships"])
api_router.include_router(payments.router, prefix="/payments", tags=["payments"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
api_router.include_router(stats.router, prefix="/stats", tags=["stats"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
api_router.include_router(families.router, prefix="/families", tags=["families"])
api_router.include_router(orphanages.router, prefix="/orphanages", tags=["orphanages"])
api_router.include_router(countries.router, prefix="/countries", tags=["countries"])
api_router.include_router(donor_portal.router, prefix="/me", tags=["donor-portal"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(organization.router, prefix="/organization", tags=["organization"])
api_router.include_router(platform.router, prefix="/platform", tags=["platform"])
api_router.include_router(documents.router, tags=["documents"])
api_router.include_router(bank_transfers.router, prefix="/bank-transfers", tags=["bank-transfers"])
api_router.include_router(public.router, prefix="/public", tags=["public"])
api_router.include_router(donor_self.router, prefix="/donor", tags=["donor-self"])
api_router.include_router(guardian_self.router, prefix="/guardian", tags=["guardian-self"])
api_router.include_router(orphan_self.router, prefix="/orphan", tags=["orphan-self"])
api_router.include_router(orphanage_self.router, prefix="/orphanage", tags=["orphanage-self"])
api_router.include_router(messages.router, prefix="/messages", tags=["messages"])
