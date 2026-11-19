// GET /api/leaderboard?week=N
// Live ESPN leaderboard for a tournament, normalized. Cached ~30s (CDN + Redis) so six phones
// don't each hit ESPN. Saves winner / FRL / DFL results to the week, and a final snapshot
// once the tournament is over so history never depends on ESPN again.
import * as store from '../server/store.js';
import * as L from '../js/league.js';
import { K, loadConfig, loadSchedule, patchWeek, bump, send, query, wrap } from '../server/common.js';
import { fetchEspnEvent } from '../server/espn.js';

const TTL_MS = 30_000;

export default wrap(async (req, res) => {
  const q = query(req);
  const week = Number(q.week);
  const config = await loadConfig();
  const { tournaments } = await loadSchedule(config);
  const t = tournaments.find((x) => x.week === week);
  if (!t) return send(res, 404, { error: 'Unknown week' });

  const cached = await store.get(K.lb(week));
  const fresh = !q.force && cached && (cached.final || Date.now() - cached.ts < TTL_MS);
  if (fresh) return send(res, 200, cached, cacheHeaders(cached));

  const rec = (await store.get(K.week(week))) || {};
  const fmt = L.weekFormat(t, rec);
  let raw = null;
  try { raw = await fetchEspnEvent(t, rec); } catch (e) { console.warn(e); }

  if (!raw) {
    const body = cached ? { ...cached, stale: true } : { week, ts: Date.now(), available: false, event: null, players: [], results: L.computeResults(null, fmt) };
    if (!cached) await store.set(K.lb(week), body);
    return send(res, 200, body, { cdn: 'max-age=60' });
  }

  const lb = L.normalizeEspnEvent(raw);
  const results = L.computeResults(lb, fmt);
  const body = {
    week,
    ts: Date.now(),
    available: true,
    final: lb.state === 'post',
    event: { id: lb.id, name: lb.name, state: lb.state, period: lb.period, detail: lb.detail, start: lb.start },
    players: lb.players.map(slim),
    results,
  };
  await store.set(K.lb(week), body);

  // Persist results when something new is known.
  const prev = rec.result || {};
  const changed = prev.final !== results.final || prev.frlFinal !== results.frlFinal
    || JSON.stringify(prev.winner) !== JSON.stringify(results.winner)
    || JSON.stringify(prev.frlLeaders) !== JSON.stringify(results.frlLeaders)
    || JSON.stringify(prev.dfl) !== JSON.stringify(results.dfl);
  const patch = {};
  if (changed && (results.frlFinal || results.final)) patch.result = { final: results.final, frlFinal: results.frlFinal, winner: results.winner, frlLeaders: results.frlLeaders, dfl: results.dfl };
  if (!rec.espnEventId && lb.id) patch.espnEventId = lb.id;
  if (Object.keys(patch).length) { await patchWeek(week, patch); if (patch.result) await bump(); }

  send(res, 200, body, cacheHeaders(body));
});

const cacheHeaders = (b) => ({ cdn: b.final ? 'max-age=3600' : 'max-age=30' });

// Trim per-hole data before storing/sending.
function slim(p) {
  return {
    id: p.id, name: p.name, key: p.key, pos: p.pos, posNum: p.posNum, toPar: p.toPar, status: p.status,
    today: p.today, todayStr: p.todayStr, thru: p.thru, order: p.order,
    rounds: p.rounds.map((r) => ({ strokes: r.strokes, toPar: r.toPar, holes: r.holes, started: r.started })),
  };
}
