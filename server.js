#!/usr/bin/env node
'use strict';

/*
 * Admin Apps — self-hosted launcher for the StuntListing admin team.
 *
 * Zero dependencies: Node 18+ stdlib only. Run with `node server.js`.
 *
 * Shared data (projects + links) lives in one catalog everyone can edit.
 * Each user's layout — page order, link order, favorites, text size,
 * theme — is stored per profile on the server.
 *
 * Storage: a single JSON file (data/db.json), written atomically.
 * Auth: profile picker + signed session cookie. Set ADMIN_PASSWORD to
 * require a shared team password at sign-in.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SEED_FILE = path.join(ROOT, 'seed.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE = 'alsid';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

const SECRET = (() => {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
})();

const uid = () => crypto.randomBytes(6).toString('base64url');
const now = () => Date.now();

function defaultPrefs() {
  return { textScale: 1, theme: 'dark', sortMode: 'custom', projectOrder: [], linkOrder: {}, favorites: [] };
}

function seedDb() {
  const db = { version: 1, users: {}, projects: [], links: [] };
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    const byName = {};
    for (const p of seed.projects || []) {
      const proj = { id: uid(), name: String(p.name), color: p.color || '', createdAt: now(), createdBy: 'seed' };
      byName[proj.name] = proj.id;
      db.projects.push(proj);
    }
    for (const l of seed.links || []) {
      db.links.push({
        id: uid(),
        projectId: byName[l.project] ?? null,
        name: String(l.name),
        url: String(l.url),
        desc: l.desc ? String(l.desc) : '',
        icon: l.icon ? String(l.icon) : '',
        color: l.color || '',
        createdAt: now(),
        createdBy: 'seed',
      });
    }
  } catch { /* no seed file — start empty */ }
  return db;
}

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.users || !db.projects || !db.links) throw new Error('bad shape');
    return db;
  } catch {
    if (fs.existsSync(DB_FILE)) {
      // Never clobber an existing-but-unreadable db; keep a copy aside.
      fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt-' + now());
    }
    return seedDb();
  }
}

let db = loadDb();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
saveDb();

function bump() {
  db.version = (db.version || 0) + 1;
  saveDb();
}

/* ---------- sessions ---------- */

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const makeToken = (id) => `${id}.${sign(id)}`;

function userFromCookie(req) {
  const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  let val;
  try { val = decodeURIComponent(raw.slice(COOKIE.length + 1)); } catch { return null; }
  const i = val.lastIndexOf('.');
  if (i < 1) return null;
  const id = val.slice(0, i);
  const sig = val.slice(i + 1);
  const good = sign(id);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  return db.users[id] || null;
}

const slugify = (name) =>
  name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'user';

const hashEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/* ---------- validation ---------- */

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c);

function cleanUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return p.href;
  } catch {
    return null;
  }
}

function sanitizePrefs(cur, patch) {
  const p = { ...cur };
  if (typeof patch.textScale === 'number' && isFinite(patch.textScale)) {
    p.textScale = Math.min(2.5, Math.max(1, Math.round(patch.textScale * 100) / 100));
  }
  if (patch.theme === 'dark' || patch.theme === 'light') p.theme = patch.theme;
  if (['custom', 'alpha', 'recent'].includes(patch.sortMode)) p.sortMode = patch.sortMode;
  if (Array.isArray(patch.projectOrder)) {
    p.projectOrder = patch.projectOrder.filter((x) => typeof x === 'string').slice(0, 500);
  }
  if (Array.isArray(patch.favorites)) {
    p.favorites = patch.favorites.filter((x) => typeof x === 'string').slice(0, 1000);
  }
  if (patch.linkOrder && typeof patch.linkOrder === 'object' && !Array.isArray(patch.linkOrder)) {
    const lo = {};
    let total = 0;
    for (const [k, v] of Object.entries(patch.linkOrder)) {
      if (!Array.isArray(v)) continue;
      const ids = v.filter((x) => typeof x === 'string');
      total += ids.length;
      if (total > 10000) break;
      lo[String(k).slice(0, 40)] = ids;
    }
    p.linkOrder = lo;
  }
  return p;
}

