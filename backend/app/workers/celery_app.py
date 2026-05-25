"""Celery application factory.

The Celery worker process imports `celery_app` from this module. Tasks
live in sibling modules (e.g. `app.workers.tasks.sponsorships`) and are
auto-discovered.

Run locally:
    celery -A app.workers.celery_app worker --loglevel=info
    celery -A app.workers.celery_app beat --loglevel=info     # scheduler
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "rufaqaa",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks.sponsorships"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone=settings.TZ,
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,
    task_soft_time_limit=270,
    worker_max_tasks_per_child=200,
    broker_connection_retry_on_startup=True,
)

# Scheduled tasks (Celery beat). Times are in the configured timezone.
celery_app.conf.beat_schedule = {
    "mark-overdue-sponsorships-daily": {
        "task": "app.workers.tasks.sponsorships.mark_overdue_sponsorships",
        "schedule": crontab(hour=2, minute=0),
    },
}
