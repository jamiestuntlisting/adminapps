# Admin Apps

A launcher for the StuntListing admin team — like the StuntListing apps page, but for the tools the admins live in all day. Runs on Cloudflare Workers with D1.

- **Pages per project.** Links are organized into pages (StuntListing, Content & Blog, Email & Marketing, …). The sidebar lists them; each page is bookmarkable (`#/p/<id>`).
- **Shared catalog, personal layout.** Links and pages are one shared team catalog — anyone can add, edit, or delete. But *how it's arranged is yours alone*: your page order, your link order, your favorites, your text size and theme are stored per profile **on the server**, so your layout follows you to any machine.
- **Sorting.** Drag tiles (and sidebar pages) to rearrange, or switch to A→Z / Recently added. Keyboard: `Alt`+arrows moves the focused tile.
- **Built for heavy users.** Short names, tiny optional notes, no clutter. `/` to search everything, `Enter` opens the first hit, `n` to add a link.
- **Low-vision friendly.** A−/A+ scales the entire interface from 100% to 225% (persisted per user), high-contrast dark and light themes, full keyboard support, visible focus rings, screen-reader announcements.
- **Analytics.** Mirrors the Notion "Profiles Analytics" database — current value, trend sparkline, change since the previous reading, and the SQL Notion stores for each metric.
- **Saved views.** Build your own views over those metrics: pick categories or individual metrics, show them as tiles, a table, bars, or trend lines, sorted how you like. Shared with the team.
- **Collection.** The Zapier hooks that refresh the numbers become buttons in the app. Click to collect now, or flag a trigger to run daily on its own. Every run is logged with who asked for it.
- **Desktop-first.** Wide grid and sidebar; it degrades acceptably on small screens but the desktop is the point.

No frontend framework and no build step — the browser gets the same `public/` files that are in the repo.

## Layout

```
public/          static frontend (index.html, app.js, styles.css, _headers)
src/worker.js    the Worker: /api/* routes, D1 queries, sessions
src/lib.js       validation + row shaping shared by those routes
schema.sql       D1 tables
seed.json        starter catalog, loaded once into an empty database
wrangler.toml    Worker config + D1 binding
```

## Develop

```bash
npm install
npm run db:local     # create the tables in the local D1
npm run dev          # http://localhost:8090
```

`wrangler dev` runs the real Worker against a local D1, so local behavior matches production.

## Deploy

Pushes to the default branch deploy automatically via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml), which runs
`wrangler deploy`. You can also run it by hand from the Actions tab
(`workflow_dispatch`).

It needs one repository secret, set under
**Settings → Secrets and variables → Actions**:

| Secret | Required | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | yes | "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | only if the token can see more than one account | |

**Schema changes are not automatic.** Applying `schema.sql` goes through D1's
import endpoint, which needs `D1 Edit` on the token — the deploy token doesn't
have it. After editing `schema.sql`, run `npm run db:remote` yourself from a
machine logged in via `wrangler login`. (Grant the token D1 Edit and the step
can move into the workflow; it's commented at the top of the file.)

To deploy from your own machine instead:

```bash
npx wrangler login
npm run deploy
```

Either way it publishes to `adminapps.<your-subdomain>.workers.dev`. To put it
on a custom domain (e.g. `apps.stuntlisting.com`), add a route in
`wrangler.toml` or map it in the Cloudflare dashboard under
Workers → adminapps → Domains & Routes.

### Lock it down

The app is a name-based profile picker by default — fine behind a VPN, not fine on the open internet. Two options, best used together:

1. **Shared password.** `npx wrangler secret put ADMIN_PASSWORD` — sign-in then requires it.
2. **Cloudflare Access** (recommended). Put a Zero Trust Access policy in front of the Worker's hostname and restrict it to your team's emails. Then the profile picker is just "who am I", not a security boundary.

Optionally `npx wrangler secret put SESSION_SECRET` to pin the cookie-signing key; otherwise one is generated into the D1 `meta` table on first use.

## Analytics

The Analytics section is a read-through cache of the Notion **Profiles
Analytics** database. Each metric carries its current number, the dated
readings from Notion's "Historical Record" field (rendered as a trend line and
a change-since-last-reading), and the SQL that defines it.