/* ---------- http plumbing ---------- */

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 262144) {
        reject(Object.assign(new Error('Payload too large.'), { httpCode: 413 }));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Bad JSON.'), { httpCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* ---------- api ---------- */

const loginFails = new Map(); // ip -> { n, until }

function handleLogin(req, res, body) {
  const ip = req.socket.remoteAddress || '?';
  const gate = loginFails.get(ip);
  if (gate && gate.until > now()) return json(res, 429, { error: 'Too many attempts — wait a minute.' });

  const name = str(body.name, 40).replace(/\s+/g, ' ');
  if (!name) return json(res, 400, { error: 'Enter a name.' });

  if (ADMIN_PASSWORD && !hashEq(body.password || '', ADMIN_PASSWORD)) {
    const g = loginFails.get(ip) || { n: 0, until: 0 };
    g.n += 1;
    if (g.n >= 5) { g.until = now() + 60_000; g.n = 0; }
    loginFails.set(ip, g);
    return json(res, 403, { error: 'Wrong team password.' });
  }
  loginFails.delete(ip);

  const id = slugify(name);
  if (!db.users[id]) {
    db.users[id] = { id, name, createdAt: now(), prefs: defaultPrefs() };
    bump();
  }
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken(id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return json(res, 200, { ok: true });
}

async function apiHandler(req, res, pathname) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', 'links', ':id']
  const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : null;

  if (pathname === '/api/boot' && method === 'GET') {
    const users = Object.values(db.users)
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json(res, 200, { users, passwordRequired: !!ADMIN_PASSWORD });
  }

  if (pathname === '/api/login' && method === 'POST') return handleLogin(req, res, body);

  if (pathname === '/api/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return json(res, 200, { ok: true });
  }

  const user = userFromCookie(req);
  if (!user) return json(res, 401, { error: 'Sign in required.' });

  if (pathname === '/api/state' && method === 'GET') {
    return json(res, 200, {
      me: { id: user.id, name: user.name },
      prefs: user.prefs,
      projects: db.projects,
      links: db.links,
      version: db.version,
    });
  }

  if ((pathname === '/api/prefs' && method === 'PUT') || (pathname === '/api/prefs' && method === 'POST')) {
    user.prefs = sanitizePrefs(user.prefs, body || {});
    saveDb();
    return json(res, 200, user.prefs);
  }

  if (pathname === '/api/export' && method === 'GET') {
    res.setHeader('Content-Disposition', 'attachment; filename="adminapps-export.json"');
    return json(res, 200, db);
  }

  /* ----- projects ----- */

  if (pathname === '/api/projects' && method === 'POST') {
    const name = str(body.name, 60);
    if (!name) return json(res, 400, { error: 'Page needs a name.' });
    const proj = {
      id: uid(),
      name,
      color: isHex(body.color) ? body.color : '',
      createdAt: now(),
      createdBy: user.name,
    };
    db.projects.push(proj);
    bump();
    return json(res, 200, proj);
  }

  if (parts[1] === 'projects' && parts[2] && method === 'PATCH') {
    const proj = db.projects.find((p) => p.id === parts[2]);
    if (!proj) return json(res, 404, { error: 'Page not found.' });
    if ('name' in body) {
      const name = str(body.name, 60);
      if (!name) return json(res, 400, { error: 'Page needs a name.' });
      proj.name = name;
    }
    if ('color' in body) proj.color = isHex(body.color) ? body.color : '';
    bump();
    return json(res, 200, proj);
  }

  if (parts[1] === 'projects' && parts[2] && method === 'DELETE') {
    const i = db.projects.findIndex((p) => p.id === parts[2]);
    if (i < 0) return json(res, 404, { error: 'Page not found.' });
    const id = parts[2];
    db.projects.splice(i, 1);
    for (const l of db.links) if (l.projectId === id) l.projectId = null;
    for (const u of Object.values(db.users)) {
      u.prefs.projectOrder = (u.prefs.projectOrder || []).filter((x) => x !== id);
      if (u.prefs.linkOrder) delete u.prefs.linkOrder[id];
    }
    bump();
    return json(res, 200, { ok: true });
  }

  /* ----- links ----- */

  const validProjectId = (v) => {
    if (v === null || v === '') return null;
    return db.projects.some((p) => p.id === v) ? v : undefined; // undefined = invalid
  };

  if (pathname === '/api/links' && method === 'POST') {
    const name = str(body.name, 80);
    const url = cleanUrl(body.url);
    const projectId = validProjectId(body.projectId ?? null);
    if (!name) return json(res, 400, { error: 'Link needs a name.' });
    if (!url) return json(res, 400, { error: 'That URL doesn’t look right.' });
    if (projectId === undefined) return json(res, 400, { error: 'Unknown page.' });
    const link = {
      id: uid(),
      projectId,
      name,
      url,
      desc: str(body.desc, 140),
      icon: str(body.icon, 16),
      color: isHex(body.color) ? body.color : '',
      createdAt: now(),
      createdBy: user.name,
    };
    db.links.push(link);
    bump();
    return json(res, 200, link);
  }

  if (parts[1] === 'links' && parts[2] && method === 'PATCH') {
    const link = db.links.find((l) => l.id === parts[2]);
    if (!link) return json(res, 404, { error: 'Link not found.' });
    if ('name' in body) {
      const name = str(body.name, 80);
      if (!name) return json(res, 400, { error: 'Link needs a name.' });
      link.name = name;
    }
    if ('url' in body) {
      const url = cleanUrl(body.url);
      if (!url) return json(res, 400, { error: 'That URL doesn’t look right.' });
      link.url = url;
    }
    if ('projectId' in body) {
      const pid = validProjectId(body.projectId);
      if (pid === undefined) return json(res, 400, { error: 'Unknown page.' });
      link.projectId = pid;
    }
    if ('desc' in body) link.desc = str(body.desc, 140);
    if ('icon' in body) link.icon = str(body.icon, 16);
    if ('color' in body) link.color = isHex(body.color) ? body.color : '';
    bump();
    return json(res, 200, link);
  }

  if (parts[1] === 'links' && parts[2] && method === 'DELETE') {
    const i = db.links.findIndex((l) => l.id === parts[2]);
    if (i < 0) return json(res, 404, { error: 'Link not found.' });
    const id = parts[2];
    db.links.splice(i, 1);
    for (const u of Object.values(db.users)) {
      u.prefs.favorites = (u.prefs.favorites || []).filter((x) => x !== id);
      for (const key of Object.keys(u.prefs.linkOrder || {})) {
        u.prefs.linkOrder[key] = u.prefs.linkOrder[key].filter((x) => x !== id);
      }
    }
    bump();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'No such endpoint.' });
}

/* ---------- static files ---------- */

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (ext === '.html') {
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
    res.end(buf);
  });
}

/* ---------- server ---------- */

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }
  try {
    if (pathname.startsWith('/api/')) {
      await apiHandler(req, res, pathname);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, pathname);
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (e) {
    const code = typeof e.httpCode === 'number' ? e.httpCode : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: code === 500 ? 'Server error.' : e.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Admin Apps running → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data directory     → ${DATA_DIR}`);
  console.log(ADMIN_PASSWORD ? 'Sign-in requires the team password.' : 'Sign-in is open (set ADMIN_PASSWORD to lock it).');
});
