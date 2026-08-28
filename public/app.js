'use strict';

/* ---------- tiny DOM helpers ---------- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') {
      // Set via CSSOM, not the style attribute — the CSP (style-src 'self') blocks the latter.
      for (const part of String(v).split(';')) {
        const i = part.indexOf(':');
        if (i > 0) el.style.setProperty(part.slice(0, i).trim(), part.slice(i + 1).trim());
      }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#3e82f7', '#6e56cf', '#d6409f', '#64748b'];
const SCALES = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.25];

function hashColor(s) {
  let x = 0;
  for (const c of s) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[x % PALETTE.length];
}
function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function textOn(bg) {
  const n = parseInt(bg.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#16181d' : '#ffffff';
}

/* ---------- state ---------- */

const S = {
  me: null, prefs: null, projects: [], links: [],
  q: '', route: { kind: 'all' },
  metrics: null, metricsSyncedAt: null, notionConfigured: false, metricsError: null,
  metricsLoading: false, openMetric: null, metricCount: null, ingestEnabled: false,
  views: [], collectors: [], runs: [], collecting: false,
};
let editingLink = null;
let editingProject = null;

/* ---------- api ---------- */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function applyState(st) {
  S.me = st.me;
  S.prefs = st.prefs;
  S.projects = st.projects;
  S.links = st.links;
  if (typeof st.metricCount === 'number') S.metricCount = st.metricCount;
  applyChrome();
  render();
}

async function boot() {
  try {
    applyState(await api('/api/state'));
    $('#login').hidden = true;
    $('#app').hidden = false;
  } catch { /* 401 already routed to login */ }
}

async function refresh() {
  applyState(await api('/api/state'));
}

/* ---------- login ---------- */

async function showLogin() {
  S.me = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  let info = { users: [], passwordRequired: false };
  try { info = await (await fetch('/api/boot')).json(); } catch {}
  $('#pwRow').hidden = !info.passwordRequired;
  $('#profiles').replaceChildren(...info.users.map((u) => {
    const c = hashColor(u.name);
    return h('button', { class: 'profile', type: 'button', onclick: () => doLogin(u.name) },
      h('span', { class: 'profile-avatar', style: `background:${c};color:${textOn(c)}`, 'aria-hidden': 'true', text: initials(u.name) }),
      h('span', { class: 'profile-name', text: u.name }));
  }));
}

async function doLogin(name) {
  const err = $('#loginErr');
  err.hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: { name, password: $('#loginPw').value } });
    await boot();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doLogin($('#loginName').value.trim());
});

/* ---------- prefs (server-synced, debounced) ---------- */

let prefsTimer = null;
let prefsDirty = false;

function savePrefs(patch) {
  Object.assign(S.prefs, patch);
  prefsDirty = true;
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(flushPrefs, 500);
}

async function flushPrefs() {
  if (!prefsDirty) return;
  prefsDirty = false;
  try {
    await api('/api/prefs', { method: 'PUT', body: S.prefs });
  } catch {
    announce('Couldn’t save — check the connection');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && prefsDirty) {
    navigator.sendBeacon('/api/prefs', new Blob([JSON.stringify(S.prefs)], { type: 'application/json' }));
    prefsDirty = false;
  }
});

window.addEventListener('focus', () => {
  if (!S.me || document.querySelector('dialog[open]') || drag.el) return;
  api('/api/state').then(applyState).catch(() => {});
});

/* ---------- chrome (text size, theme, user chip) ---------- */

function applyChrome() {
  const p = S.prefs;
  document.documentElement.style.fontSize = (p.textScale * 100) + '%';
  document.documentElement.dataset.theme = p.theme;
  $('#textPct').textContent = Math.round(p.textScale * 100) + '%';
  $('#themeBtn').textContent = p.theme === 'dark' ? '☀️' : '🌙';
  if (S.me) {
    const c = hashColor(S.me.name);
    $('#userChip').replaceChildren(
      h('span', { class: 'chip-avatar', style: `background:${c};color:${textOn(c)}`, 'aria-hidden': 'true', text: initials(S.me.name) }),
      h('span', { class: 'chip-name', text: S.me.name }));
  }
}

function bumpText(dir) {
  const i = SCALES.findIndex((s) => Math.abs(s - S.prefs.textScale) < 0.01);
  const j = Math.min(SCALES.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
  savePrefs({ textScale: SCALES[j] });
  applyChrome();
  announce('Text size ' + Math.round(SCALES[j] * 100) + '%');
}

$('#textUp').addEventListener('click', () => bumpText(1));
$('#textDown').addEventListener('click', () => bumpText(-1));
$('#themeBtn').addEventListener('click', () => {
  savePrefs({ theme: S.prefs.theme === 'dark' ? 'light' : 'dark' });
  applyChrome();
});
$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
});
$('#helpBtn').addEventListener('click', () => {
  $('#userMenu').open = false;
  $('#helpDialog').showModal();
});
document.addEventListener('click', (e) => {
  const m = $('#userMenu');
  if (m.open && !m.contains(e.target)) m.open = false;
});

/* ---------- announcements ---------- */

