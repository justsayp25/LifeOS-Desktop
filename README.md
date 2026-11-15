# LifeOS web app

The dashboard, running on your computer and connected to the vault.

## Run it
1. Install Node.js (LTS) if you don't have it: https://nodejs.org
2. Double-click `start.bat` (or run `node server.mjs` in this folder).
3. Open http://localhost:4100. A window narrower than 760 px gets the phone layout. Add `?view=desktop` to the address to force the desktop one.

The first run copies `.env.example` to `.env`. Edit `VAULT_PATH` there if your vault moves. No install step, no packages.
The sidebar says "vault connected" when the link works.

## What is connected to the vault
| Screen | Reads from / writes to |
|---|---|
| Habits (Home, Performance) | `## Habits` in the daily note. Ticks you make in Obsidian show up here within ~20 s. Never changes your 1-5 scores. |
| Focus, Captures, Reflections (Home) | The same sections of today's daily note. If the note changed in Obsidian meanwhile, the app refreshes instead of overwriting. |
| Tasks | Any checkbox line in `1 Human`, with inline fields (`[due:: ...] [time:: ...] [priority:: ...] [project:: [[...]]] [repeat:: ...]`). New tasks go to the project's `## Tasks`, or to `03 Tasks/Current Tasks/Current Tasks.md`. Ticking adds `✅ date` and a repeating task spawns its next one. Not scanned: Journal, Inbox, Knowledge study checklists, daily notes older than 7 days. Finished tasks stay on the page for 3 days, then drop off it (the ticked line stays in its note; change with DONE_DAYS in .env). |
| Calendar events | `## Appointments` in that day's daily note (`- 17:00-18:30 Title`, `- All day Title`). A day with no note yet gets one from the Daily template. |
| Projects | `04 Projects/<Name>/<Name>.md`: status, due date, Goal, Context, Tasks, Related, Notes and today's Log entries. New projects use the Project template. |
| Finances | `13 Finance/Assets/<Asset>.md`, `- date -- deposit, amount: N` under `## Log`. |
| Health trackers | `11 Health/Tracker`: Lifts (`### date` + `- Exercise -- 3x8 @ 60`), Runs, Physical Therapy, Recovery. |
| Library notes (Health info, MMA, Spiritual, Knowledge) | `.md` files in the matching folders, from the Note template. Tags go in frontmatter. Photos and PDFs go to `10 Resources/Photos` / `PDFs` and are embedded under `## Attachments`. |
| Work | Its own page, same as the other library pages, over `14 Work` (one section per folder). |
| Areas | The folder tree of each area, read live from the vault. |
| Search | Click the sidebar Search box or press Ctrl+K. Searches note titles and text (not Journal or daily notes) and opens the note in Obsidian. |
| Performance reviews | Reviews under `16 Performance Review`, from the template. |

## Rules the server follows
- Never writes to `1 Human/05 Journal`, `1 Human/01 Inbox` or `2 Machine`. Journal entries show in Knowledge, read-only.
- Never deletes a file. Deleting a note or review moves it to `1 Human/99 Bin` and empties `connections:`. Removing a task, event, finance entry or log line from the app removes that line only.
- Never overwrites a note with the same name. Renaming a note is refused when other notes link to it (Obsidian fixes links itself, the app can't).
- If the vault can't be reached, the sidebar says "vault not connected" and pages fall back to browser-only storage.

## Not connected yet
Hevy and Strava. Samsung Health numbers come from the phone app (`/api/health/phone`).

## Claude chat
The Agent button runs Claude Code on this computer, read-only inside the vault, with web search. Install Claude Code and run `claude` once to sign in. Needs this computer on.

## Phone
Without a home server the phone can only reach this on the same Wi-Fi with `HOST=0.0.0.0` in `.env`. There is no password yet, so only do that on a network you trust. Once open on the phone, "Add to Home screen" installs it.
