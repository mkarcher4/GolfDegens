// Golf Degens — league rules engine.
// Pure functions only (no DOM, no network) so the browser and the API share one copy.

export const DEFAULT_CONFIG = {
  season: 2027,
  leagueName: 'Golf Degens',
  degens: ['CC', 'GW', 'JR', 'JS', 'MK', 'MM'],
  commissioner: 'MK',
  tierStakes: { 1: 30, 2: 20, 3: 15 },
  frlBase: 5,      // FRL stake per Degen when the pot resets
  frlStep: 1,      // added per Degen each week the FRL goes unwon
  dflStake: 5,     // Tour Championship dead-last side pot, per Degen
};

// ───────────────────────── Schedule ─────────────────────────

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const monthIdx = (s) => MONTHS[String(s).toLowerCase().replace('.', '').slice(0, s.toLowerCase().startsWith('sept') ? 4 : 3)];
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseDateRange(text, year) {
  const m = String(text).trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2})\s*[-–]\s*(?:([A-Za-z]+)\.?\s+)?(\d{1,2})$/);
  if (!m) return { start: null, end: null };
  const m1 = monthIdx(m[1]);
  const m2 = m[3] ? monthIdx(m[3]) : m1;
  return { start: iso(year, m1, +m[2]), end: iso(year, m2, +m[4]) };
}

// Marks in the schedule file: "+" signature event, "#" major, "^" co-sanctioned.
const MARKS = { '+': 'Signature', '#': 'Major', '^': 'Co-sanctioned' };

