// GET /api/state?only=ver            -> { ver }                       (cheap poll)
// GET /api/state?week=N              -> config, schedule, ver, that week's record + picks
// GET /api/state?all=1               -> config, schedule, ver, every week's record + picks
import * as store from '../server/store.js';
import { K, loadConfig, loadSchedule, loadWeek, loadAllWeeks, send, query, wrap } from '../server/common.js';

export default wrap(async (req, res) => {
  const q = query(req);
  const ver = Number((await store.get(K.ver)) || 0);
  if (q.only === 'ver') return send(res, 200, { ver });

  const config = await loadConfig();
  const schedule = await loadSchedule(config);
  const out = { ver, config, schedule: { rows: schedule.rows, year: schedule.year }, storage: store.usingRedis ? 'redis' : 'memory' };
  if (q.all) out.weeks = await loadAllWeeks(schedule.tournaments);
  else if (q.week) out.week = await loadWeek(Number(q.week));
  send(res, 200, out);
});
