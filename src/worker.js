/*
 * Admin Apps — Cloudflare Worker.
 *
 * Static files come from the ASSETS binding (./public). Everything under
 * /api/* is handled here, with D1 as the store.
 *
 * Shared catalog (projects + links) is one table set everyone edits.
 * Per-user layout lives in users.prefs as JSON.
 */

import seed from '../seed.json';
import {
  now, uid, str, isHex, slugify, cleanUrl,
  defaultPrefs, sanitizePrefs, rowToProject, rowToLink,
} from './lib.js';

const COOKIE = 'alsid';
const enc = new TextEncoder();

/* ---------- responses ---------- */

const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(init.headers || {}),
    },
  });

const fail = (code, message) => json({ error: message }, { status: code });

/* ---------- session secret ---------- */

let cachedSecret = null;

async function sessionSecret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('session_secret').first();
  if (row?.value) return (cachedSecret = row.value);
  const fresh = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
    .bind('session_secret', fresh).run();
  const again = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('session_secret').first();
  return (cachedSecret = again?.value || fresh);
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    'raw', enc.encode(await sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromB64url(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function makeToken(env, id) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(id));
  return `${id}.${b64url(sig)}`;
}

async function userFromRequest(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  let val;
  try { val = decodeURIComponent(raw.slice(COOKIE.length + 1)); } catch { return null; }
  const i = val.lastIndexOf('.');
  if (i < 1) return null;
  const id = val.slice(0, i);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(val.slice(i + 1)), enc.encode(id));
  } catch { return null; }
  if (!ok) return null;
  const row = await env.DB.prepare('SELECT id, name, prefs FROM users WHERE id = ?').bind(id).first();
  if (!row) return null;
  let prefs;
  try { prefs = sanitizePrefs(defaultPrefs(), JSON.parse(row.prefs || '{}')); } catch { prefs = defaultPrefs(); }
  return { id: row.id, name: row.name, prefs };
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

