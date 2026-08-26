# Admin Apps — working notes

## Preferences

- **Always include clickable links** for any task handed back to the user —
  dashboards, repo branches, docs, Notion pages. Never describe a destination
  without linking it.

## Project

Cloudflare Worker + D1. See README.md for setup, deploy, and API.

- Worker name: `adminapps` (the unrelated existing `stlapps` Worker is the
  original StuntListing apps page — don't collide with it)
- D1 database: `adminapps` — `89101d86-aaab-482b-ba6f-235a758e01d1`
- `npm run dev` runs the real Worker locally against a local D1

## Conventions

- Frontend is plain HTML/CSS/JS in `public/`, no build step. Everything sizes
  in `rem` so the A−/A+ control scales the whole UI; don't introduce `px`
  font sizes or fixed heights on text containers.
- Validation lives once, in `src/lib.js`, shared by all routes.
- Deleting a page or link must scrub its id from every user's saved prefs
  (`pruneFromAllPrefs`) so nobody keeps a dangling favorite.
