═══════════════════════════════════════════════════════════════
KICK-OFF MESSAGE FOR CLAUDE CODE — DESIGN PHASE
═══════════════════════════════════════════════════════════════

Copy everything below this line and paste it as the very first
message in a new Claude Code session inside the rufaqaa-app
repository folder.

──────────────── COPY FROM HERE ────────────────

I'm starting a new phase of the Rufaqaa platform: completing
the remaining 22 screen designs. We have 51 mockups already
done; this session is dedicated to designing the remaining 22.

═══════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════

Rufaqaa is an open-source Islamic waqf platform for global orphan
sponsorship. Backend + Frontend + MyFatoorah + Donor self-service
are all built and merged into main. PR #11 just landed the
system-level design alignment (IBM Plex fonts + full color ramps).

The full project context is in:
- CONTEXT_HANDOVER.md (in repo root or docs/)
- docs/design/COMPLETION_PLAN.md (the detailed plan for this phase)
- docs/design/SCREENS_PLAN.md (full 73-screen plan)
- docs/design/GAP_ANALYSIS.md (from previous session)

═══════════════════════════════════════════════════════════════
WHAT EXISTS ALREADY
═══════════════════════════════════════════════════════════════

In docs/design/screens/ you'll find:
- rufaqaa-design-system-v0.1.html  → THE design system reference
- README.md                         → mapping table
- 51 screen mockups in 8 subdirectories:
  * auth/         (5 screens A-01 to A-05)
  * donor/        (10 screens D-01 to D-10)
  * guardian/     (5 screens G-01 to G-05)
  * finance/      (7 screens F-01 to F-07)
  * marketing/    (6 screens MM-01 to MM-06)
  * org-admin/    (8 screens OA-01 to OA-08)
  * partner-mgr/  (4 screens PM-01 to PM-04)
  * partner-staff/(6 screens PS-01 to PS-06)

═══════════════════════════════════════════════════════════════
WHAT NEEDS TO BE BUILT (22 screens, in priority order)
═══════════════════════════════════════════════════════════════

Group 1 — Public Website (6 screens, HIGHEST priority):
  W-01 Landing Page
  W-02 About
  W-03 How It Works
  W-04 Transparency
  W-05 Partner Organizations
  W-06 Contact + FAQ

Group 2 — Orphan Portal 12+ (4 screens):
  O-01 Login
  O-02 Home
  O-03 Send Message to Sponsor
  O-04 My Achievements

Group 3 — Super Admin (4 screens):
  SA-01 Dashboard
  SA-02 Organizations Management
  SA-03 Platform Analytics
  SA-04 Platform Settings

Group 4 — System States (8 states, can be 3 files):
  S-01..S-04 Empty States
  S-05..S-07 Error States (404/403/500)
  S-08      Loading States

═══════════════════════════════════════════════════════════════
DESIGN STANDARDS (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════

Every screen must:
- Use IBM Plex Sans Arabic + IBM Plex Sans (already loaded
  via Google Fonts in docs/design/screens/rufaqaa-design-
  system-v0.1.html)
- Use ONLY the four brand colors from the design system:
  * Snow #F7FBFC (backgrounds)
  * Tranquil #D6E6F2 (cards, panels)
  * Sky #B9D7EA (borders, secondary accents)
  * Trust #769FCD (primary CTAs, links)
- Be RTL by default (dir="rtl" on <html>)
- Be a single self-contained HTML file (inline CSS, no
  external dependencies except Google Fonts)
- Match the visual rhythm of existing mockups
  (look at D-01 Donor Dashboard.html as a style reference)
- Use realistic Arabic content (no lorem ipsum, no
  placeholder English text)
- File size: 50-80KB typical, up to 100KB acceptable

Never:
- Use real photos of children (privacy)
- Use Noto Sans Arabic, Tajawal, Inter, or any other font
- Use emoji as functional icons (SVG only)
- Use bright reds/oranges as primary colors (only as warnings)
- Reference any external CSS or JS files

═══════════════════════════════════════════════════════════════
WORKFLOW FOR THIS SESSION
═══════════════════════════════════════════════════════════════

For each screen:

1. I will give you the screen code (e.g., "Start W-01").
2. You will:
   a. Open docs/design/COMPLETION_PLAN.md and read the spec
      for that screen carefully
   b. Open one existing mockup as a style reference
      (D-01 or A-01 are good)
   c. Create the new HTML file at the correct path:
      docs/design/screens/public/W-01-LandingPage.html
      (or wherever the plan specifies)
   d. Commit with message format:
      "design(public): W-01 Landing Page"
   e. Stop and wait for my review before moving to the next
3. I will review by opening the file in my browser
4. If approved, I say "Approved, next: W-02"
5. If changes needed, I tell you what to fix
6. Repeat

Rules during this session:
- ONE screen at a time. Never start the next screen until
  I approve the previous one.
- Don't commit if any inline CSS error exists.
- Don't reference content from other screens unless the plan
  asks you to.
- If the spec is unclear, ASK before guessing.
- Don't touch any other part of the codebase (backend,
  frontend React, etc.). Design files only.

═══════════════════════════════════════════════════════════════
FIRST TASK
═══════════════════════════════════════════════════════════════

Before we begin designing, verify the foundation:

1. Confirm you can read docs/design/screens/rufaqaa-design-
   system-v0.1.html
2. Confirm you can read docs/design/COMPLETION_PLAN.md
3. Confirm you can read 2-3 existing mockups
   (suggest: D-01, A-01, OA-01)
4. List the file structure of docs/design/ so I can see
   you have the right context

After your verification, wait for my next message:
"Start W-01 Landing Page".

──────────────── COPY UP TO HERE ────────────────

═══════════════════════════════════════════════════════════════
INSTRUCTIONS FOR SAMEH (don't paste these to Claude Code)
═══════════════════════════════════════════════════════════════

Before starting the new Claude Code session:

1. Make sure your local repository is up to date:
   cd ~/Projects/rufaqaa-app
   git checkout main
   git pull origin main

2. Make sure docs/design/COMPLETION_PLAN.md is committed to
   the repo. If not, copy it from your Downloads:
   cp ~/Downloads/COMPLETION_PLAN.md docs/design/
   git add docs/design/COMPLETION_PLAN.md
   git commit -m "docs: add completion plan for remaining 22 screens"
   git push origin main

3. Open Claude Code in the repo folder.

4. Paste the kick-off message above as the first message.

5. After Claude Code verifies the foundation, send:
   "Start W-01 Landing Page"

6. When W-01 is done, review it in your browser:
   open docs/design/screens/public/W-01-LandingPage.html

7. Reply with either:
   - "Approved, next: W-02"
   - Or specific feedback on what to change

8. After each screen finishes, push to main and move on.

═══════════════════════════════════════════════════════════════
TIPS FOR THE SESSION
═══════════════════════════════════════════════════════════════

- Take breaks. Don't try to do all 22 in one day.
- Review screens on actual devices (Mac browser, iPhone).
- If Claude Code drifts from the design system, point to a
  specific existing mockup and say "Match the visual rhythm
  of this file".
- Save approved screens before moving on — git commit + push
  after every approval.
- If something looks off, ask Claude Code to compare its
  output against a reference mockup line by line.

═══════════════════════════════════════════════════════════════
END OF KICK-OFF PACKAGE
═══════════════════════════════════════════════════════════════
