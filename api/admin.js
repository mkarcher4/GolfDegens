// POST /api/admin  { pin, action, ...args }   — commissioner-only actions
import * as store from '../server/store.js';
import * as L from '../js/league.js';
import { K, loadConfig, loadSchedule, patchWeek, bump, send, body, isAdmin, wrap } from '../server/common.js';

export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = await body(req);
  if (!isAdmin(b.pin)) return send(res, 401, { error: 'Wrong commissioner PIN' });

  const config = await loadConfig();
  const { tournaments } = await loadSchedule(config);
  const week = Number(b.week);
  const t = tournaments.find((x) => x.week === week);
  const needWeek = () => { if (!t) throw Object.assign(new Error('Unknown week'), { status: 404 }); };
  let out = { ok: true };

  switch (b.action) {
    case 'checkPin':
      return send(res, 200, { ok: true });

    case 'setWeek': { // { week, patch: { order, rounds, stake, frlStake, espnEventId, draftLocked } }
      needWeek();
      const allowed = ['order', 'rounds', 'stake', 'frlStake', 'espnEventId', 'draftLocked', 'frl'];
      const patch = {};
      for (const k of allowed) if (k in (b.patch || {})) patch[k] = b.patch[k] === '' || b.patch[k] === null ? undefined : b.patch[k];
      if (patch.order) {
        const ord = patch.order.map((d) => String(d).toUpperCase());
        if (ord.length !== config.degens.length || !config.degens.every((d) => ord.includes(d))) return send(res, 400, { error: `Order must include each of ${config.degens.join(', ')} once` });
        patch.order = ord;
      }
      out.week = await patchWeek(week, patch);
      break;
    }

    case 'uploadOrders': { // { json }
      const json = typeof b.json === 'string' ? JSON.parse(b.json) : b.json;
      const { orders, errors } = L.parseDraftOrders(json, tournaments, config.degens);
      for (const [w, order] of Object.entries(orders)) await patchWeek(Number(w), { order });
      out = { ok: true, saved: Object.keys(orders).length, errors };
      break;
    }

    case 'setMoonshots': { // { week, names: [golfer names] }  (empty list clears)
      needWeek();
      const seen = new Set();
      const names = (b.names || []).map((n) => String(n).trim()).filter((n) => n && !seen.has(L.nameKey(n)) && seen.add(L.nameKey(n)));
      await patchWeek(week, { moonshots: names.length ? names : undefined });
      out.count = names.length;
      break;
    }

    case 'setOdds': { // { week, text }  (empty text clears)
      needWeek();
      const odds = L.parseOddsText(b.text || '');
      await patchWeek(week, { odds: odds.length ? odds : undefined, oddsAt: odds.length ? Date.now() : undefined });
      out.count = odds.length;
      break;
    }

    case 'undoPick':
      needWeek();
      out.removed = await store.pop(K.picks(week));
      break;

    case 'editPick': { // { week, index, golfer: { name, id } } — swap the golfer on an existing pick
      needWeek();
      const [picks] = await store.lists([K.picks(week)]);
      const i = Number(b.index);
      if (!(i >= 0 && i < picks.length)) return send(res, 400, { error: 'That pick hasn\'t been made yet' });
      const name = String((b.golfer && b.golfer.name) || '').trim();
      if (!name) return send(res, 400, { error: 'Enter a golfer name' });
      const key = L.nameKey(name);
      const clash = picks.find((p, j) => j !== i && L.nameKey(p.golfer.name) === key);
      if (clash) return send(res, 409, { error: `${name} is already ${clash.degen}'s pick ${clash.pick}` });
      const updated = { ...picks[i], golfer: { name, id: b.golfer.id ? String(b.golfer.id) : null }, editedAt: Date.now() };
      await store.setAt(K.picks(week), i, updated);
      out.pick = updated;
      break;
    }

    case 'resetDraft':
      needWeek();
      await store.del(K.picks(week));
      break;

    case 'setOverride': { // { week, winner, frl, dfl } — each: golfer name(s), 'none', or null to clear
      needWeek();
      const cur = ((await store.get(K.week(week))) || {}).override || {};
      const norm = (v) => (v == null || v === '' ? undefined : v === 'none' ? 'none' : Array.isArray(v) ? v.filter(Boolean) : v);
      const next = { ...cur };
      for (const k of ['winner', 'frl', 'dfl', 'wd']) if (k in b) next[k] = norm(b[k]);
      if (next.wd === 'none') delete next.wd;
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      await patchWeek(week, { override: Object.keys(next).length ? next : undefined });
      await store.del(K.lb(week)); // recompute with the new overrides on next load
      break;
    }

    case 'refreshResults':
      needWeek();
      await store.del(K.lb(week));
      break;

    case 'setConfig': { // { patch: { degens, commissioner, tierStakes, frlBase, frlStep, dflStake, season } }
      const p = b.patch || {};
      const next = { ...config };
      if (p.degens) next.degens = p.degens.map((d) => String(d).trim().toUpperCase()).filter(Boolean);
      for (const k of ['commissioner', 'leagueName']) if (p[k]) next[k] = String(p[k]);
      for (const k of ['frlBase', 'frlStep', 'dflStake', 'season']) if (p[k] != null && p[k] !== '') next[k] = Number(p[k]);
      if (p.tierStakes) next.tierStakes = Object.fromEntries(Object.entries({ ...config.tierStakes, ...p.tierStakes }).map(([k, v]) => [k, Number(v)]));
      await store.set(K.config, next);
      out.config = next;
      break;
    }

    case 'uploadSchedule': { // { json, year }
      const rows = typeof b.json === 'string' ? JSON.parse(b.json) : b.json;
      if (!Array.isArray(rows) || !rows.every((r) => r.tournament && r.date)) return send(res, 400, { error: 'Schedule must be an array of { date, tournament, course, location, tiers }' });
      const parsed = L.parseSchedule(rows, Number(b.year) || config.season);
      const bad = parsed.filter((x) => !x.start);
      if (bad.length) return send(res, 400, { error: `Couldn't read dates: ${bad.map((x) => x.dateLabel).join(', ')}` });
      await store.set(K.schedule, { rows, year: Number(b.year) || config.season });
      out.count = rows.length;
      break;
    }

    default:
      return send(res, 400, { error: `Unknown action ${b.action}` });
  }
  await bump();
  send(res, 200, out);
});