**Those queries are not executed here.** They are MySQL, written against the
production `db` (`db.user`, `db.skill_sets`, `db.activity_log`, …), which this
Worker has no route to. The app shows each query so an admin can read or copy
it, and links back to the Notion row where the existing update flow lives.
Notion remains the source of truth; "Sync from Notion" re-pulls.

To enable the sync:

1. Create an internal integration at <https://www.notion.so/my-integrations>
   and copy its secret.
2. `npx wrangler secret put NOTION_TOKEN`
3. In Notion, open the Profiles Analytics database → **⋯ → Connections** → add
   that integration. Without this the API returns no rows.

`NOTION_DATABASE_ID` in `wrangler.toml` points at the database; change it there
to sync a different one. A sync replaces the cached rows wholesale, so metrics
deleted in Notion disappear here too. A failed sync leaves the last good cache
in place.

If you ever want the numbers refreshed *here* rather than in Notion, that needs
a route from the Worker to the production MySQL — Cloudflare Hyperdrive plus a
read-only user would be the path. None is configured today.

### Views

**Analytics → + New view** builds a saved view: name it, pick whole categories
or individual metrics, and choose how it draws — tiles, table, bar chart, or
trend lines — and how it sorts. Picking individual metrics overrides the
category filter. Views are shared with the team and attributed to whoever made
them, like the link catalog; each gets its own URL (`#/view/<id>`).

### Collection

**Analytics → ⚡ Collection** is where the Zapier hooks live. Add a trigger with
its catch-hook URL (the same link you would click on the Notion page) and it
becomes a button:

- **Collect now** posts to that hook, attributed to you.
- **Run daily** opts a trigger into the cron in `wrangler.toml` (12:00 UTC).
  Nothing runs automatically until a trigger is flagged, and the scheduled run
  is logged as `Schedule` rather than a person.
- **Recent runs** shows trigger, who, manual vs scheduled, when, and result.

Zapier catch hooks answer immediately and do the work afterwards, so a green
`ok` means *accepted*, not *finished*. The new numbers land in Notion a moment
later — hit **Sync from Notion** to pull them in. The scheduled run does that
sync itself, one cycle behind.

Hook URLs are entered in the UI and stored in D1, never committed. They must be
public `https` — loopback and private ranges are rejected, since the Worker
fetches them server-side.

## Data

Seven tables in D1: `projects`, `links`, `users` (each user's layout as JSON in `users.prefs`), `metrics` (the Notion analytics cache), `views`, `collectors`, and `collection_runs`. Grab a full dump any time from **Export data (JSON)** in the user menu (`GET /api/export`).

`seed.json` is loaded exactly once, the first time the app runs against an empty database — a `meta` row records that it happened, so redeploys never duplicate it. Edit it before first launch to change the starting catalog; after that, add links in the UI.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/boot` | Profiles for the sign-in screen; whether a password is required |
| `POST` | `/api/login` | Create/resume a profile, set the session cookie |
| `POST` | `/api/logout` | Clear the cookie |
| `GET` | `/api/state` | Everything the app renders: me, prefs, projects, links |
| `PUT` | `/api/prefs` | Save this user's layout |
| `POST`/`PATCH`/`DELETE` | `/api/projects[/:id]` | Manage pages |
| `POST`/`PATCH`/`DELETE` | `/api/links[/:id]` | Manage links |
| `GET` | `/api/metrics` | Cached analytics metrics + last sync time |
| `POST` | `/api/metrics/sync` | Re-pull the metrics from Notion |
| `GET` | `/api/views` | Saved views |
| `POST`/`PATCH`/`DELETE` | `/api/views[/:id]` | Manage views |
| `GET` | `/api/collectors` | Triggers + the recent run log |
| `POST`/`PATCH`/`DELETE` | `/api/collectors[/:id]` | Manage triggers |
| `POST` | `/api/collect[/:id]` | Fire one trigger, or all of them |
| `GET` | `/api/export` | Full JSON dump |

Deleting a page moves its links to Unsorted rather than deleting them. Deleting either scrubs the id out of every user's saved layout, so nobody is left with a dangling favorite.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Search |
| `Enter` (in search) | Open first result |
| `n` | Add a link |
| `Alt` + arrows | Move focused tile / page (Custom order) |
| `Alt` + `+` / `−` | Text size |
| `Esc` | Clear search / close dialog |
| `?` | Help |
