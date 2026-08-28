/* Validation and shaping helpers shared by the Worker's API routes. */

export const now = () => Date.now();

export function uid() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c);

export function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'user';
}

export function cleanUrl(raw) {
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

export function defaultPrefs() {
  return { textScale: 1, theme: 'dark', sortMode: 'custom', projectOrder: [], linkOrder: {}, favorites: [] };
}

export function sanitizePrefs(cur, patch) {
  const p = { ...defaultPrefs(), ...cur };
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

/* Rows come out of D1 in snake_case; the client speaks camelCase. */

export const rowToProject = (r) => ({
  id: r.id, name: r.name, color: r.color, createdAt: r.created_at, createdBy: r.created_by,
});

export const rowToLink = (r) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  url: r.url,
  desc: r.descr,
  icon: r.icon,
  color: r.color,
  createdAt: r.created_at,
  createdBy: r.created_by,
});

/* ---------- analytics ---------- */

/*
 * Notion's "Historical Record" is free text a human has appended to over
 * years, newest first, one reading per line:
 *
 *   204  01/26/26 04:50PM
 *   187  06/05/25 04:54PM
 *   162 08/07/2024 1:27 PM
 *   18592 07/16/24
 *   Was 0
 *
 * Dates are 2- or 4-digit years, time optional, AM/PM sometimes spaced.
 * Lines without a parseable date ("Was 0", "20 Before Push") are dropped —
 * they carry a value but nothing to plot it against.
 *
 * Returns [{t, v}] sorted oldest first, t as an ISO date string.
 */
export function parseHistory(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out = [];
  const lines = text.split(/<br\s*\/?>|[\r\n]+/);
  for (const line of lines) {
    const m = line.match(
      /^\s*([\d,]+)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
    if (!m) continue;
    const v = Number(m[1].replace(/,/g, ''));
    if (!isFinite(v)) continue;
    const month = Number(m[2]);
    const day = Number(m[3]);
    let year = Number(m[4]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let hour = m[5] ? Number(m[5]) : 12;
    const min = m[6] ? Number(m[6]) : 0;
    const ampm = (m[7] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    if (hour > 23 || min > 59) continue;
    const d = new Date(Date.UTC(year, month - 1, day, hour, min));
    if (isNaN(d.getTime())) continue;
    out.push({ t: d.toISOString(), v });
  }
  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return out;
}

/* Flattens a Notion property into the plain value we store. */
export function notionProp(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title': return (prop.title || []).map((t) => t.plain_text).join('').trim();
    case 'rich_text': return (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
    case 'number': return typeof prop.number === 'number' ? prop.number : null;
    case 'select': return prop.select?.name || '';
    case 'last_edited_time': return prop.last_edited_time || '';
    default: return null;
  }
}

export const rowToMetric = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  value: r.value,
  query: r.query,
  notes: r.notes,
  notionUrl: r.notion_url,
  history: (() => { try { return JSON.parse(r.history || '[]'); } catch { return []; } })(),
  measuredAt: r.measured_at,
  syncedAt: r.synced_at,
  source: r.source || 'notion',
});

/* ---------- collection + views ---------- */

export const DISPLAYS = ['tiles', 'table', 'bars', 'lines'];
export const VIEW_SORTS = ['name', 'value', 'change', 'measured'];

/*
 * Collector URLs are entered by admins and fired server-side, so keep them to
 * public https endpoints — no plain http, no loopback or private hosts.
 */
export function cleanHookUrl(raw, opts = {}) {
  const u = cleanUrl(raw);
  if (!u) return null;
  const p = new URL(u);
  // The loopback/private-range block is the SSRF guard; local dev sets
  // ALLOW_INSECURE_HOOKS so tests can point at a stub instead of a real hook.
  if (opts.allowInsecure) return u;
  if (p.protocol !== 'https:') return null;
  const host = p.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]') return null;
  if (/^(10|127)\./.test(host)) return null;
  if (/^192\.168\./.test(host)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  if (/^169\.254\./.test(host)) return null;
  if (/^0\./.test(host)) return null;
  return u;
}

export function sanitizeViewConfig(patch) {
  const c = patch && typeof patch === 'object' ? patch : {};
  const out = {
    display: DISPLAYS.includes(c.display) ? c.display : 'tiles',
    sort: VIEW_SORTS.includes(c.sort) ? c.sort : 'name',
    categories: Array.isArray(c.categories)
      ? [...new Set(c.categories.filter((x) => typeof x === 'string').map((x) => x.slice(0, 60)))].slice(0, 20)
      : [],
    metricIds: Array.isArray(c.metricIds)
      ? [...new Set(c.metricIds.filter((x) => typeof x === 'string'))].slice(0, 200)
      : [],
  };
  return out;
}

/* A view with neither filter shows everything. */
export function metricsForView(config, metrics) {
  const c = sanitizeViewConfig(config);
  let out = metrics;
  if (c.metricIds.length) {
    const want = new Set(c.metricIds);
    out = out.filter((m) => want.has(m.id));
  } else if (c.categories.length) {
    const want = new Set(c.categories);
    out = out.filter((m) => want.has(m.category));
  }
  const change = (m) => {
    const h = m.history || [];
    if (h.length < 2) return 0;
    const prev = h[h.length - 2].v;
    return prev ? ((h[h.length - 1].v - prev) / prev) * 100 : 0;
  };
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    value: (a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity),
    change: (a, b) => change(b) - change(a),
    measured: (a, b) => (b.measuredAt ?? 0) - (a.measuredAt ?? 0),
  }[c.sort];
  return out.slice().sort(by);
}

export const rowToCollector = (r) => ({
  id: r.id, name: r.name, url: r.url, notes: r.notes,
  auto: !!r.auto, createdAt: r.created_at, createdBy: r.created_by,
});

export const rowToRun = (r) => ({
  id: r.id,
  collectorId: r.collector_id,
  collectorName: r.collector_name,
  trigger: r.trigger_kind,
  actor: r.actor,
  status: r.status,
  detail: r.detail,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export const rowToView = (r) => ({
  id: r.id,
  name: r.name,
  config: (() => { try { return sanitizeViewConfig(JSON.parse(r.config || '{}')); } catch { return sanitizeViewConfig({}); } })(),
  createdAt: r.created_at,
  createdBy: r.created_by,
});