let liveTimer = null;
let toastTimer = null;
function announce(msg) {
  const live = $('#live');
  live.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = msg; }, 30);
  const toast = $('#toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

/* ---------- ordering ---------- */

function reconcile(savedIds, items) {
  const by = new Map(items.map((i) => [i.id, i]));
  const out = [];
  for (const id of savedIds || []) {
    const it = by.get(id);
    if (it) { out.push(it); by.delete(id); }
  }
  return out.concat([...by.values()].sort((a, b) => a.createdAt - b.createdAt));
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const byNewest = (a, b) => b.createdAt - a.createdAt;

function linksOf(pid) {
  return S.links.filter((l) => (l.projectId ?? '') === pid);
}
function orderedLinks(pid) {
  const items = linksOf(pid);
  if (S.prefs.sortMode === 'alpha') return items.slice().sort(byName);
  if (S.prefs.sortMode === 'recent') return items.slice().sort(byNewest);
  return reconcile(S.prefs.linkOrder[pid], items);
}
function orderedProjects() {
  return reconcile(S.prefs.projectOrder, S.projects);
}
function favoriteLinks() {
  const by = new Map(S.links.map((l) => [l.id, l]));
  const items = S.prefs.favorites.map((id) => by.get(id)).filter(Boolean);
  if (S.prefs.sortMode === 'alpha') return items.slice().sort(byName);
  if (S.prefs.sortMode === 'recent') return items.slice().sort(byNewest);
  return items;
}

/* ---------- analytics ---------- */

const CAT_COLOR = { Skills: '#e5484d', Users: '#3e82f7', Views: '#f76b15', newsletter: '#d6409f' };
const catColor = (c) => CAT_COLOR[c] || hashColor(c || 'Other');

const fmtNum = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString() : '—');

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function relTime(ms) {
  if (!ms) return 'never';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  const months = Math.round(days / 30.44);
  if (months < 24) return months + (months === 1 ? ' month ago' : ' months ago');
  return Math.round(days / 365.25) + ' years ago';
}

/* Change between the two most recent dated readings. */
function delta(m) {
  const h = m.history || [];
  if (h.length < 2) return null;
  const cur = h[h.length - 1].v;
  const prev = h[h.length - 2].v;
  const diff = cur - prev;
  if (!diff) return null;
  return { diff, pct: prev ? (diff / prev) * 100 : null, since: Date.parse(h[h.length - 2].t) };
}

/* Inline SVG trend line. Decorative — the numbers around it carry the meaning. */
function sparkline(history, color) {
  const pts = (history || []).filter((p) => isFinite(p.v));
  if (pts.length < 2) return null;
  const W = 100, H = 28, PAD = 2;
  const vals = pts.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const fill = document.createElementNS(svg.namespaceURI, 'path');
  fill.setAttribute('d', area);
  fill.setAttribute('fill', color);
  fill.setAttribute('opacity', '0.14');
  const line = document.createElementNS(svg.namespaceURI, 'path');
  line.setAttribute('d', d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(fill, line);
  return svg;
}

async function loadMetrics(force) {
  if (S.metricsLoading) return;
  if (S.metrics && !force) return;
  S.metricsLoading = true;
  try {
    const [d, v, c] = await Promise.all([
      api('/api/metrics'), api('/api/views'), api('/api/collectors'),
    ]);
    S.metrics = d.metrics;
    S.metricsSyncedAt = d.syncedAt;
    S.notionConfigured = d.notionConfigured;
    S.ingestEnabled = !!d.ingestEnabled;
    S.views = v.views;
    S.collectors = c.collectors;
    S.runs = c.runs;
    S.metricsError = null;
  } catch (e) {
    S.metricsError = e.message;
  } finally {
    S.metricsLoading = false;
    render(); // the sidebar carries a metric count, so refresh both panes
  }
}

async function syncMetrics(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  announce('Syncing metrics from Notion');
  try {
    const r = await api('/api/metrics/sync', { method: 'POST' });
    await loadMetrics(true);
    announce(`Synced ${r.count} metrics from Notion`);
  } catch (e) {
    S.metricsError = e.message;
    renderMain();
    announce('Sync failed');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function metricCategories() {
  const seen = new Map();
  for (const m of S.metrics || []) seen.set(m.category, (seen.get(m.category) || 0) + 1);
  return [...seen.entries()].map(([name, count]) => ({ name, count }));
}

function copyText(text, btn) {
  const done = () => { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1200); announce('Query copied'); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  else fallback();
  function fallback() {
    const ta = h('textarea', { class: 'sr-only' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { announce('Copy failed — select the text manually'); }
    ta.remove();
  }
}

function metricCard(m) {
  const color = catColor(m.category);
  const d = delta(m);
  const open = S.openMetric === m.id;
  const trend = d ? (d.diff > 0 ? 'up' : 'down') : 'flat';
  const deltaText = d
    ? `${d.diff > 0 ? '+' : '−'}${Math.abs(d.diff).toLocaleString()}${d.pct != null && isFinite(d.pct) ? ` (${d.diff > 0 ? '+' : '−'}${Math.abs(d.pct).toFixed(d.pct >= 10 ? 0 : 1)}%)` : ''}`
    : '';

  const spark = sparkline(m.history, color);
  const readings = (m.history || []).length;

  return h('div', { class: 'metric' + (open ? ' open' : ''), role: 'listitem' },
    h('button', {
      class: 'metric-head', type: 'button',
      'aria-expanded': String(open),
      onclick: () => { S.openMetric = open ? null : m.id; renderMain(); },
    },
      h('span', { class: 'metric-top' },
        h('span', { class: 'metric-dot', style: `background:${color}`, 'aria-hidden': 'true' }),
        h('span', { class: 'metric-name', text: m.name })),
      h('span', { class: 'metric-figure' },
        h('span', { class: 'metric-value', text: fmtNum(m.value) }),
        d ? h('span', { class: 'metric-delta ' + trend, text: deltaText }) : null),
      spark ? h('span', { class: 'metric-spark' }, spark) : null,
      h('span', { class: 'metric-foot' },
        h('span', { text: m.measuredAt ? 'Measured ' + relTime(m.measuredAt) : 'No reading date' }),
        m.source === 'ingest' ? h('span', { class: 'tag tag-quiet', title: 'Pushed straight in by Zapier', text: 'direct' }) : null,
        readings > 1 ? h('span', { class: 'metric-readings', text: readings + ' readings' }) : null)),
    open ? metricDetail(m, d) : null);
}

function metricDetail(m, d) {
  const rows = (m.history || []).slice().reverse().slice(0, 8);
  return h('div', { class: 'metric-detail' },
    m.notes ? h('p', { class: 'metric-notes', text: m.notes }) : null,
    m.query
      ? h('div', { class: 'metric-sql' },
          h('div', { class: 'metric-sql-head' },
            h('span', { class: 'label-sm', text: 'Query (MySQL, runs against the production db)' }),
            h('button', {
              class: 'btn btn-sm', type: 'button',
              onclick: (e) => copyText(m.query, e.currentTarget),
            }, 'Copy'))
          , h('pre', { class: 'sql', tabindex: '0' }, h('code', { text: m.query })))
      : h('p', { class: 'metric-notes', text: 'No query recorded in Notion for this metric.' }),
    rows.length
      ? h('div', { class: 'metric-history' },
          h('span', { class: 'label-sm', text: 'Readings' }),
          h('table', { class: 'hist' },
            h('tbody', {}, ...rows.map((p) => h('tr', {},
              h('td', { class: 'hist-v', text: p.v.toLocaleString() }),
              h('td', { class: 'hist-t', text: fmtDate(Date.parse(p.t)) }))))))
      : null,
    d && d.since
      ? h('p', { class: 'metric-notes', text: `Change measured against the reading from ${fmtDate(d.since)}.` })
      : null,
    m.notionUrl
      ? h('a', { class: 'metric-link', href: m.notionUrl, target: '_blank', rel: 'noopener' },
          'Open in Notion to refresh this number →')
      : null);
}

function renderAnalytics(main) {
  const r = S.route;

  if (S.metrics === null) {
    loadMetrics();
    main.append(h('div', { class: 'page-head' }, h('h1', { text: 'Analytics' })));
    main.append(h('div', { class: 'empty' }, S.metricsError || 'Loading…'));
    return;
  }

  const cats = metricCategories();
  const all = S.metrics;
  const q = S.q.trim().toLowerCase();
  const inCat = r.category ? all.filter((m) => m.category === r.category) : all;
  const shown = q
    ? inCat.filter((m) => (m.name + ' ' + m.category + ' ' + (m.query || '')).toLowerCase().includes(q))
    : inCat;

  const syncBtn = h('button', { class: 'btn btn-accent', type: 'button' }, 'Sync from Notion');
  syncBtn.addEventListener('click', () => syncMetrics(syncBtn));

  main.append(h('div', { class: 'page-head' },
    h('h1', { text: r.category ? r.category : 'Analytics' }),
    h('span', { class: 'count', text: String(shown.length) }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'synced', text: 'Synced ' + relTime(S.metricsSyncedAt) }),
    syncBtn));

  if (S.metricsError) {
    main.append(h('div', { class: 'banner' }, S.metricsError));
  }

  if (!all.length) {
    main.append(h('div', { class: 'empty' },
      h('b', { text: 'No metrics yet' }),
      h('p', {}, 'Two ways to fill this in — either or both:'),
      h('p', {}, h('b', { text: '1. Pull from Notion. ' }),
        S.notionConfigured
          ? 'Ready — hit “Sync from Notion”.'
          : 'Run wrangler secret put NOTION_TOKEN, share the Profiles Analytics database with that integration, then hit Sync.'),
      h('p', {}, h('b', { text: '2. Have Zapier post them here directly. ' }),
        S.ingestEnabled
          ? 'Ready — POST to /api/metrics/ingest with your ingest token. This skips Notion entirely.'
          : 'Run wrangler secret put INGEST_TOKEN, then add a webhook step to each Zap posting to /api/metrics/ingest. This skips Notion entirely.')));
    return;
  }

  main.append(viewChips(null));

  if (cats.length > 1) {
    const chips = h('div', { class: 'chips' },
      h('a', { class: 'chip' + (!r.category ? ' on' : ''), href: '#/analytics', text: `All (${all.length})` }),
      ...cats.map((c) => h('a', {
        class: 'chip' + (r.category === c.name ? ' on' : ''),
        href: '#/analytics/' + encodeURIComponent(c.name),
      },
        h('span', { class: 'chip-dot', style: `background:${catColor(c.name)}`, 'aria-hidden': 'true' }),
        `${c.name} (${c.count})`)));
    main.append(chips);
  }

  if (!shown.length) {
    main.append(h('div', { class: 'empty' }, h('b', { text: 'Nothing matches' }), 'Try fewer letters.'));
    return;
  }

  if (r.category || q) {
    main.append(h('div', { class: 'metrics', role: 'list' }, ...shown.map(metricCard)));
  } else {
    for (const c of cats) {
      const items = shown.filter((m) => m.category === c.name);
      if (!items.length) continue;
      main.append(
        sectionHead(c.name, catColor(c.name), '#/analytics/' + encodeURIComponent(c.name)),
        h('div', { class: 'metrics', role: 'list' }, ...items.map(metricCard)));
    }
  }
}

/* ---------- views over the metrics ---------- */

const DISPLAYS = [
  ['tiles', 'Tiles'], ['table', 'Table'], ['bars', 'Bar chart'], ['lines', 'Trend lines'],
];
const VIEW_SORTS = [
  ['name', 'Name (A→Z)'], ['value', 'Value (high→low)'],
  ['change', 'Biggest change'], ['measured', 'Most recently measured'],
];

function pctChange(m) {
  const h = m.history || [];
  if (h.length < 2) return 0;
  const prev = h[h.length - 2].v;
  return prev ? ((h[h.length - 1].v - prev) / prev) * 100 : 0;
}

/* Mirrors metricsForView in src/lib.js so a view looks the same before a reload. */
function applyView(config, metrics) {
  const c = config || {};
  let out = metrics;
  if (c.metricIds?.length) {
    const want = new Set(c.metricIds);
    out = out.filter((m) => want.has(m.id));
  } else if (c.categories?.length) {
    const want = new Set(c.categories);
    out = out.filter((m) => want.has(m.category));
  }
  const by = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    value: (a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity),
    change: (a, b) => pctChange(b) - pctChange(a),
    measured: (a, b) => (b.measuredAt ?? 0) - (a.measuredAt ?? 0),
  }[c.sort || 'name'];
  return out.slice().sort(by);
}

function renderTable(items) {
  const head = h('tr', {},
    h('th', { text: 'Metric' }), h('th', { text: 'Category' }),
    h('th', { class: 'num', text: 'Value' }), h('th', { class: 'num', text: 'Change' }),
    h('th', { text: 'Measured' }));
  const rows = items.map((m) => {
    const d = delta(m);
    return h('tr', {},
      h('td', {},
        h('a', { class: 'tbl-name', href: '#/analytics', onclick: (e) => { e.preventDefault(); S.openMetric = m.id; location.hash = '#/analytics/' + encodeURIComponent(m.category); }, text: m.name })),
      h('td', {}, h('span', { class: 'tag', style: `background:${catColor(m.category)}22;color:${catColor(m.category)}`, text: m.category })),
      h('td', { class: 'num strong', text: fmtNum(m.value) }),
      h('td', { class: 'num ' + (d ? (d.diff > 0 ? 'up' : 'down') : ''), text: d ? (d.diff > 0 ? '+' : '−') + Math.abs(d.diff).toLocaleString() : '—' }),
      h('td', { class: 'dim', text: m.measuredAt ? fmtDate(m.measuredAt) : '—' }));
  });
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data' }, h('thead', {}, head), h('tbody', {}, ...rows)));
}

/* Horizontal bars, log-ish scaled so 500k next to 3k stays readable. */
function renderBars(items) {
  const vals = items.map((m) => (typeof m.value === 'number' ? m.value : 0));
  const max = Math.max(...vals, 1);
  return h('div', { class: 'bars' }, ...items.map((m) => {
    const v = typeof m.value === 'number' ? m.value : 0;
    const color = catColor(m.category);
    const pct = max ? Math.max(v > 0 ? 1.5 : 0, (v / max) * 100) : 0;
    const fill = h('span', { class: 'bar-fill' });
    fill.style.setProperty('width', pct.toFixed(2) + '%');
    fill.style.setProperty('background', color);
    return h('div', { class: 'bar-row' },
      h('span', { class: 'bar-label', text: m.name }),
      h('span', { class: 'bar-track' }, fill),
      h('span', { class: 'bar-val', text: fmtNum(m.value) }));
  }));
}

function renderLines(items) {
  const withHistory = items.filter((m) => (m.history || []).length > 1);
  if (!withHistory.length) {
    return h('div', { class: 'empty' }, h('b', { text: 'No history to plot' }),
      'These metrics have fewer than two dated readings in Notion.');
  }
  return h('div', { class: 'lines' }, ...withHistory.map((m) => {
    const color = catColor(m.category);
    const h2 = m.history;
    const first = h2[0], last = h2[h2.length - 1];
    return h('div', { class: 'line-card' },
      h('div', { class: 'line-head' },
        h('span', { class: 'metric-dot', style: `background:${color}`, 'aria-hidden': 'true' }),
        h('span', { class: 'line-name', text: m.name }),
        h('span', { class: 'line-now', text: fmtNum(m.value) })),
      h('div', { class: 'line-chart' }, sparkline(h2, color) || ''),
      h('div', { class: 'line-foot' },
        h('span', { text: `${first.v.toLocaleString()} · ${fmtDate(Date.parse(first.t))}` }),
        h('span', { text: `${last.v.toLocaleString()} · ${fmtDate(Date.parse(last.t))}` })));
  }));
}

function renderMetricList(items, display) {
  if (!items.length) {
    return h('div', { class: 'empty' }, h('b', { text: 'Nothing to show' }),
      'This view’s filters match no metrics.');
  }
  if (display === 'table') return renderTable(items);
  if (display === 'bars') return renderBars(items);
  if (display === 'lines') return renderLines(items);
  return h('div', { class: 'metrics', role: 'list' }, ...items.map(metricCard));
}

function viewChips(activeId) {
  return h('div', { class: 'chips' },
    h('a', { class: 'chip' + (!activeId ? ' on' : ''), href: '#/analytics', text: 'All metrics' }),
    ...S.views.map((v) => h('a', {
      class: 'chip' + (activeId === v.id ? ' on' : ''),
      href: '#/view/' + encodeURIComponent(v.id), text: v.name,
    })),
    h('button', { class: 'chip chip-btn', type: 'button', onclick: () => openViewDialog(null) }, '+ New view'),
    h('a', { class: 'chip chip-quiet', href: '#/collect' }, '⚡ Collection'));
}

function renderView(main) {
  const v = S.views.find((x) => x.id === S.route.id);
  if (!v) { location.hash = '#/analytics'; return; }
  const items = applyView(v.config, S.metrics || []);
  const display = v.config.display || 'tiles';

  main.append(h('div', { class: 'page-head' },
    h('h1', { text: v.name }),
    h('span', { class: 'count', text: String(items.length) }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'synced', text: 'Synced ' + relTime(S.metricsSyncedAt) }),
    h('button', { class: 'btn', type: 'button', onclick: () => openViewDialog(v) }, 'Edit view')));
  main.append(viewChips(v.id));
  main.append(h('p', { class: 'view-meta', text: `${DISPLAYS.find((d) => d[0] === display)?.[1] || 'Tiles'} · sorted by ${VIEW_SORTS.find((x) => x[0] === (v.config.sort || 'name'))?.[1]} · made by ${v.createdBy || 'someone'}` }));
  main.append(renderMetricList(items, display));
}

/* ---------- collection ---------- */

async function fireCollect(id, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Collecting…';
  S.collecting = true;
  try {
    const r = await api('/api/collect' + (id ? '/' + id : ''), { method: 'POST' });
    const bad = r.runs.filter((x) => x.status !== 'ok');
    announce(bad.length
      ? `${bad.length} of ${r.runs.length} failed — see the log`
      : `Collection started (${r.runs.length}) — numbers land in Notion, then sync`);
  } catch (e) {
    announce('Collect failed: ' + e.message);
  } finally {
    S.collecting = false;
    btn.disabled = false;
    btn.textContent = label;
    await loadMetrics(true);
  }
}

function renderCollect(main) {
  main.append(h('div', { class: 'page-head' },
    h('h1', { text: 'Collection' }),
    h('span', { class: 'count', text: String(S.collectors.length) }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', type: 'button', onclick: () => openCollectorDialog(null) }, '+ Add trigger'),
    (() => {
      const b = h('button', { class: 'btn btn-accent', type: 'button' }, 'Collect all now');
      b.addEventListener('click', () => fireCollect(null, b));
      if (!S.collectors.length) b.disabled = true;
      return b;
    })()));
  main.append(viewChips('__collect__'));

  main.append(h('p', { class: 'view-meta' },
    'Each trigger posts to its webhook — the same Zapier hooks you would click in Notion. ',
    'Zapier answers immediately and updates the numbers in the background, so hit ',
    h('a', { href: '#/analytics', text: 'Sync from Notion' }), ' a minute later to pull the new values in.'));

  if (!S.collectors.length) {
    main.append(h('div', { class: 'empty' },
      h('b', { text: 'No triggers yet' }),
      'Add the Zapier catch hook from the Notion page and it becomes a button here.'));
  } else {
    main.append(h('div', { class: 'collectors' }, ...S.collectors.map((c) => {
      const go = h('button', { class: 'btn btn-accent', type: 'button' }, 'Collect now');
      go.addEventListener('click', () => fireCollect(c.id, go));
      const auto = h('input', { type: 'checkbox', id: 'auto-' + c.id });
      auto.checked = c.auto;
      auto.addEventListener('change', async () => {
        try {
          await api('/api/collectors/' + c.id, { method: 'PATCH', body: { auto: auto.checked } });
          c.auto = auto.checked;
          announce(auto.checked ? `${c.name} will run daily` : `${c.name} is manual only`);
        } catch (e) {
          auto.checked = !auto.checked;
          announce('Could not save: ' + e.message);
        }
      });
      return h('div', { class: 'collector' },
        h('div', { class: 'collector-main' },
          h('div', { class: 'collector-name', text: c.name }),
          c.notes ? h('div', { class: 'collector-notes', text: c.notes }) : null,
          h('div', { class: 'collector-url', text: c.url })),
        h('div', { class: 'collector-side' },
          h('label', { class: 'auto-toggle', for: 'auto-' + c.id }, auto, ' Run daily'),
          h('div', { class: 'collector-btns' },
            go,
            h('button', { class: 'btn', type: 'button', onclick: () => openCollectorDialog(c) }, 'Edit'))));
    })));
  }

  main.append(h('h2', { class: 'sec-title', text: 'Recent runs' }));
  if (!S.runs.length) {
    main.append(h('p', { class: 'view-meta', text: 'Nothing has run yet.' }));
  } else {
    main.append(h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', { text: 'Trigger' }), h('th', { text: 'Who' }),
          h('th', { text: 'How' }), h('th', { text: 'When' }),
          h('th', { text: 'Result' }))),
        h('tbody', {}, ...S.runs.map((r) => h('tr', {},
          h('td', { text: r.collectorName }),
          h('td', { text: r.actor }),
          h('td', {}, h('span', { class: 'tag tag-quiet', text: r.trigger })),
          h('td', { class: 'dim', text: new Date(r.startedAt).toLocaleString() }),
          h('td', {}, h('span', {
            class: 'tag ' + (r.status === 'ok' ? 'tag-ok' : r.status === 'error' ? 'tag-bad' : 'tag-quiet'),
            title: r.detail || '', text: r.status,
          }))))))));
  }
}

