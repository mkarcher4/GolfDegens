import * as store from './store.js';
import * as L from '../js/league.js';
import bundledSchedule, { SEASON_YEAR } from '../js/schedule-data.js';

export const K = {
  config: 'gd:config',
  schedule: 'gd:schedule',
  ver: 'gd:ver',
  week: (n) => `gd:week:${n}`,
  picks: (n) => `gd:picks:${n}`,
  lb: (n) => `gd:lb:${n}`,
};

export async function loadConfig() {
  const c = await store.get(K.config);
  return { ...L.DEFAULT_CONFIG, ...(c || {}), tierStakes: { ...L.DEFAULT_CONFIG.tierStakes, ...((c && c.tierStakes) || {}) } };
}

export async function loadSchedule(config) {
  const custom = await store.get(K.schedule);
  const rows = (custom && custom.rows) || bundledSchedule;
  const year = (custom && custom.year) || config.season || SEASON_YEAR;
  return { rows, year, tournaments: L.parseSchedule(rows, year) };
}

export async function loadWeek(n) {
  const [rec] = await store.mget([K.week(n)]);
  const [picks] = await store.lists([K.picks(n)]);
  return { ...(rec || {}), picks };
}

export async function loadAllWeeks(tournaments) {
  const weeks = tournaments.map((t) => t.week);
  const recs = await store.mget(weeks.map(K.week));
  const picks = await store.lists(weeks.map(K.picks));
  const out = {};
  weeks.forEach((w, i) => {
    if (recs[i] || picks[i].length) out[w] = { ...(recs[i] || {}), picks: picks[i] };
  });
  return out;
}

export async function patchWeek(n, patch) {
  const cur = (await store.get(K.week(n))) || {};
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await store.set(K.week(n), next);
  return next;
}

export const bump = () => store.incr(K.ver);

export function send(res, status, body, headers = {}) {
  // `cdn` = edge-cache rule for Vercel's CDN only; phones always revalidate.
  const { cdn, ...rest } = headers;
  for (const [k, v] of Object.entries(rest)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (cdn) res.setHeader('CDN-Cache-Control', cdn);
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

export function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

// PINs come from Vercel environment variables. If a PIN isn't set, that gate is open.
export const pinOk = (pin, envName) => !process.env[envName] || String(pin || '') === String(process.env[envName]);
export const isAdmin = (pin) => pinOk(pin, 'ADMIN_PIN');

export function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      send(res, e.status || 500, { error: e.message || 'Server error' });
    }
  };
}
