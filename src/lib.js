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