/* ---------- routing ---------- */

function parseRoute() {
  if (location.hash === '#/collect') return { kind: 'collect' };
  const v = location.hash.match(/^#\/view\/(.+)$/);
  if (v) return { kind: 'view', id: decodeURIComponent(v[1]) };
  const a = location.hash.match(/^#\/analytics(?:\/(.+))?$/);
  if (a) return { kind: 'analytics', category: a[1] ? decodeURIComponent(a[1]) : null };
  const m = location.hash.match(/^#\/(all|favorites|unsorted|p\/(.+))$/);
  if (!m) return { kind: 'all' };
  if (m[2]) return { kind: 'project', id: m[2] };
  return { kind: m[1] };
}
function routePid() {
  if (S.route.kind === 'project') return S.route.id;
  if (S.route.kind === 'unsorted') return '';
  return orderedProjects()[0]?.id ?? '';
}
window.addEventListener('hashchange', () => {
  S.q = '';
  $('#search').value = '';
  render();
});

/* ---------- render: sidebar ---------- */

function navLink(o) {
  return h('a', { class: 'nav-item' + (o.active ? ' active' : ''), href: o.href },
    h('span', { class: 'nav-ico', 'aria-hidden': 'true', text: o.icon }),
    h('span', { class: 'nav-name', text: o.name }),
    o.count != null ? h('span', { class: 'nav-count', text: String(o.count) }) : null);
}

function navRow(p, route) {
  const active = route.kind === 'project' && route.id === p.id;
  const color = p.color || hashColor(p.name);
  const row = h('div', { class: 'nav-row' + (active ? ' active' : ''), draggable: 'true', dataset: { pid: p.id } },
    h('a', { class: 'nav-item', href: '#/p/' + p.id, onkeydown: (e) => projectKeys(e, p) },
      h('span', { class: 'nav-dot', style: `background:${color}`, 'aria-hidden': 'true' }),
      h('span', { class: 'nav-name', text: p.name }),
      h('span', { class: 'nav-count', text: String(linksOf(p.id).length) })),
    h('button', { class: 'nav-edit', 'aria-label': `Edit page ${p.name}`, onclick: () => openProjectDialog(p) }, '✎'));
  return row;
}

function renderSidebar() {
  const nav = $('#sidebar');
  const route = S.route;
  const projs = orderedProjects();
  const unsortedCount = linksOf('').length;
  const favCount = S.prefs.favorites.filter((id) => S.links.some((l) => l.id === id)).length;

  const list = h('div', { class: 'nav-list' });
  wireNavDnD(list);
  for (const p of projs) list.append(navRow(p, route));

  const kids = [
    navLink({ href: '#/favorites', icon: '★', name: 'Favorites', count: favCount, active: route.kind === 'favorites' }),
    navLink({ href: '#/all', icon: '⊞', name: 'All apps', count: S.links.length, active: route.kind === 'all' }),
    h('div', { class: 'nav-label', text: 'Pages' }),
    list,
  ];
  if (unsortedCount) {
    kids.push(navLink({ href: '#/unsorted', icon: '▢', name: 'Unsorted', count: unsortedCount, active: route.kind === 'unsorted' }));
  }
  kids.push(h('div', { class: 'nav-label', text: 'Data' }));
  kids.push(navLink({
    href: '#/analytics', icon: '📈', name: 'Analytics',
    count: S.metrics ? S.metrics.length : S.metricCount,
    active: route.kind === 'analytics',
  }));
  kids.push(h('button', { class: 'btn nav-new', type: 'button', onclick: () => openProjectDialog(null) }, '+ New page'));
  kids.push(h('p', { class: 'nav-hint', text: 'Drag to rearrange · Alt+arrows' }));
  nav.replaceChildren(...kids);
}

/* ---------- render: main ---------- */

function sortSelect() {
  const sel = h('select', {
    class: 'sort-select', 'aria-label': 'Sort apps',
    onchange: (e) => { savePrefs({ sortMode: e.target.value }); render(); },
  },
    h('option', { value: 'custom', text: 'Custom order' }),
    h('option', { value: 'alpha', text: 'A → Z' }),
    h('option', { value: 'recent', text: 'Recently added' }));
  sel.value = S.prefs.sortMode;
  return sel;
}

function pageHeader(title, count, { addPid } = {}) {
  return h('div', { class: 'page-head' },
    h('h1', { text: title }),
    h('span', { class: 'count', text: String(count) }),
    h('span', { class: 'spacer' }),
    sortSelect(),
    h('button', { class: 'btn btn-accent', type: 'button', onclick: () => openLinkDialog(null, addPid) }, '+ Add link'));
}

function sectionHead(name, color, href) {
  return h('div', { class: 'sec-head' },
    h('span', { class: 'dot', style: `background:${color}`, 'aria-hidden': 'true' }),
    h('h2', { text: name }),
    href ? h('a', { class: 'sec-link', href, text: 'Open page →' }) : null);
}

function emptyState(title, sub) {
  return h('div', { class: 'empty' }, h('b', { text: title }), sub);
}

function tile(l, pid) {
  const color = l.color || hashColor(l.name);
  const fav = S.prefs.favorites.includes(l.id);
  const draggable = pid != null && S.prefs.sortMode === 'custom';
  return h('div', { class: 'tile', role: 'listitem', draggable: draggable ? 'true' : 'false', dataset: { id: l.id } },
    h('a', {
      class: 'tile-link', href: l.url, target: '_blank', rel: 'noopener',
      title: l.url, draggable: 'false',
      onkeydown: (e) => tileKeys(e, l, pid),
    },
      h('span', { class: 'tile-icon', style: `background:${color};color:${textOn(color)}`, 'aria-hidden': 'true', text: l.icon || initials(l.name) }),
      h('span', { class: 'tile-text' },
        h('span', { class: 'tile-name', text: l.name }),
        l.desc ? h('span', { class: 'tile-desc', text: l.desc }) : null)),
    h('div', { class: 'tile-actions' },
      h('button', {
        class: 'tact star' + (fav ? ' on' : ''), type: 'button',
        'aria-label': (fav ? 'Remove from favorites: ' : 'Add to favorites: ') + l.name,
        'aria-pressed': String(fav),
        onclick: () => toggleFav(l),
      }, fav ? '★' : '☆'),
      h('button', { class: 'tact', type: 'button', 'aria-label': 'Edit ' + l.name, onclick: () => openLinkDialog(l) }, '✎')));
}

function grid(items, pid) {
  const g = h('div', { class: 'grid', role: 'list', dataset: { pid: pid == null ? '' : pid, drop: pid == null ? '0' : '1' } });
  if (pid != null) wireGridDnD(g);
  for (const l of items) g.append(tile(l, pid));
  return g;
}

function renderMain() {
  const main = $('#main');
  main.replaceChildren();

  if (S.route.kind === 'analytics' || S.route.kind === 'view' || S.route.kind === 'collect') {
    if (S.metrics === null) {
      loadMetrics();
      main.append(h('div', { class: 'page-head' }, h('h1', { text: 'Analytics' })));
      main.append(h('div', { class: 'empty' }, S.metricsError || 'Loading…'));
      return;
    }
    if (S.route.kind === 'view') return renderView(main);
    if (S.route.kind === 'collect') return renderCollect(main);
    return renderAnalytics(main);
  }
  if (S.q.trim()) return renderSearch(main);

  const r = S.route;
  if (r.kind === 'project') {
    const p = S.projects.find((x) => x.id === r.id);
    if (!p) { location.hash = '#/all'; return; }
    const items = orderedLinks(p.id);
    main.append(pageHeader(p.name, items.length, { addPid: p.id }));
    main.append(grid(items, p.id));
    if (!items.length) main.append(emptyState('Nothing here yet', 'Hit “+ Add link” to drop in the first app.'));
  } else if (r.kind === 'favorites') {
    const items = favoriteLinks();
    main.append(pageHeader('Favorites', items.length, { addPid: routePid() }));
    if (items.length) main.append(grid(items, '★'));
    else main.append(emptyState('No favorites yet', 'Hover an app and hit the ★ to pin it here.'));
  } else if (r.kind === 'unsorted') {
    const items = orderedLinks('');
    main.append(pageHeader('Unsorted', items.length, { addPid: '' }));
    main.append(grid(items, ''));
    if (!items.length) main.append(emptyState('All sorted', 'Links land here when their page is deleted.'));
  } else {
    main.append(pageHeader('All apps', S.links.length, { addPid: routePid() }));
    let any = false;
    for (const p of orderedProjects()) {
      const items = orderedLinks(p.id);
      if (!items.length) continue;
      any = true;
      main.append(sectionHead(p.name, p.color || hashColor(p.name), '#/p/' + p.id), grid(items, p.id));
    }
    const un = orderedLinks('');
    if (un.length) {
      any = true;
      main.append(sectionHead('Unsorted', 'var(--dim)', '#/unsorted'), grid(un, ''));
    }
    if (!any) main.append(emptyState('No apps yet', 'Hit “+ Add link” to drop in the first one.'));
  }
}

function renderSearch(main) {
  const q = S.q.trim().toLowerCase();
  const match = (l) => (l.name + ' ' + (l.desc || '') + ' ' + l.url).toLowerCase().includes(q);
  let total = 0;
  const frags = [];
  for (const p of orderedProjects()) {
    const items = orderedLinks(p.id).filter(match);
    if (!items.length) continue;
    total += items.length;
    frags.push(sectionHead(p.name, p.color || hashColor(p.name), '#/p/' + p.id), grid(items, null));
  }
  const un = orderedLinks('').filter(match);
  if (un.length) {
    total += un.length;
    frags.push(sectionHead('Unsorted', 'var(--dim)', '#/unsorted'), grid(un, null));
  }
  main.append(h('div', { class: 'page-head' },
    h('h1', { text: `Results for “${S.q.trim()}”` }),
    h('span', { class: 'count', text: String(total) })));
  if (total) main.append(...frags);
  else main.append(emptyState('Nothing found', 'Try fewer letters.'));
}

function render() {
  S.route = parseRoute();
  renderSidebar();
  renderMain();
}

/* ---------- favorites & keyboard moves ---------- */

function toggleFav(l) {
  const favs = S.prefs.favorites.slice();
  const i = favs.indexOf(l.id);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(l.id);
  savePrefs({ favorites: favs });
  render();
  announce(i >= 0 ? `Removed ${l.name} from favorites` : `${l.name} added to favorites`);
}

function tileKeys(e, l, pid) {
  if (!e.altKey || pid == null) return;
  const delta = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1
    : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : 0;
  if (!delta) return;
  e.preventDefault();
  moveTile(l, pid, delta);
}

function moveTile(l, pid, delta) {
  if (S.prefs.sortMode !== 'custom') {
    announce('Switch sort to “Custom order” to move things');
    return;
  }
  const ids = (pid === '★' ? favoriteLinks() : orderedLinks(pid)).map((x) => x.id);
  const i = ids.indexOf(l.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(i, 1);
  ids.splice(j, 0, l.id);
  if (pid === '★') savePrefs({ favorites: ids });
  else savePrefs({ linkOrder: { ...S.prefs.linkOrder, [pid]: ids } });
  render();
  $(`.tile[data-id="${CSS.escape(l.id)}"] .tile-link`)?.focus();
  announce(`${l.name} — position ${j + 1} of ${ids.length}`);
}

function projectKeys(e, p) {
  if (!e.altKey) return;
  const delta = (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1
    : (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : 0;
  if (!delta) return;
  e.preventDefault();
  const ids = orderedProjects().map((x) => x.id);
  const i = ids.indexOf(p.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  ids.splice(i, 1);
  ids.splice(j, 0, p.id);
  savePrefs({ projectOrder: ids });
  render();
  $(`.nav-row[data-pid="${CSS.escape(p.id)}"] .nav-item`)?.focus();
  announce(`${p.name} — position ${j + 1} of ${ids.length}`);
}

/* ---------- drag and drop ---------- */

const drag = { el: null, kind: null, pid: null };

function nearestChild(container, selector, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const el of container.querySelectorAll(selector + ':not(.dragging)')) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD) { bestD = d; best = { el, r, cx, cy }; }
  }
  return best;
}

function wireGridDnD(g) {
  g.addEventListener('dragover', (e) => {
    if (!drag.el || drag.kind !== 'tile' || drag.pid !== g.dataset.pid) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const b = nearestChild(g, '.tile', e.clientX, e.clientY);
    if (!b) { g.append(drag.el); return; }
    const before = e.clientY < b.r.top || (e.clientY <= b.r.bottom && e.clientX < b.cx);
    g.insertBefore(drag.el, before ? b.el : b.el.nextSibling);
  });
  g.addEventListener('drop', (e) => e.preventDefault());
}

function wireNavDnD(list) {
  list.addEventListener('dragover', (e) => {
    if (!drag.el || drag.kind !== 'nav') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const b = nearestChild(list, '.nav-row', e.clientX, e.clientY);
    if (!b) { list.append(drag.el); return; }
    list.insertBefore(drag.el, e.clientY < b.cy ? b.el : b.el.nextSibling);
  });
  list.addEventListener('drop', (e) => e.preventDefault());
}

document.addEventListener('dragstart', (e) => {
  const t = e.target.closest?.('.tile');
  if (t) {
    if (S.prefs.sortMode !== 'custom') { e.preventDefault(); return; }
    drag.el = t;
    drag.kind = 'tile';
    drag.pid = t.parentElement.dataset.pid;
    e.dataTransfer.setData('text/plain', t.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => t.classList.add('dragging'));
    return;
  }
  const row = e.target.closest?.('.nav-row');
  if (row) {
    drag.el = row;
    drag.kind = 'nav';
    e.dataTransfer.setData('text/plain', row.dataset.pid);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => row.classList.add('dragging'));
  }
});

document.addEventListener('dragend', () => {
  if (!drag.el) return;
  drag.el.classList.remove('dragging');
  if (drag.kind === 'tile') {
    const g = drag.el.parentElement;
    const ids = $$('.tile', g).map((t) => t.dataset.id);
    const pid = g.dataset.pid;
    if (pid === '★') savePrefs({ favorites: ids });
    else savePrefs({ linkOrder: { ...S.prefs.linkOrder, [pid]: ids } });
    announce('Order saved');
  } else if (drag.kind === 'nav') {
    const ids = $$('.nav-row', drag.el.parentElement).map((r) => r.dataset.pid);
    savePrefs({ projectOrder: ids });
    announce('Order saved');
  }
  drag.el = null;
  drag.kind = null;
  drag.pid = null;
});

/* ---------- dialogs ---------- */

$$('button[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

function showErr(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function confirmDlg({ title, msg, yes = 'Delete' }) {
  return new Promise((resolve) => {
    $('#cfTitle').textContent = title;
    $('#cfMsg').textContent = msg;
    $('#cfYes').textContent = yes;
    const d = $('#confirmDialog');
    const done = (v) => {
      d.close();
      $('#cfYes').onclick = $('#cfNo').onclick = d.oncancel = null;
      resolve(v);
    };
    $('#cfYes').onclick = () => done(true);
    $('#cfNo').onclick = () => done(false);
    d.oncancel = () => done(false);
    d.showModal();
  });
}

function buildSwatches(wrap, name, selected) {
  const mk = (value, color) => {
    const input = h('input', { type: 'radio', name, value, class: 'sr-only' });
    input.checked = color ? selected === value : (!selected || !PALETTE.includes(selected));
    return h('label', { class: 'swatch' + (color ? '' : ' swatch-auto'), title: color || 'Automatic color' },
      input,
      h('span', { class: 'sw', style: color ? `background:${color};color:${textOn(color)}` : null, text: color ? '' : 'Auto' }));
  };
  wrap.replaceChildren(mk('', null), ...PALETTE.map((c) => mk(c, c)));
}

function fillProjectSelect(sel, val) {
  sel.replaceChildren(
    ...orderedProjects().map((p) => h('option', { value: p.id, text: p.name })),
    h('option', { value: '', text: '— Unsorted —' }));
  sel.value = S.projects.some((p) => p.id === val) || val === '' ? val : (orderedProjects()[0]?.id ?? '');
}

function openLinkDialog(link, presetPid) {
  editingLink = link;
  $('#linkDlgTitle').textContent = link ? 'Edit link' : 'Add link';
  $('#lfName').value = link?.name || '';
  $('#lfUrl').value = link?.url || '';
  fillProjectSelect($('#lfProject'), link ? (link.projectId ?? '') : (presetPid ?? routePid()));
  $('#lfIcon').value = link?.icon || '';
  buildSwatches($('#lfColors'), 'lfColor', link?.color || '');
  $('#lfDesc').value = link?.desc || '';
  $('#lfDelete').hidden = !link;
  $('#lfErr').hidden = true;
  $('#linkDialog').showModal();
  $('#lfName').focus();
}

$('#linkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#lfErr');
  const name = $('#lfName').value.trim();
  const url = $('#lfUrl').value.trim();
  if (!name) return showErr(err, 'Name it something.');
  if (!url) return showErr(err, 'Paste the URL.');
  const body = {
    name,
    url,
    projectId: $('#lfProject').value || null,
    icon: $('#lfIcon').value.trim(),
    color: $$('input[name=lfColor]').find((r) => r.checked)?.value || '',
    desc: $('#lfDesc').value.trim(),
  };
  try {
    if (editingLink) await api('/api/links/' + editingLink.id, { method: 'PATCH', body });
    else await api('/api/links', { method: 'POST', body });
    $('#linkDialog').close();
    await refresh();
    announce(editingLink ? 'Saved' : 'Link added');
  } catch (ex) {
    showErr(err, ex.message);
  }
});

$('#lfDelete').addEventListener('click', async () => {
  if (!editingLink) return;
  const ok = await confirmDlg({ title: 'Delete link?', msg: `“${editingLink.name}” disappears for everyone on the team.` });
  if (!ok) return;
  try {
    await api('/api/links/' + editingLink.id, { method: 'DELETE' });
    $('#linkDialog').close();
    await refresh();
    announce('Link deleted');
  } catch (ex) {
    showErr($('#lfErr'), ex.message);
  }
});

function openProjectDialog(project) {
  editingProject = project;
  $('#projDlgTitle').textContent = project ? 'Edit page' : 'New page';
  $('#pfName').value = project?.name || '';
  buildSwatches($('#pfColors'), 'pfColor', project?.color || '');
  $('#pfDelete').hidden = !project;
  $('#pfErr').hidden = true;
  $('#projectDialog').showModal();
  $('#pfName').focus();
}

$('#projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#pfErr');
  const name = $('#pfName').value.trim();
  if (!name) return showErr(err, 'Name the page.');
  const body = { name, color: $$('input[name=pfColor]').find((r) => r.checked)?.value || '' };
  try {
    if (editingProject) {
      await api('/api/projects/' + editingProject.id, { method: 'PATCH', body });
      $('#projectDialog').close();
      await refresh();
      announce('Saved');
    } else {
      const proj = await api('/api/projects', { method: 'POST', body });
      $('#projectDialog').close();
      savePrefs({ projectOrder: [...orderedProjects().map((p) => p.id), proj.id] });
      await refresh();
      location.hash = '#/p/' + proj.id;
      announce('Page created');
    }
  } catch (ex) {
    showErr(err, ex.message);
  }
});

$('#pfDelete').addEventListener('click', async () => {
  if (!editingProject) return;
  const ok = await confirmDlg({
    title: 'Delete page?',
    msg: `“${editingProject.name}” goes away for everyone. Its links move to Unsorted — nothing is lost.`,
  });
  if (!ok) return;
  try {
    await api('/api/projects/' + editingProject.id, { method: 'DELETE' });
    $('#projectDialog').close();
    location.hash = '#/all';
    await refresh();
    announce('Page deleted');
  } catch (ex) {
    showErr($('#pfErr'), ex.message);
  }
});

/* ---------- view + collector dialogs ---------- */

let editingView = null;
let editingCollector = null;
let viewPick = { cats: new Set(), ids: new Set() };

function fillSelect(sel, pairs, value) {
  sel.replaceChildren(...pairs.map(([v, label]) => h('option', { value: v, text: label })));
  sel.value = value;
}

function renderViewPickers() {
  const cats = metricCategories();
  $('#vfCats').replaceChildren(...cats.map((c) => {
    const on = viewPick.cats.has(c.name);
    return h('button', {
      class: 'chip' + (on ? ' on' : ''), type: 'button',
      'aria-pressed': String(on),
      onclick: () => {
        if (on) viewPick.cats.delete(c.name); else viewPick.cats.add(c.name);
        renderViewPickers();
      },
    },
      h('span', { class: 'chip-dot', style: `background:${catColor(c.name)}`, 'aria-hidden': 'true' }),
      `${c.name} (${c.count})`);
  }));

  const q = $('#vfPick').value.trim().toLowerCase();
  const list = (S.metrics || []).filter((m) => !q || m.name.toLowerCase().includes(q));
  $('#vfMetrics').replaceChildren(...list.slice(0, 200).map((m) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = viewPick.ids.has(m.id);
    cb.addEventListener('change', () => {
      if (cb.checked) viewPick.ids.add(m.id); else viewPick.ids.delete(m.id);
      renderViewPickers();
    });
    return h('label', { class: 'pick-row' }, cb,
      h('span', { class: 'pick-dot', style: `background:${catColor(m.category)}`, 'aria-hidden': 'true' }),
      h('span', { class: 'pick-name', text: m.name }),
      h('span', { class: 'pick-val', text: fmtNum(m.value) }));
  }));

  const cfg = currentViewConfig();
  const n = applyView(cfg, S.metrics || []).length;
  $('#vfCount').textContent = viewPick.ids.size
    ? `${viewPick.ids.size} metrics picked — categories ignored while any are picked.`
    : `${n} metrics match${viewPick.cats.size ? ' these categories' : ' (everything)'}.`;
}

