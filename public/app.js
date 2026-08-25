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

/* ---------- routing ---------- */

function parseRoute() {
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
