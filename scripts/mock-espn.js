// Builds a fake ESPN golf scoreboard in ESPN's JSON shape, for local testing.
// stage: 'pre' | 'r1' (round 1 live) | 'r2' (round 2 done) | 'r3' (round 3 live) | 'final'

export const MOCK_FIELD = [
  'Scottie Scheffler', 'Rory McIlroy', 'Xander Schauffele', 'Ludvig Åberg', 'Collin Morikawa', 'Tommy Fleetwood',
  'Justin Thomas', 'Patrick Cantlay', 'Viktor Hovland', 'Hideki Matsuyama', 'Wyndham Clark', 'Sam Burns',
  'Tom Kim', 'Sungjae Im', 'Russell Henley', 'Jake Knapp', 'Maverick McNealy', 'Chris Gotterup',
  'Matt Fitzpatrick', 'Justin Rose', 'J.T. Poston', 'Ryan Gerard', 'Kurt Kitayama', 'Kristoffer Reitan',
  'J.J. Spaun', 'Robert MacIntyre', 'Rickie Fowler', 'Adam Scott', 'Akshay Bhatia', 'Alex Fitzpatrick',
  'Alex Noren', 'Ben Griffin', 'Si Woo Kim', 'Min Woo Lee', 'Michael Thorbjornsen', 'Cameron Young',
  'Gary Woodland', 'Jacob Bridgeman', 'Michael Brennan', 'Ryo Hisatsune', 'Alex Smalley', 'Aaron Rai',
  'Eric Cole', 'Keegan Bradley', 'Shane Lowry', 'Brian Harman', 'Sepp Straka', 'Corey Conners',
  'Harris English', 'Denny McCarthy', 'Nick Taylor', 'Taylor Pendrith', 'Lucas Glover', 'Billy Horschel',
  'Max Homa', 'Tony Finau', 'Jason Day', 'Byeong Hun An', 'Stephan Jaeger', 'Davis Thompson',
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const PAR = 72;
const fmt = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

export function mockScoreboard({ stage = 'r3', seed = 7, name = 'The American Express', withStatus = true, frlTie = false, wd = false } = {}) {
  const r = rng(seed);
  const period = { pre: 1, r1: 1, r2: 2, r3: 3, final: 4 }[stage];
  const state = stage === 'pre' ? 'pre' : stage === 'final' ? 'post' : 'in';
  const roundsDone = { pre: 0, r1: 0, r2: 2, r3: 2, final: 4 }[stage];

  const players = MOCK_FIELD.map((nm, i) => {
    const skill = (i / MOCK_FIELD.length) * 3; // better players listed first
    const rounds = [];
    for (let k = 0; k < 4; k++) {
      const holes = [];
      for (let h = 1; h <= 18; h++) {
        const par = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4][h - 1];
        const x = r() + skill * 0.025;
        holes.push({ period: h, value: par + (x < 0.18 ? -1 : x < 0.2 ? -2 : x > 0.88 ? 1 : x > 0.985 ? 2 : 0) });
      }
      rounds.push(holes);
    }
    if (frlTie && i === 3) rounds[0] = rounds[1].map((h) => h); // filler; real tie forced below
    return { nm, i, rounds };
  });

  // Force a clear FRL leader (or a tie) for predictable tests.
  const lowRound = Array.from({ length: 18 }, (_, k) => ({ period: k + 1, value: [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4][k] - (k % 2 === 0 ? 1 : 0) }));
  players[4].rounds[0] = lowRound.map((h) => ({ ...h, value: h.value - (h.period === 18 ? 1 : 0) })); // Morikawa -7
  if (frlTie) players[36].rounds[0] = players[4].rounds[0].map((h) => ({ ...h })); // Gary Woodland ties

  const comps = players.map((p) => {
    const linescores = [];
    let total = 0;
    let playedAny = false;
    for (let k = 0; k < 4; k++) {
      let holesPlayed;
      if (k < roundsDone) holesPlayed = 18;
      else if (k === period - 1 && state === 'in') holesPlayed = stage === 'r1' ? (p.i % 19) : (p.i % 3 === 0 ? 0 : 6 + (p.i % 13));
      else holesPlayed = 0;
      // stage r2: round 2 complete; r3: round 3 partially played
      if (stage === 'r3' && k === 2) holesPlayed = p.i < 6 ? 0 : 4 + (p.i % 15);
      if (holesPlayed === 0) {
        if (k === period - 1 && state !== 'post') linescores.push({ period: k + 1, value: 0, displayValue: '-', teeTime: '2027-01-21T18:40:00Z', linescores: [] });
        continue;
      }
      const hs = p.rounds[k].slice(0, holesPlayed);
      const strokes = hs.reduce((s, h) => s + h.value, 0);
      const par = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4].slice(0, holesPlayed).reduce((a, b) => a + b, 0);
      total += strokes - par;
      playedAny = true;
      linescores.push({ period: k + 1, value: strokes, displayValue: fmt(strokes - par), linescores: hs });
    }
    return { p, linescores, total, playedAny };
  });

  // cut after round 2: top 65% make it
  let cutSet = new Set();
  if (period >= 3) {
    const by36 = [...comps].sort((a, b) => totalThrough(a, 2) - totalThrough(b, 2));
    by36.slice(Math.ceil(by36.length * 0.65)).forEach((c) => cutSet.add(c.p.i));
    for (const c of comps) if (cutSet.has(c.p.i)) {
      c.linescores = c.linescores.filter((l) => l.period <= 2);
      c.total = c.linescores.reduce((s, l) => s + (l.displayValue === 'E' ? 0 : parseInt(l.displayValue, 10)), 0);
    }
  }

  const sorted = [...comps].sort((a, b) => (cutSet.has(a.p.i) - cutSet.has(b.p.i)) || (stage === 'pre' ? a.p.i - b.p.i : a.total - b.total));
  const competitors = sorted.map((c, idx) => {
    const out = {
      id: String(9000 + c.p.i),
      sortOrder: idx + 1,
      athlete: { id: String(9000 + c.p.i), displayName: c.p.nm },
      score: stage === 'pre' ? 'E' : fmt(c.total),
      linescores: c.linescores,
    };
    if (withStatus) {
      out.status = cutSet.has(c.p.i)
        ? { type: { name: 'STATUS_CUT' }, position: { displayName: 'CUT' } }
        : { type: { name: stage === 'final' ? 'STATUS_FINISH' : 'STATUS_IN_PROGRESS' } };
    }
    return out;
  });

  // Two withdrawals that look the way ESPN showed them at the RSM: score "E", no rounds, no status.
  if (wd && period >= 2) {
    for (const nm of ['Tom Kim', 'Davis Thompson']) {
      const c = competitors.find((x) => x.athlete.displayName === nm);
      if (c) { c.score = 'E'; c.linescores = []; delete c.status; }
    }
  }

  return {
    events: [
      {
        id: '401999001',
        name,
        date: '2027-01-21T13:00:00Z',
        competitions: [{ status: { period, type: { state, completed: state === 'post', shortDetail: state === 'post' ? 'Final' : state === 'pre' ? 'Thu, Jan 21' : `Round ${period} - In Progress` } }, competitors }],
      },
      { id: '401999002', name: 'Opposite Field Classic', competitions: [{ status: { period: 1, type: { state: 'pre' } }, competitors: competitors.slice(0, 5) }] },
    ],
  };
}

function totalThrough(c, n) {
  return c.linescores.filter((l) => l.period <= n).reduce((s, l) => s + (l.displayValue === 'E' ? 0 : parseInt(l.displayValue, 10) || 0), 0);
}