function currentViewConfig() {
  return {
    display: $('#vfDisplay').value,
    sort: $('#vfSort').value,
    categories: [...viewPick.cats],
    metricIds: [...viewPick.ids],
  };
}

function openViewDialog(view) {
  editingView = view;
  $('#viewDlgTitle').textContent = view ? 'Edit view' : 'New view';
  $('#vfName').value = view?.name || '';
  fillSelect($('#vfDisplay'), DISPLAYS, view?.config?.display || 'tiles');
  fillSelect($('#vfSort'), VIEW_SORTS, view?.config?.sort || 'name');
  viewPick = {
    cats: new Set(view?.config?.categories || []),
    ids: new Set(view?.config?.metricIds || []),
  };
  $('#vfPick').value = '';
  $('#vfDelete').hidden = !view;
  $('#vfErr').hidden = true;
  renderViewPickers();
  $('#viewDialog').showModal();
  $('#vfName').focus();
}

$('#vfPick').addEventListener('input', renderViewPickers);
$('#vfDisplay').addEventListener('change', renderViewPickers);
$('#vfSort').addEventListener('change', renderViewPickers);

$('#viewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#vfErr');
  const name = $('#vfName').value.trim();
  if (!name) return showErr(err, 'Give the view a name.');
  const body = { name, config: currentViewConfig() };
  try {
    if (editingView) {
      await api('/api/views/' + editingView.id, { method: 'PATCH', body });
      $('#viewDialog').close();
      await loadMetrics(true);
      announce('View saved');
    } else {
      const v = await api('/api/views', { method: 'POST', body });
      $('#viewDialog').close();
      await loadMetrics(true);
      location.hash = '#/view/' + v.id;
      announce('View created');
    }
  } catch (ex) {
    showErr(err, ex.message);
  }
});

