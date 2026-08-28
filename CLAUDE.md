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
- `h(tag, attrs, ...kids)` always needs the attrs object — `h('tbody', ...rows)`
  silently eats the first child as attrs.
- Analytics is a cache of the Notion "Profiles Analytics" database. Its SQL is
  MySQL against the production `db` and is displayed, never executed — the
  Worker has no route to that database.
- Collector URLs are fired server-side, so `cleanHookUrl` must keep rejecting
  loopback and private ranges. `ALLOW_INSECURE_HOOKS` relaxes that for local
  tests only; never set it in production.
- The cron fires only collectors flagged `auto`. Adding a collector must not
  make anything run on its own.
