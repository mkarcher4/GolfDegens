import * as L from '../js/league.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

const ymd = (iso) => iso.replace(/-/g, '');
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 GolfDegens', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

// Returns the raw ESPN event for a tournament (or null if ESPN doesn't list it yet).
export async function fetchEspnEvent(t, rec) {
  if (process.env.MOCK_ESPN) {
    const { mockScoreboard } = await import('../scripts/mock-espn.js');
    const stage = process.env.MOCK_ESPN;
    if (t.week !== Number(process.env.MOCK_WEEK || 1)) return null;
    return L.matchEspnEvent(mockScoreboard({ stage, name: t.name, frlTie: !!process.env.MOCK_FRL_TIE, wd: !!process.env.MOCK_WD }).events, t.name);
  }
  const wantId = rec && rec.espnEventId ? String(rec.espnEventId) : null;
  const pickFrom = (data) => {
    const events = (data && data.events) || [];
    if (wantId) return events.find((e) => String(e.id) === wantId) || null;
    return L.matchEspnEvent(events, t.name);
  };
  // Thursday and Saturday of the tournament week, then the default "this week" board.
  const urls = [`${BASE}?dates=${ymd(addDays(t.start, 3))}`, `${BASE}?dates=${ymd(addDays(t.start, 5))}`, BASE];
  let fallback = null;
  for (const u of urls) {
    try {
      const ev = pickFrom(await getJSON(u));
      if (!ev) continue;
      if (wantId || nameMatches(ev.name, t.name)) return ev;
      fallback = fallback || ev;
    } catch (e) {
      console.warn('ESPN fetch failed', u, e.message);
    }
  }
  return fallback && nameMatches(fallback.name, t.name) ? fallback : null;
}

function nameMatches(espnName, ourName) {
  const COMMON = ['the', 'championship', 'open', 'classic', 'tournament', 'invitational', 'presented', 'by'];
  const words = (s, drop) => new Set(L.nameKey(s).split(' ').filter((w) => w.length > 1 && !drop.includes(w)));
  const a = words(espnName, COMMON), b = words(ourName, COMMON);
  if (b.size) { for (const w of b) if (a.has(w)) return true; return false; }
  // Names made only of common words ("U.S. Open", "The Open Championship"): compare what's left.
  const a2 = words(espnName, ['the', 'championship']), b2 = words(ourName, ['the', 'championship']);
  return a2.size === b2.size && [...b2].every((w) => a2.has(w));
}