$('#vfDelete').addEventListener('click', async () => {
  if (!editingView) return;
  const ok = await confirmDlg({ title: 'Delete view?', msg: `“${editingView.name}” goes away for the whole team. The metrics themselves are untouched.` });
  if (!ok) return;
  try {
    await api('/api/views/' + editingView.id, { method: 'DELETE' });
    $('#viewDialog').close();
    location.hash = '#/analytics';
    await loadMetrics(true);
    announce('View deleted');
  } catch (ex) {
    showErr($('#vfErr'), ex.message);
  }
});

function openCollectorDialog(c) {
  editingCollector = c;
  $('#colDlgTitle').textContent = c ? 'Edit trigger' : 'Add trigger';
  $('#cfName').value = c?.name || '';
  $('#cfUrl').value = c?.url || '';
  $('#cfNotes').value = c?.notes || '';
  $('#cfAuto').checked = !!c?.auto;
  $('#cfDelete').hidden = !c;
  $('#cfErr2').hidden = true;
  $('#collectorDialog').showModal();
  $('#cfName').focus();
}

$('#collectorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#cfErr2');
  const name = $('#cfName').value.trim();
  const url = $('#cfUrl').value.trim();
  if (!name) return showErr(err, 'Give the trigger a name.');
  if (!url) return showErr(err, 'Paste the webhook URL.');
  const body = { name, url, notes: $('#cfNotes').value.trim(), auto: $('#cfAuto').checked };
  try {
    if (editingCollector) await api('/api/collectors/' + editingCollector.id, { method: 'PATCH', body });
    else await api('/api/collectors', { method: 'POST', body });
    $('#collectorDialog').close();
    await loadMetrics(true);
    announce(editingCollector ? 'Trigger saved' : 'Trigger added');
  } catch (ex) {
    showErr(err, ex.message);
  }
});

