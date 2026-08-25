# Admin Apps

A self-hosted launcher for the StuntListing admin team — like the StuntListing apps page, but for the tools the admins live in all day.

- **Pages per project.** Links are organized into pages (StuntListing Site, Content, Marketing, …). The sidebar lists them; each page is bookmarkable (`#/p/<id>`).
- **Shared catalog, personal layout.** Links and pages are one shared team catalog — anyone can add, edit, or delete. But *how it's arranged is yours alone*: your page order, your link order, your favorites, your text size and theme are stored per profile **on the server**, so your layout follows you to any machine.
- **Sorting.** Drag tiles (and sidebar pages) to rearrange, or switch to A→Z / Recently added. Keyboard: `Alt`+arrows moves the focused tile.
- **Built for heavy users.** Short names, tiny optional notes, no clutter. `/` to search everything, `Enter` opens the first hit, `n` to add a link.
- **Low-vision friendly.** A−/A+ control scales the entire interface from 100% to 225% (persisted per user), high-contrast dark and light themes, full keyboard support, visible focus rings, screen-reader announcements.
- **Desktop-first.** Wide grid and sidebar; it degrades acceptably on small screens but the desktop is the point.

No frameworks, no build step, no npm installs. One Node process, one JSON data file.

## Run it

```bash
node server.js
# → http://localhost:8090
```

Requires Node 18+. First visitor picks a name and gets a profile; everyone after picks theirs from the sign-in screen.

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8090` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Where `db.json` (all data + per-user prefs) lives |
| `ADMIN_PASSWORD` | *(unset)* | If set, sign-in requires this shared team password |

### Docker

```bash
docker build -t adminapps .
docker run -d -p 8090:8090 -v adminapps-data:/data -e ADMIN_PASSWORD=… adminapps
```

### systemd

```ini
[Unit]
Description=Admin Apps launcher
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/adminapps/server.js
Environment=PORT=8090 DATA_DIR=/var/lib/adminapps
# Environment=ADMIN_PASSWORD=…
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Data

Everything lives in `DATA_DIR/db.json`, written atomically on every change. Back it up by copying the file, or grab **Export data (JSON)** from the user menu (`GET /api/export`).

`seed.json` in the repo root defines the starter pages/links used the first time the server boots with an empty data directory. Edit it before first launch to pre-load the team's catalog.

## Security notes

- This is an internal tool. Run it inside the VPN / private network, or put it behind your reverse proxy's auth. `ADMIN_PASSWORD` adds a shared gate at sign-in; profiles themselves are open by design (pick-your-name, like a team whiteboard).
- Sessions are HMAC-signed cookies; the signing key is generated into `DATA_DIR/secret.key` on first boot.
- Only `http(s)` URLs are accepted for links; the frontend never injects user content as HTML.

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
