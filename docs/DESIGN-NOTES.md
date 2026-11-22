# Design notes (the canvas work, Nov 2026)

Source of truth for the look: the "LifeOS Dashboard" design canvas (artifact f89b9dbd). This file records the decisions so they survive the canvas. Rules from `CLAUDE.md` still apply (read-only agent, never overwrite or delete user data, no new pages).

## Style rules
- Dark first, light by colour map (`lib/theme.mjs`). Cards radius 16, inner tiles and inputs 12, pills 999, sheets 24 to 32. Fonts: Space Grotesk (titles, numbers), IBM Plex Sans (text), IBM Plex Mono (small labels).
- Section tabs are text with a dot between: `TRACKER · INFORMATION`. No pill islands for filters.
- Card titles that act like a heading (Home month, Health "Weekly Activity") are Space Grotesk 17 px.
- Every section page: back arrow, big title, then content. Sections get 34 px of space above the back arrow so it clears the search and settings buttons.
- Round icon buttons (52 px) for add actions, bottom corners, above the nav island. Sheets are glass (blur) and close with the scrim (`aria-label="Close"`).
- Priority is a coloured dot (Low green, Medium amber, High red), not a word.
- Avoid redundant numbers. No tile calendar: the Home calendar is borderless with a week strip and a month toggle.

## Home (design only, not merged)
Header "Sun / Nov 22"; Capture | Reflect as text tabs; habits as a grid plus icon row; borderless calendar; task edit sheet (title, due, time, priority, project, repeat). Quick links are circular icons. Work was removed from the nav and the sidebar.

## Areas (design only, not merged)
One swipe stack with a page per area and a graph each: Health (four rings: steps, lifts, cardio, PT), MMA (weekly minutes), Spiritual (28-day ring), Finances (spending donut). Looping, dots only while swiping.

## Projects (design only, not merged)
Gauge tiles grouped by status (Active, On hold, Done), tabs `ALL · ACTIVE · ON HOLD · DONE`, detail with status switch, context, goal, notes, attachments, task sheet and log sheet.

## Merged into the real pages (v1.9.58)
- **Health** (`Health.dc.html`, `HealthPhone.dc.html`): the Weekly Activity card has a Home-style week strip (MON to SUN with dates). Dots under a date show what was done that day: lifts, cardio, PT (the legend colours). Arrows step a week. The old day arrows and the M-T-W circle row are gone. The heart opens Samsung Health (`ql.samsung`; app manifest needs the package in `<queries>`, LifeOS-Mobile 1.7.5). The Training grid opens GymMane (already so since v1.9.54). Phone top padding 34 px.
- **Finances**: net worth (all time, from the entries), spending this month (budget from `FINANCE_BUDGET` in `.env`, default 15,000, daily bars, pace line, categories Food, Transport, School, Bills, Health, Fun, Other), recent entries, assets with sparkline (bank icon, stock icon, peso for Cash). Round (-) bottom left: Spend or To cash. Round (+) bottom right: deposit into an asset. Tap an asset: deposit or withdraw sheet, History opens the old detail view. Spending is a withdraw with `category:` and `note:` (see below). Moving to cash is a withdraw on the source and a deposit on Cash.
- **MMA**: `TRACKER · INFORMATION`. Tracker: 12-week minutes graph, sessions, minutes, average intensity, `+ Log training` sheet (style, minutes, intensity 1 to 10, notes, today or yesterday), by style (30 days), history. Information is the existing library list (search, four groups with icons, counts, + for a note).
- **Spiritual**: same tabs. Tracker: 28-day dot ring (streak, longest, month, week), practice circles (Prayer, Meditation, Scripture), reading progress (book and chapters, a check logs the next chapter, a book button for the future Bible app), verse to memorize. Information is the existing library list.

## Vault format (the backend)
- Finances, `1 Human/13 Finance/Assets/<Asset>.md`, `## Log`: `- 2026-11-22 -- withdraw, amount: 350, category: Transport, note: Grab`. Only a withdraw has a category. A plain withdraw is not spending.
- MMA, `1 Human/12 MMA/Tracker/Training/Training.md`, `## Log`: `- 2026-11-22 -- style: Boxing, minutes: 60, intensity: 7, notes: pads and bag`.
- Spiritual: Prayer and Meditation are the `## Habits` checkboxes of the daily notes (never copied). Scripture, `1 Human/06 Spiritual/Tracker/Reading/Reading.md`: `## Plan` `- book: John, chapters: 21`; `## Log` `- 2026-11-22 -- chapter: John 7`. Verse, `Tracker/Memorize/Memorize.md`, `## Verses`: `- 2026-11-22 -- John 15:5 -- the verse text` (newest line shown).
- Routes: `/api/finance` (cat, note, budget), `/api/mma`, `/api/spiritual` (plus `/read`, `/plan`, `/memorize`), `/api/habits`.

## Not merged yet (still design only)
Home, Tasks, Calendar, Projects, Areas stack, the shared desktop shell (sidebar without Work), pinned search and settings buttons, the (-)/(+) buttons on desktop use fixed positions. The real pages still show Work in the sidebar. Needs Jess's go for each: they carry the real task, calendar, project and agent logic.

## Open
- Bible app package name (placeholder `com.lifeos.bible`).
- Real brand logos for assets (not fetchable here): icons are generic.
- hub.py has not been run for the new Tracker folders.
- Nothing from this list has run on the real phone.