$('#cfDelete').addEventListener('click', async () => {
  if (!editingCollector) return;
  const ok = await confirmDlg({ title: 'Delete trigger?', msg: `“${editingCollector.name}” disappears for everyone. The Zapier hook itself is untouched.` });
  if (!ok) return;
  try {
    await api('/api/collectors/' + editingCollector.id, { method: 'DELETE' });
    $('#collectorDialog').close();
    await loadMetrics(true);
    announce('Trigger deleted');
  } catch (ex) {
    showErr($('#cfErr2'), ex.message);
  }
});

/* ---------- search ---------- */

$('#search').addEventListener('input', (e) => {
  S.q = e.target.value;
  renderMain();
});
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    S.q = '';
    e.target.value = '';
    renderMain();
    e.target.blur();
  } else if (e.key === 'Enter' && S.q.trim()) {
    const first = $('#main .tile-link');
    if (first) { first.click(); announce('Opened ' + $('.tile-name', first.parentElement || first).textContent); }
  }
});

/* ---------- global keys ---------- */

function isTyping(e) {
  const t = e.target;
  return t.closest?.('dialog') || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '');
}

document.addEventListener('keydown', (e) => {
  if (!S.me) return;
  if (e.key === '/' && !isTyping(e)) {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
  } else if ((e.key === 'n' || e.key === 'N') && !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    openLinkDialog(null);
  } else if (e.key === '?' && !isTyping(e)) {
    $('#helpDialog').showModal();
  } else if (e.altKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    bumpText(1);
  } else if (e.altKey && e.key === '-') {
    e.preventDefault();
    bumpText(-1);
  }
});

/* ---------- go ---------- */

boot();
