// POST /api/pick  { week, degen, golfer: { name, id }, by, pin, adminPin }
// Records a draft pick if it's that Degen's turn and the golfer is still available.
import * as store from '../server/store.js';
import * as L from '../js/league.js';
import { K, loadConfig, loadSchedule, bump, send, body, pinOk, isAdmin, wrap } from '../server/common.js';

export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = await body(req);
  const admin = b.adminPin && isAdmin(b.adminPin);
  if (!admin && !pinOk(b.pin, 'LEAGUE_PIN')) return send(res, 401, { error: 'Wrong league PIN' });

  const week = Number(b.week);
  const config = await loadConfig();
  const { tournaments } = await loadSchedule(config);
  const t = tournaments.find((x) => x.week === week);
  if (!t) return send(res, 404, { error: 'Unknown week' });

  const rec = (await store.get(K.week(week))) || {};
  if (!rec.order || !rec.order.length) return send(res, 409, { error: 'Draft order not set for this week yet' });
  if (rec.draftLocked) return send(res, 409, { error: 'Draft is locked' });
  const fmt = L.weekFormat(t, rec);
  const [picks] = await store.lists([K.picks(week)]);
  const clock = L.onTheClock(rec.order, fmt, picks);
  if (!clock) return send(res, 409, { error: 'Draft is complete' });
  if (clock.degen !== b.degen) return send(res, 409, { error: `It's ${clock.degen}'s pick`, picks });
  if (!admin && b.by !== clock.degen) return send(res, 403, { error: `Only ${clock.degen} (or the commissioner) can make this pick` });

  const name = String((b.golfer && b.golfer.name) || '').trim();
  if (!name) return send(res, 400, { error: 'Missing golfer' });
  const key = L.nameKey(name);
  if (picks.some((p) => L.nameKey(p.golfer.name) === key)) return send(res, 409, { error: `${name} is already taken`, picks });

  const pick = { pick: clock.pick, round: clock.round, degen: clock.degen, dfl: !!clock.dfl, golfer: { name, id: b.golfer.id ? String(b.golfer.id) : null }, at: Date.now() };
  const ok = await store.pushIfLen(K.picks(week), picks.length, pick);
  if (!ok) {
    const [now] = await store.lists([K.picks(week)]);
    return send(res, 409, { error: 'Someone picked at the same moment — refreshing', picks: now });
  }
  await bump();
  send(res, 200, { ok: true, pick, picks: [...picks, pick] });
});
