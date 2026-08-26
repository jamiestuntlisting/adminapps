# Admin Apps

A launcher for the StuntListing admin team — like the StuntListing apps page, but for the tools the admins live in all day. Runs on Cloudflare Workers with D1.

- **Pages per project.** Links are organized into pages (StuntListing, Content & Blog, Email & Marketing, …). The sidebar lists them; each page is bookmarkable (`#/p/<id>`).
- **Shared catalog, personal layout.** Links and pages are one shared team catalog — anyone can add, edit, or delete. But *how it's arranged is yours alone*: your page order, your link order, your favorites, your text size and theme are stored per profile **on the server**, so your layout follows you to any machine.
- **Sorting.** Drag tiles (and sidebar pages) to rearrange, or switch to A→Z / Recently added. Keyboard: `Alt`+arrows moves the focused tile.
- **Built for heavy users.** Short names, tiny optional notes, no clutter. `/` to search everything, `Enter` opens the first hit, `n` to add a link.
- **Low-vision friendly.** A−/A+ scales the entire interface from 100% to 225% (persisted per user), high-contrast dark and light themes, full keyboard support, visible focus rings, screen-reader announcements.
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

The D1 database (`adminapps`) already exists and its schema is applied. To ship the Worker:

```bash
npx wrangler login    # once, opens a browser
npm run deploy
```

That publishes to `adminapps.<your-subdomain>.workers.dev`. To put it on a custom domain (e.g. `apps.stuntlisting.com`), add a route in `wrangler.toml` or map it in the Cloudflare dashboard under Workers → adminapps → Domains & Routes.

If the schema ever needs reapplying: `npm run db:remote`.

### Lock it down

The app is a name-based profile picker by default — fine behind a VPN, not fine on the open internet. Two options, best used together:

1. **Shared password.** `npx wrangler secret put ADMIN_PASSWORD` — sign-in then requires it.
2. **Cloudflare Access** (recommended). Put a Zero Trust Access policy in front of the Worker's hostname and restrict it to your team's emails. Then the profile picker is just "who am I", not a security boundary.

Optionally `npx wrangler secret put SESSION_SECRET` to pin the cookie-signing key; otherwise one is generated into the D1 `meta` table on first use.

## Data

Three tables in D1: `projects`, `links`, and `users` (each user's layout as JSON in `users.prefs`). Grab a full dump any time from **Export data (JSON)** in the user menu (`GET /api/export`).

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