async function secretEquals(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------- one-time seeding ---------- */

async function seedIfEmpty(env) {
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
    .bind('seeded', '1').run();
  if (!claim.meta?.changes) return; // someone else already seeded

  const stamp = now();
  const stmts = [];
  const byName = {};
  for (const p of seed.projects || []) {
    const id = uid();
    byName[p.name] = id;
    stmts.push(env.DB.prepare(
      'INSERT INTO projects (id, name, color, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(id, String(p.name), p.color || '', stamp, 'seed'));
  }
  for (const l of seed.links || []) {
    stmts.push(env.DB.prepare(
      'INSERT INTO links (id, project_id, name, url, descr, icon, color, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uid(), byName[l.project] ?? null, String(l.name), String(l.url),
        l.desc ? String(l.desc) : '', l.icon ? String(l.icon) : '', l.color || '', stamp, 'seed'));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/* ---------- api ---------- */

const loginFails = new Map(); // best-effort, per-isolate

async function handleLogin(request, env, body) {
  const ip = request.headers.get('CF-Connecting-IP') || '?';
  const gate = loginFails.get(ip);
  if (gate && gate.until > now()) return fail(429, 'Too many attempts — wait a minute.');

  const name = str(body.name, 40).replace(/\s+/g, ' ');
  if (!name) return fail(400, 'Enter a name.');

  if (env.ADMIN_PASSWORD && !(await secretEquals(body.password || '', env.ADMIN_PASSWORD))) {
    const g = loginFails.get(ip) || { n: 0, until: 0 };
    g.n += 1;
    if (g.n >= 5) { g.until = now() + 60_000; g.n = 0; }
    loginFails.set(ip, g);
    return fail(403, 'Wrong team password.');
  }
  loginFails.delete(ip);

  const id = slugify(name);
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, name, created_at, prefs) VALUES (?, ?, ?, ?)')
    .bind(id, name, now(), JSON.stringify(defaultPrefs())).run();

  return json({ ok: true }, {
    headers: {
      'Set-Cookie': `${COOKIE}=${encodeURIComponent(await makeToken(env, id))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
    },
  });
}

async function savePrefs(env, userId, prefs) {
  await env.DB.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(JSON.stringify(prefs), userId).run();
}

/* Drops an id out of every user's saved layout after the thing it points at is deleted. */
async function pruneFromAllPrefs(env, { linkId, projectId }) {
  const { results } = await env.DB.prepare('SELECT id, prefs FROM users').all();
  const updates = [];
  for (const row of results || []) {
    let p;
    try { p = JSON.parse(row.prefs || '{}'); } catch { continue; }
    let touched = false;
    if (projectId) {
      if (Array.isArray(p.projectOrder) && p.projectOrder.includes(projectId)) {
        p.projectOrder = p.projectOrder.filter((x) => x !== projectId);
        touched = true;
      }
      if (p.linkOrder && projectId in p.linkOrder) {
        delete p.linkOrder[projectId];
        touched = true;
      }
    }
    if (linkId) {
      if (Array.isArray(p.favorites) && p.favorites.includes(linkId)) {
        p.favorites = p.favorites.filter((x) => x !== linkId);
        touched = true;
      }
      for (const key of Object.keys(p.linkOrder || {})) {
        if (p.linkOrder[key].includes(linkId)) {
          p.linkOrder[key] = p.linkOrder[key].filter((x) => x !== linkId);
          touched = true;
        }
      }
    }
    if (touched) {
      updates.push(env.DB.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(JSON.stringify(p), row.id));
    }
  }
  if (updates.length) await env.DB.batch(updates);
}

async function api(request, env, url) {
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean); // ['api', 'links', ':id']
  const method = request.method;
  let body = null;
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    const raw = await request.text();
    if (raw.length > 262144) return fail(413, 'Payload too large.');
    try { body = raw ? JSON.parse(raw) : {}; } catch { return fail(400, 'Bad JSON.'); }
  }

  if (path === '/api/boot' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name FROM users ORDER BY name').all();
    return json({ users: results || [], passwordRequired: !!env.ADMIN_PASSWORD });
  }

  if (path === '/api/login' && method === 'POST') return handleLogin(request, env, body);

  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, {
      headers: { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
    });
  }

  const user = await userFromRequest(request, env);
  if (!user) return fail(401, 'Sign in required.');

  if (path === '/api/state' && method === 'GET') {
    const [projects, links] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM projects ORDER BY created_at'),
      env.DB.prepare('SELECT * FROM links ORDER BY created_at'),
    ]);
    return json({
      me: { id: user.id, name: user.name },
      prefs: user.prefs,
      projects: (projects.results || []).map(rowToProject),
      links: (links.results || []).map(rowToLink),
    });
  }

  if (path === '/api/prefs' && (method === 'PUT' || method === 'POST')) {
    const prefs = sanitizePrefs(user.prefs, body || {});
    await savePrefs(env, user.id, prefs);
    return json(prefs);
  }

  if (path === '/api/export' && method === 'GET') {
    const [users, projects, links] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM users'),
      env.DB.prepare('SELECT * FROM projects'),
      env.DB.prepare('SELECT * FROM links'),
    ]);
    return json(
      { users: users.results, projects: projects.results, links: links.results, exportedAt: now() },
      { headers: { 'Content-Disposition': 'attachment; filename="adminapps-export.json"' } });
  }

  /* ----- projects ----- */

  if (path === '/api/projects' && method === 'POST') {
    const name = str(body.name, 60);
    if (!name) return fail(400, 'Page needs a name.');
    const proj = {
      id: uid(), name, color: isHex(body.color) ? body.color : '',
      createdAt: now(), createdBy: user.name,
    };
    await env.DB.prepare('INSERT INTO projects (id, name, color, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .bind(proj.id, proj.name, proj.color, proj.createdAt, proj.createdBy).run();
    return json(proj);
  }

  if (parts[1] === 'projects' && parts[2] && method === 'PATCH') {
    const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(parts[2]).first();
    if (!row) return fail(404, 'Page not found.');
    const next = { ...row };
    if ('name' in body) {
      const name = str(body.name, 60);
      if (!name) return fail(400, 'Page needs a name.');
      next.name = name;
    }
    if ('color' in body) next.color = isHex(body.color) ? body.color : '';
    await env.DB.prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?')
      .bind(next.name, next.color, row.id).run();
    return json(rowToProject(next));
  }

  if (parts[1] === 'projects' && parts[2] && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(parts[2]).first();
    if (!row) return fail(404, 'Page not found.');
    await env.DB.batch([
      env.DB.prepare('UPDATE links SET project_id = NULL WHERE project_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(row.id),
    ]);
    await pruneFromAllPrefs(env, { projectId: row.id });
    return json({ ok: true });
  }

  /* ----- links ----- */

  const validProjectId = async (v) => {
    if (v === null || v === '' || v === undefined) return null;
    const hit = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(v).first();
    return hit ? v : undefined; // undefined = caller passed an unknown page
  };

  if (path === '/api/links' && method === 'POST') {
    const name = str(body.name, 80);
    const url2 = cleanUrl(body.url);
    const projectId = await validProjectId(body.projectId ?? null);
    if (!name) return fail(400, 'Link needs a name.');
    if (!url2) return fail(400, 'That URL doesn’t look right.');
    if (projectId === undefined) return fail(400, 'Unknown page.');
    const link = {
      id: uid(), projectId, name, url: url2,
      desc: str(body.desc, 140), icon: str(body.icon, 16),
      color: isHex(body.color) ? body.color : '',
      createdAt: now(), createdBy: user.name,
    };
    await env.DB.prepare(
      'INSERT INTO links (id, project_id, name, url, descr, icon, color, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(link.id, link.projectId, link.name, link.url, link.desc, link.icon, link.color, link.createdAt, link.createdBy)
      .run();
    return json(link);
  }

  if (parts[1] === 'links' && parts[2] && method === 'PATCH') {
    const row = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(parts[2]).first();
    if (!row) return fail(404, 'Link not found.');
    const next = { ...row };
    if ('name' in body) {
      const name = str(body.name, 80);
      if (!name) return fail(400, 'Link needs a name.');
      next.name = name;
    }
    if ('url' in body) {
      const u = cleanUrl(body.url);
      if (!u) return fail(400, 'That URL doesn’t look right.');
      next.url = u;
    }
    if ('projectId' in body) {
      const pid = await validProjectId(body.projectId);
      if (pid === undefined) return fail(400, 'Unknown page.');
      next.project_id = pid;
    }
    if ('desc' in body) next.descr = str(body.desc, 140);
    if ('icon' in body) next.icon = str(body.icon, 16);
    if ('color' in body) next.color = isHex(body.color) ? body.color : '';
    await env.DB.prepare(
      'UPDATE links SET project_id = ?, name = ?, url = ?, descr = ?, icon = ?, color = ? WHERE id = ?')
      .bind(next.project_id, next.name, next.url, next.descr, next.icon, next.color, row.id).run();
    return json(rowToLink(next));
  }

  if (parts[1] === 'links' && parts[2] && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT id FROM links WHERE id = ?').bind(parts[2]).first();
    if (!row) return fail(404, 'Link not found.');
    await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(row.id).run();
    await pruneFromAllPrefs(env, { linkId: row.id });
    return json({ ok: true });
  }

  return fail(404, 'No such endpoint.');
}

/* ---------- entry ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      await seedIfEmpty(env);
      return await api(request, env, url);
    } catch (err) {
      console.error(err?.stack || String(err));
      return fail(500, 'Server error.');
    }
  },
};
