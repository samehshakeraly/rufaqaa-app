"""Cross-router report constants.

Shared by the per-dar house report (``GET /orphanages/{id}/report``) and the
community follow-up report (``GET /orphans/community-report``). They live
here — not in either router — because the routers import in one direction
only (``orphanages`` → ``orphans``), so neither module could host them for
the other without a cycle. Both routers re-export them unchanged; the two
reports must never drift apart on these definitions.

Overdue IS now modelled: ``app.core.reporting.report_due_status`` classifies
a child as on_track / due_soon / overdue from the org's cadence
(``organizations.report_cadence_days``, falling back to
``DEFAULT_REPORT_CADENCE_DAYS``) plus ``REPORT_OVERDUE_GRACE_DAYS``.
``REPORT_WINDOW_DAYS`` stays for the existing house and community reports
until they migrate onto the cadence model.
"""

# A child's file below this completion percentage counts as "incomplete".
FILE_INCOMPLETE_THRESHOLD = 80

# The current reporting window, in days: a child has "reported" when at
# least one non-draft OrphanReport has period_end within this window. The
# existing reports still use this fixed window; window_days is exposed so
# the frontend labels the window honestly.
REPORT_WINDOW_DAYS = 90

# Fallback reporting cadence, in days, when an organization has not set its
# own ``report_cadence_days``. Matches REPORT_WINDOW_DAYS so behaviour is
# unchanged until an org opts into a custom cadence.
DEFAULT_REPORT_CADENCE_DAYS = 90

# Days past the due date before "due_soon" hardens into "overdue".
REPORT_OVERDUE_GRACE_DAYS = 7
