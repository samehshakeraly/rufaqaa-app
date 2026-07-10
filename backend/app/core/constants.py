"""Cross-router report constants.

Shared by the per-dar house report (``GET /orphanages/{id}/report``) and the
community follow-up report (``GET /orphans/community-report``). They live
here — not in either router — because the routers import in one direction
only (``orphanages`` → ``orphans``), so neither module could host them for
the other without a cycle. Both routers re-export them unchanged; the two
reports must never drift apart on these definitions.
"""

# A child's file below this completion percentage counts as "incomplete".
FILE_INCOMPLETE_THRESHOLD = 80

# The current reporting window, in days: a child has "reported" when at
# least one non-draft OrphanReport has period_end within this window. There
# is deliberately NO "late"/"overdue" figure — that needs a scheduling model
# (deferred); window_days is exposed so the frontend labels the window
# honestly instead of implying lateness.
REPORT_WINDOW_DAYS = 90