export function cleanTournamentName(name) {
  return String(name).replace(/\s*[+#^]+\s*$/, '').trim();
}

export function formatFor(t, roundsOverride) {
  const isTourChamp = /\btour championship\b/i.test(t.name);
  if (isTourChamp) return { rounds: roundsOverride || 4, dfl: true, mmgwCount: roundsOverride || 4, label: '4 rounds + DFL' };
  const rounds = roundsOverride || (Number(t.tier) === 1 ? 8 : 6);
  return { rounds, dfl: false, mmgwCount: rounds >= 8 ? 5 : 4, label: `${rounds} rounds` };
}

export function parseSchedule(rows, year) {
  return rows.map((r, i) => {
    const mark = (String(r.tournament).match(/([+#^])\s*$/) || [])[1] || null;
    const { start, end } = parseDateRange(r.date, year);
    const t = {
      week: i + 1,
      name: cleanTournamentName(r.tournament),
      tag: mark ? MARKS[mark] : null,
      dateLabel: r.date,
      course: r.course,
      location: r.location,
      tier: Number(r.tiers ?? r.tier ?? 3),
      start,
      end,
    };
    t.format = formatFor(t);
    return t;
  });
}

// Week to open by default: the one containing today; otherwise the next one; after the season, the last.
export function currentWeek(tournaments, todayISO) {
  const hit = tournaments.find((t) => t.start <= todayISO && todayISO <= t.end);
  if (hit) return hit.week;
  const next = tournaments.find((t) => t.start > todayISO);
  return next ? next.week : tournaments[tournaments.length - 1].week;
}

export function weekFormat(t, rec) {
  return formatFor(t, rec && rec.rounds ? Number(rec.rounds) : null);
}

export function stakeFor(t, rec, config) {
  if (rec && rec.stake != null && rec.stake !== '') return Number(rec.stake);
  return Number(config.tierStakes[t.tier] ?? 0);
}

// ───────────────────────── Draft ─────────────────────────

// Full snake sequence. The DFL round (Tour Championship) continues the snake.
export function snakeSequence(order, fmt) {
  const total = fmt.rounds + (fmt.dfl ? 1 : 0);
  const seq = [];
  for (let r = 1; r <= total; r++) {
    const ord = r % 2 === 1 ? order : [...order].reverse();
    for (const degen of ord) seq.push({ pick: seq.length + 1, round: r, degen, dfl: fmt.dfl && r === total });
  }
  return seq;
}

export function onTheClock(order, fmt, picks) {
  if (!order || !order.length) return null;
  const seq = snakeSequence(order, fmt);
  return seq[picks.length] || null; // null => draft complete
}

// ───────────────────────── Names & odds ─────────────────────────

export function nameKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseAmericanOdds(s) {
  const m = String(s).trim().match(/^([+\-−]?)(\d{2,6})$/);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === '-' || m[1] === '−' ? -n : n;
}

export function impliedProb(odds) {
  if (odds == null) return 0;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

export function fmtOdds(odds) {
  if (odds == null) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}

// Accepts text pasted from DraftKings or a spreadsheet:
//   "Scottie Scheffler +450", "Scottie Scheffler\t450", or a name line followed by an odds line.
export function parseOddsText(text) {
  const out = [];
  let pendingName = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) continue;
    const solo = parseAmericanOdds(line.replace(/\s/g, ''));
    if (solo != null && pendingName) {
      out.push({ name: pendingName, odds: solo });
      pendingName = null;
      continue;
    }
    const m = line.match(/^(.*?[A-Za-zÀ-ÿ.'’)])[\s,\t:]+([+\-−]?\d{2,6})\s*$/);
    if (m && /[A-Za-z]/.test(m[1])) {
      out.push({ name: m[1].trim(), odds: parseAmericanOdds(m[2]) });
      pendingName = null;
    } else if (/[A-Za-z]/.test(line) && !/^(odds|winner|outright|player|name)\b/i.test(line)) {
      pendingName = line;
    }
  }
  const seen = new Set();
  return out.filter((o) => o.odds != null && !seen.has(nameKey(o.name)) && seen.add(nameKey(o.name)));
}

// ───────────────────────── Scores ─────────────────────────

export function parseToPar(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const t = String(s).trim();
  if (/^e(ven)?$/i.test(t)) return 0;
  const n = parseInt(t.replace('+', ''), 10);
  return Number.isNaN(n) ? null : n;
}

export function fmtToPar(n) {
  if (n == null) return '–';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

// ───────────────────────── ESPN normalizer ─────────────────────────
// ESPN's public golf scoreboard JSON is undocumented and shifts a little between events,
// so every field is read defensively with fallbacks.

const dv = (x) => (x && typeof x === 'object' ? (x.displayValue ?? x.value) : x);

function statusFlag(c) {
  const txt = JSON.stringify(c.status || {}).replace(/MADE[_ ]?CUT/gi, '');
  if (/(^|[^A-Z])(CUT|MC|MDF)([^A-Z]|$)/i.test(txt)) return 'cut';
  if (/(^|[^A-Z])(WD|WITHDRAWN|DNS)([^A-Z]|$)/i.test(txt)) return 'wd';
  if (/(^|[^A-Z])(DQ|DISQUALIFIED)([^A-Z]|$)/i.test(txt)) return 'dq';
  return 'active';
}

function readRounds(c) {
  const rounds = [null, null, null, null].map(() => ({ strokes: null, toPar: null, holes: 0, started: false, teeTime: null }));
  for (const ls of c.linescores || []) {
    const p = Number(ls.period);
    if (!(p >= 1 && p <= 4)) continue;
    const holes = (ls.linescores || []).filter((h) => h && Number(h.period) >= 1 && Number(h.period) <= 18 && h.value != null).length;
    const shown = ls.displayValue;
    const val = ls.value;
    const hasStrokes = val != null && shown !== '-' && Number(val) > 0;
    rounds[p - 1] = {
      strokes: hasStrokes ? Number(val) : null,
      toPar: hasStrokes || holes > 0 ? parseToPar(shown) : null,
      holes: holes || (hasStrokes && Number(val) > 50 ? 18 : 0),
      started: holes > 0 || hasStrokes,
      teeTime: ls.teeTime || null,
    };
  }
  return rounds;
}

export function normalizeEspnEvent(ev) {
  const comp = (ev.competitions || [])[0] || {};
  const st = comp.status || ev.status || {};
  const type = st.type || {};
  const state = type.state || (type.completed ? 'post' : 'pre');
  const period = Number(st.period) || 0;

  let players = (comp.competitors || []).map((c, i) => {
    const a = c.athlete || {};
    const name = a.displayName || a.fullName || [a.firstName, a.lastName].filter(Boolean).join(' ') || `Player ${i + 1}`;
    const rounds = readRounds(c);
    const cs = c.status || {};
    return {
      id: String(a.id || c.id || ''),
      name,
      key: nameKey(name),
      order: Number(c.sortOrder ?? c.order ?? i + 1),
      toPar: parseToPar(dv(c.score)),
      rounds,
      status: statusFlag(c),
      espnPos: cs.position && (cs.position.displayName || cs.position.abbreviation) || null,
      espnThru: cs.thru != null ? Number(cs.thru) : null,
      espnPeriod: cs.period != null ? Number(cs.period) : null,
      teeTime: cs.teeTime || null,
      flag: (a.flag && (a.flag.href || null)) || null,
    };
  });
  players.sort((a, b) => a.order - b.order);

  // Fallback cut detection when ESPN gives no status: in round 3+, players ranked below
  // everyone who has round-3+ data (ESPN sorts missed cuts to the bottom) missed the cut.
  if (period >= 3) {
    let lastWithData = -1;
    players.forEach((p, i) => { if (p.rounds[2].started || p.rounds[3].started) lastWithData = i; });
    if (lastWithData >= 0) {
      players.forEach((p, i) => {
        if (p.status === 'active' && i > lastWithData && !p.rounds[2].started && !p.teeTime) p.status = 'cut';
      });
    }
  }

  // Today / Thru
  for (const p of players) {
    const r = p.espnPeriod || period || 1;
    const cur = p.rounds[Math.min(Math.max(r, 1), 4) - 1];
    p.currentRound = r;
    if (p.status !== 'active') {
      p.today = null; p.todayStr = '–'; p.thru = p.status.toUpperCase();
    } else if (cur && cur.started) {
      const holes = p.espnThru != null && p.espnThru > 0 ? p.espnThru : cur.holes;
      const done = holes >= 18 || (cur.strokes != null && cur.holes === 0 && cur.strokes > 50);
      p.today = cur.toPar;
      p.todayStr = done && cur.strokes ? String(cur.strokes) : fmtToPar(cur.toPar);
      p.thru = done ? 'F' : String(holes);
    } else {
      p.today = null;
      p.todayStr = '–';
      const tt = p.teeTime || (cur && cur.teeTime);
      p.thru = tt ? fmtTeeTime(tt) : (state === 'post' ? 'F' : '–');
    }
  }

  // Positions: ESPN's own when present, else computed with ties.
  const active = players.filter((p) => p.status === 'active' && p.toPar != null);
  for (const p of players) {
    if (p.status !== 'active') { p.pos = p.status.toUpperCase(); p.posNum = 999; continue; }
    if (p.toPar == null) { p.pos = '–'; p.posNum = 998; continue; }
    const better = active.filter((q) => q.toPar < p.toPar).length;
    const tie = active.filter((q) => q.toPar === p.toPar).length > 1;
    p.posNum = better + 1;
    p.pos = p.espnPos && p.espnPos !== '-' ? p.espnPos : `${tie ? 'T' : ''}${better + 1}`;
  }

  return {
    id: String(ev.id || ''),
    name: ev.name || ev.shortName || '',
    state,
    period,
    detail: type.shortDetail || type.detail || '',
    start: ev.date || comp.date || null,
    players,
  };
}

function fmtTeeTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' ', '');
}

// Pick which ESPN event on a scoreboard is ours (weeks can have an opposite-field event too).
export function matchEspnEvent(events, tournamentName) {
  const words = (s) => new Set(nameKey(s).replace(/\b(the|presented|by|pres|championship|classic|open|tournament|invitational|of|in|at)\b/g, ' ').split(' ').filter((w) => w.length > 1));
  const target = words(tournamentName);
  let best = null, bestScore = -1;
  for (const ev of events || []) {
    const w = words(ev.name || ev.shortName || '');
    let overlap = 0;
    for (const x of target) if (w.has(x)) overlap++;
    const n = ((ev.competitions || [])[0]?.competitors || []).length;
    const score = overlap * 1000 + n; // name match first, then the bigger field
    if (score > bestScore) { bestScore = score; best = ev; }
  }
  return best;
}

// ───────────────────────── Results (winner / FRL / DFL) ─────────────────────────

export function computeResults(lb, fmt) {
  const res = { final: false, winner: null, frlFinal: false, frlLeaders: [], dfl: [], r1Leaders: [] };
  if (!lb || !lb.players || !lb.players.length) return res;
  const players = lb.players;
  const pick = (p) => ({ name: p.name, key: p.key, id: p.id });

  // First round: leaders among those who finished R1.
  const r1 = players.filter((p) => p.rounds[0].strokes != null && p.rounds[0].holes >= 18);
  const r1Live = players.filter((p) => p.rounds[0].toPar != null);
  const r1Done = lb.state === 'post' || lb.period >= 2;
  const pool = r1Done ? r1 : r1Live;
  if (pool.length) {
    const scoreOf = (p) => (r1Done ? p.rounds[0].strokes : p.rounds[0].toPar);
    const best = Math.min(...pool.map(scoreOf));
    res.r1Leaders = pool.filter((p) => scoreOf(p) === best).map(pick);
    if (r1Done) { res.frlFinal = true; res.frlLeaders = res.r1Leaders; }
  }

  if (lb.state === 'post') {
    res.final = true;
    const finishers = players.filter((p) => p.status === 'active' && p.toPar != null);
    const winner = finishers.find((p) => p.pos === '1') || [...finishers].sort((a, b) => a.order - b.order)[0];
    res.winner = winner ? pick(winner) : null;
    if (fmt && fmt.dfl && finishers.length) {
      const worst = Math.max(...finishers.map((p) => p.toPar));
      res.dfl = finishers.filter((p) => p.toPar === worst).map(pick);
    }
  }
  return res;
}

// Commissioner overrides beat ESPN-derived results.
export function effectiveResults(rec) {
  const auto = (rec && rec.result) || {};
  const o = (rec && rec.override) || {};
  const asList = (v) => (v === 'none' ? [] : (v || []).map((n) => ({ name: n, key: nameKey(n) })));
  return {
    final: o.winner != null ? true : !!auto.final,
    winner: o.winner === 'none' ? null : o.winner ? { name: o.winner, key: nameKey(o.winner) } : auto.winner || null,
    frlFinal: o.frl != null ? true : !!auto.frlFinal,
    frlLeaders: o.frl != null ? asList(o.frl) : auto.frlLeaders || [],
    dfl: o.dfl != null ? asList(o.dfl) : auto.dfl || [],
    overridden: { winner: o.winner != null, frl: o.frl != null, dfl: o.dfl != null },
  };
}

// ───────────────────────── Teams & MMGW ─────────────────────────

export function findPlayer(lbPlayers, golfer) {
  if (!lbPlayers || !golfer) return null;
  return (golfer.id && lbPlayers.find((p) => p.id === golfer.id)) || lbPlayers.find((p) => p.key === nameKey(golfer.name)) || null;
}

// Map golfer key -> Degen for regular (non-DFL) picks, and separately for DFL picks.
export function ownership(picks) {
  const reg = new Map(), dfl = new Map();
  for (const p of picks || []) (p.dfl ? dfl : reg).set(nameKey(p.golfer.name), p.degen);
  return { reg, dfl };
}

export function cutDecided(lb) {
  return !!lb && (lb.state === 'post' || lb.period >= 3 || lb.players.some((p) => p.status === 'cut'));
}

export function mmgwFor(degenPicks, lb, fmt) {
  const regular = degenPicks.filter((p) => !p.dfl);
  const rows = regular.map((p) => findPlayer(lb && lb.players, p.golfer));
  const alive = rows.filter((p) => p && p.status === 'active' && p.toPar != null);
  const need = fmt.mmgwCount;
  const decided = cutDecided(lb);
  const deadCount = rows.filter((p) => p && p.status !== 'active').length;
  if ((decided || deadCount > regular.length - need) && regular.length >= need && alive.length < need && rows.some(Boolean)) {
    return { cut: true, score: null, counted: [] };
  }
  if (!alive.length) return { cut: false, score: null, counted: [] };
  const counted = [...alive].sort((a, b) => a.toPar - b.toPar).slice(0, need);
  return { cut: false, score: counted.reduce((s, p) => s + p.toPar, 0), counted: counted.map((p) => p.key) };
}

// ───────────────────────── Money ─────────────────────────

// Walks the season in order so the FRL rollover carries correctly.
export function computeSeason(tournaments, records, config) {
  const degens = config.degens;
  const N = degens.length;
  const table = Object.fromEntries(degens.map((d) => [d, { degen: d, wins: 0, frls: 0, dfls: 0, winnings: 0, net: 0 }]));
  const weeks = [];
  let frlStake = Number(config.frlBase);

  const settle = (pot, stake, winners) => {
    // winners: array of Degens, one entry per winning golfer (a Degen can appear twice).
    const pool = stake * N;
    const recv = Object.fromEntries(degens.map((d) => [d, 0]));
    winners.forEach((d) => { if (recv[d] != null) recv[d] += pool / winners.length; });
    for (const d of degens) {
      const delta = recv[d] - stake;
      table[d].net += delta;
      if (delta > 0) table[d].winnings += delta;
    }
  };

  for (const t of tournaments) {
    const rec = records[t.week] || {};
    const fmt = weekFormat(t, rec);
    const picks = rec.picks || [];
    const stake = stakeFor(t, rec, config);
    const weekFrl = rec.frlStake != null && rec.frlStake !== '' ? Number(rec.frlStake) : frlStake;
    const res = effectiveResults(rec);
    const own = ownership(picks);
    const drafted = picks.length > 0;
    const w = {
      week: t.week, stake, payout: stake * (N - 1), frlStake: weekFrl, frlPayout: weekFrl * (N - 1),
      golfWinner: res.winner ? res.winner.name : null, winnerDegen: null,
      golfFrl: res.frlLeaders.map((p) => p.name), frlDegens: [],
      dfl: res.dfl.map((p) => p.name), dflDegens: [],
      final: res.final, frlFinal: res.frlFinal, drafted, frlRolled: false,
    };

    if (drafted && res.final && res.winner) {
      const d = own.reg.get(res.winner.key);
      if (d) { settle('main', stake, [d]); table[d].wins++; w.winnerDegen = d; } else w.winnerDegen = 'Undrafted';
    } else if (drafted && res.final) {
      w.winnerDegen = 'Undrafted';
    }

    if (drafted && res.frlFinal) {
      const owners = res.frlLeaders.map((p) => own.reg.get(p.key));
      if (owners.length && owners.every(Boolean)) {
        settle('frl', weekFrl, owners);
        [...new Set(owners)].forEach((d) => table[d].frls++);
        w.frlDegens = [...new Set(owners)];
        frlStake = Number(config.frlBase);
      } else {
        w.frlDegens = ['Undrafted'];
        w.frlRolled = true;
        frlStake = weekFrl + Number(config.frlStep);
      }
    } else if (rec.frlStake != null && rec.frlStake !== '') {
      frlStake = weekFrl; // manual stake set for a week not yet decided carries forward
    }

    if (drafted && fmt.dfl && res.final && res.dfl.length) {
      const owners = res.dfl.map((p) => own.dfl.get(p.key));
      if (owners.every(Boolean)) {
        settle('dfl', Number(config.dflStake), owners);
        [...new Set(owners)].forEach((d) => table[d].dfls++);
        w.dflDegens = [...new Set(owners)];
      } else w.dflDegens = ['Undrafted'];
    }
    weeks.push(w);
  }

  const standings = Object.values(table).sort((a, b) => b.winnings - a.winnings || b.wins - a.wins || a.degen.localeCompare(b.degen));
  return { standings, weeks, nextFrlStake: frlStake };
}

// Live FRL stake for a given week (what's riding on it right now).
export function frlStakeForWeek(season, week) {
  const w = season.weeks.find((x) => x.week === week);
  return w ? w.frlStake : null;
}

// ───────────────────────── Draft-order upload ─────────────────────────
// Accepts any of:
//   { "1": ["MK","CC",...], "2": [...] }                       (keys = week numbers)
//   { "The American Express": ["MK",...] }                      (keys = tournament names)
//   [ { "week": 1, "order": [...] }, { "tournament": "WM Phoenix Open", "order": [...] } ]
export function parseDraftOrders(json, tournaments, degens) {
  const out = {};
  const errors = [];
  const resolve = (k) => {
    if (/^\d+$/.test(String(k))) return Number(k);
    const key = nameKey(cleanTournamentName(k));
    const has = (a, b) => ` ${a} `.includes(` ${b} `);
    const t = tournaments.find((x) => nameKey(x.name) === key) || tournaments.find((x) => has(nameKey(x.name), key) || has(key, nameKey(x.name)));
    return t ? t.week : null;
  };
  const entries = Array.isArray(json)
    ? json.map((e) => [e.week ?? e.tournament ?? e.name, e.order ?? e.draftOrder])
    : Object.entries(json.orders || json);
  for (const [k, order] of entries) {
    const week = resolve(k);
    if (!week) { errors.push(`Unknown tournament "${k}"`); continue; }
    const ord = (order || []).map((d) => String(d).trim().toUpperCase());
    const set = new Set(ord);
    if (ord.length !== degens.length || set.size !== degens.length || !ord.every((d) => degens.includes(d))) {
      errors.push(`Week ${week}: order must list each of ${degens.join(', ')} exactly once`);
      continue;
    }
    out[week] = ord;
  }
  return { orders: out, errors };
}
