import * as L from './league.js';

// ───────────────────────── State ─────────────────────────
const S = {
  config: L.DEFAULT_CONFIG,
  tournaments: [],
  weeks: {},
  ver: -1,
  storage: 'redis',
  lb: {},
  lbLoading: {},
  route: { tab: 'week', week: null },
  me: localStorage.getItem('gd.me') || null,
  pin: localStorage.getItem('gd.pin') || '',
  adminPin: localStorage.getItem('gd.adminPin') || '',
  lbFilter: 'all',
  draftSearch: '',
  showTaken: false,
  armed: null, // golfer key awaiting confirm tap
  adminWeek: null,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 2600);
}

// ───────────────────────── Data loading ─────────────────────────
async function loadAll() {
  const d = await api('/api/state?all=1');
  S.config = d.config;
  S.tournaments = L.parseSchedule(d.schedule.rows, d.schedule.year);
  S.weeks = d.weeks || {};
  S.ver = d.ver;
  S.storage = d.storage;
  S._season = null;
}

async function loadLb(week, force) {
  if (S.lbLoading[week]) return;
  S.lbLoading[week] = true;
  try {
    const d = await api(`/api/leaderboard?week=${week}${force ? '&force=1' : ''}`);
    S.lb[week] = d;
    // The server saves results as it learns them; use them right away rather than waiting for the next poll.
    const res = d.results;
    if (res && (res.frlFinal || res.final)) {
      S.weeks[week] = { ...rec(week), result: { final: res.final, frlFinal: res.frlFinal, winner: res.winner, frlLeaders: res.frlLeaders, dfl: res.dfl } };
      S._season = null;
    }
  } catch (e) {
    if (!S.lb[week]) S.lb[week] = { error: e.message, players: [] };
  } finally {
    S.lbLoading[week] = false;
  }
}

const rec = (w) => S.weeks[w] || { picks: [] };
// Leaderboard for a week with the commissioner's manual WDs applied.
function lbFor(w) {
  const lb = S.lb[w];
  const wd = (rec(w).override || {}).wd;
  if (!lb || !Array.isArray(wd) || !wd.length || !lb.players) return lb;
  return { ...lb, players: L.applyManualWd(lb.players, wd) };
}
const tourn = (w) => S.tournaments.find((t) => t.week === w);
function season() {
  if (!S._season) S._season = L.computeSeason(S.tournaments, S.weeks, S.config);
  return S._season;
}

function draftState(w) {
  const t = tourn(w), r = rec(w), fmt = L.weekFormat(t, r);
  const total = (fmt.rounds + (fmt.dfl ? 1 : 0)) * S.config.degens.length;
  const picks = r.picks || [];
  const clock = r.order ? L.onTheClock(r.order, fmt, picks) : null;
  return { t, r, fmt, picks, total, clock, hasOrder: !!(r.order && r.order.length), complete: picks.length >= total };
}

// ───────────────────────── Polling ─────────────────────────
// Fast (3s) while a draft is live on screen, slow otherwise; paused when the app is hidden.
let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  const w = S.route.week;
  const ds = S.route.tab === 'week' && w ? draftState(w) : null;
  const drafting = ds && ds.hasOrder && !ds.complete;
  pollTimer = setTimeout(poll, drafting ? 3000 : 45000);
}
async function poll() {
  try {
    const { ver } = await api('/api/state?only=ver');
    if (ver !== S.ver) { await loadAll(); render(); }
    const w = S.route.week;
    if (S.route.tab === 'week' && w) {
      const lb = S.lb[w];
      const live = lb && lb.event && lb.event.state === 'in';
      const age = lb ? Date.now() - (lb._fetchedAt || 0) : Infinity;
      if (!lb || (live && age > 55_000) || (!lb.final && age > 5 * 60_000)) {
        await loadLb(w);
        if (S.lb[w]) S.lb[w]._fetchedAt = Date.now();
        render();
      }
    }
  } catch {}
  schedulePoll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

// ───────────────────────── Routing ─────────────────────────
const TABS = [
  { id: 'week', label: 'This Week', icon: '<path d="M6 21V3l11 4-11 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><ellipse cx="12" cy="21" rx="7" ry="1.6" fill="currentColor" opacity=".35"/>' },
  { id: 'money', label: 'Money', icon: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 9.2c-.6-1-1.7-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3 6 1.6 6 4.4 0 1.3-1.3 2.2-3.1 2.2-1.4 0-2.6-.6-3.1-1.6M12 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  { id: 'schedule', label: 'Schedule', icon: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { id: 'admin', label: 'Commish', icon: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
];

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const tab = TABS.some((t) => t.id === h[0]) ? h[0] : 'week';
  let week = Number(h[1]) || null;
  if (tab === 'week' && !week && S.tournaments.length) week = L.currentWeek(S.tournaments, todayISO());
  S.route = { tab, week };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
window.addEventListener('hashchange', () => { parseRoute(); S.armed = null; S.skipDirty = true; render(); window.scrollTo(0, 0); });

function renderTabs() {
  const html = TABS.map((t) => `<button type="button" data-tab="${t.id}" ${S.route.tab === t.id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span></button>`).join('');
  $('.tabs-bottom').innerHTML = html;
  $('.tabs-top').innerHTML = TABS.map((t) => `<button type="button" data-tab="${t.id}" ${S.route.tab === t.id ? 'aria-current="page"' : ''}>${t.label}</button>`).join('');
  $('#meChip').textContent = S.me || 'Who?';
}
document.addEventListener('click', (e) => {
  const tb = e.target.closest('[data-tab]');
  if (tb) go(tb.dataset.tab === 'week' ? '#/week' : `#/${tb.dataset.tab}`);
});
$('#meChip').addEventListener('click', () => whoAmI());

// ───────────────────────── Score colors ─────────────────────────
// Green scale under par, yellow at even, red scale over par.
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
function scoreStyle(n) {
  if (n == null) return '';
  if (n === 0) return 'background:#FFF0B8;color:#5C4500';
  if (n < 0) { const t = Math.min(1, -n / 18); return `background:${mix('#EAF6EE', '#5DB37E', t)};color:${t > .65 ? '#fff' : '#0B4A27'}`; }
  const t = Math.min(1, n / 10);
  return `background:${mix('#FDECEC', '#E57373', t)};color:${t > .7 ? '#fff' : '#8A1C1C'}`;
}
const scoreCell = (n, extra = '') => `<span class="score num" style="${scoreStyle(n)}">${n == null ? '–' : L.fmtToPar(n)}${extra}</span>`;
const degenTag = (d) => `<span class="degen-tag${d === S.me ? ' me' : ''}">${esc(d)}</span>`;

// ───────────────────────── WEEK VIEW ─────────────────────────
function renderWeek() {
  const w = S.route.week;
  const ds = draftState(w);
  const { t, r, fmt, picks } = ds;
  if (!S.lb[w] && !S.lbLoading[w]) loadLb(w).then(() => { if (S.lb[w]) S.lb[w]._fetchedAt = Date.now(); render(); });
  const lb = lbFor(w);
  const players = (lb && lb.players) || [];
  const ev = lb && lb.event;
  const sw = season().weeks.find((x) => x.week === w) || {};
  const res = L.effectiveResults(r);
  const own = L.ownership(picks);
  const live = ev && ev.state === 'in';

  const prev = S.tournaments.find((x) => x.week === w - 1);
  const next = S.tournaments.find((x) => x.week === w + 1);
  const isCurrent = L.currentWeek(S.tournaments, todayISO()) === w;

  let html = '';
  if (S.storage === 'memory') html += `<div class="warn"><b>Database not connected.</b> Data is only kept in this server's memory. Add Upstash Redis in Vercel (see README) before the league uses the app.</div>`;

  html += `
  <section class="week-head">
    <div class="week-nav">
      <button class="arrow" type="button" data-week="${prev ? prev.week : ''}" ${prev ? '' : 'disabled'} aria-label="Previous tournament">‹</button>
      <div class="week-title-wrap">
        <div class="week-title">
          <div class="wk">Week ${t.week}${isCurrent ? ' · This week' : ''}</div>
          <h1>${esc(t.name)}</h1>
          <div class="sub">${esc(t.dateLabel)} · ${esc(t.course)}</div>
        </div>
        <select id="weekSelect" aria-label="Choose tournament">${S.tournaments.map((x) => `<option value="${x.week}" ${x.week === w ? 'selected' : ''}>Wk ${x.week} · ${esc(x.name)}</option>`).join('')}</select>
      </div>
      <button class="arrow" type="button" data-week="${next ? next.week : ''}" ${next ? '' : 'disabled'} aria-label="Next tournament">›</button>
    </div>
    <div class="chips">
      <span class="chip ${t.tier === 1 ? 'gold' : ''}">Tier ${t.tier}</span>
      ${t.tag ? `<span class="chip">${esc(t.tag)}</span>` : ''}
      <span class="chip">${esc(fmt.label)}</span>
      <span class="chip">${esc(t.location)}</span>
      ${ev ? `<span class="chip ${live ? 'live' : ''}">${esc(ev.state === 'post' ? 'Final' : ev.detail || (ev.state === 'pre' ? 'Upcoming' : 'Live'))}</span>` : ''}
    </div>
  </section>`;

  html += renderPots(ds, sw, res, players, own, ev);

  if (!ds.complete) html += renderDraft(ds, players);

  html += renderTeams(ds, players, own);

  html += `<div class="grid-2" style="margin-bottom:14px">${renderMMGW(ds, lb)}${renderFrlCard(ds, sw, res, players, own)}</div>`;

  html += renderLeaderboard(ds, lb, own);

  return html;
}

function projectedLeader(players) {
  const alive = players.filter((p) => p.status === 'active' && p.toPar != null);
  if (!alive.length) return [];
  const best = Math.min(...alive.map((p) => p.toPar));
  return alive.filter((p) => p.toPar === best);
}
const ownerLabel = (map, key) => map.get(key) || 'Undrafted';

function renderPots(ds, sw, res, players, own, ev) {
  const { t, r, fmt } = ds;
  const N = S.config.degens.length;
  const stake = L.stakeFor(t, r, S.config);
  const frl = sw.frlStake ?? S.config.frlBase;
  const fmtNames = (arr) => arr.map((p) => `<b>${esc(p.name)}</b> (${esc(ownerLabel(own.reg, p.key))})`).join(', ');

  // Main pot
  let mainWho = 'Draft hasn\'t started';
  let mainCls = '';
  if (res.final && res.winner) {
    const d = own.reg.get(res.winner.key);
    mainWho = d ? `${degenTag(d)} wins with <b>${esc(res.winner.name)}</b>` : `<b>${esc(res.winner.name)}</b> won — Undrafted, no payout`;
    mainCls = d ? 'won' : '';
  } else if (ev && ev.state === 'in') {
    const lead = projectedLeader(players);
    mainWho = lead.length ? `${lead.length > 1 ? `Tied for the lead (T1, ${L.fmtToPar(lead[0].toPar)})` : `Leader (${L.fmtToPar(lead[0].toPar)})`}: ${fmtNames(lead)}` : 'Live';
  } else if (ds.picks.length) mainWho = ds.complete ? 'Drafted — waiting on Thursday' : 'Draft in progress';
  else if (ds.hasOrder) mainWho = 'Draft order is set';

  // FRL pot
  let frlWho, frlCls = '';
  if (sw.noFrl) {
    frlWho = `<b>No FRL this week</b> (${t.multiCourse && r.frl !== 'off' ? 'multi-course event' : 'turned off'}). $${frl}/Degen carries to next week.`;
  } else if (res.frlFinal) {
    const owners = res.frlLeaders.map((p) => own.reg.get(p.key));
    if (owners.length && owners.every(Boolean)) {
      frlWho = `${[...new Set(owners)].map(degenTag).join(' ')} ${owners.length > 1 ? 'split' : 'wins'} · ${res.frlLeaders.map((p) => esc(p.name)).join(', ')}`;
      frlCls = 'won';
    } else {
      frlWho = `${res.frlLeaders.length ? `${fmtNames(res.frlLeaders)} — ` : ''}no winner, rolls to $${frl + S.config.frlStep}`;
      frlCls = 'rolled';
    }
  } else {
    const lb = S.lb[t.week];
    const lead = lb && lb.results ? lb.results.r1Leaders || [] : [];
    frlWho = lead.length && ev && ev.state === 'in' ? `${lead.length > 1 ? 'Tied for R1 lead' : 'R1 leader'}: ${fmtNames(lead)}` : (frl > S.config.frlBase ? `Rolled over ${frl - S.config.frlBase}×` : 'Solo first-round leader');
  }

  let html = `<div class="pots">
    <div class="pot ${mainCls}"><div class="lbl">Winner pot</div><div class="amt num">$${stake * (N - 1)} <small>$${stake}/Degen</small></div><div class="who">${mainWho}</div></div>
    <div class="pot ${frlCls}"><div class="lbl">FRL pot</div><div class="amt num">$${frl * (N - 1)} <small>$${frl}/Degen</small></div><div class="who">${frlWho}</div></div>`;
  if (fmt.dfl) {
    let dflWho = 'Golfer who finishes dead last';
    if (res.final && res.dfl.length) {
      const owners = res.dfl.map((p) => own.dfl.get(p.key));
      dflWho = owners.every(Boolean) ? `${[...new Set(owners)].map(degenTag).join(' ')} · ${res.dfl.map((p) => esc(p.name)).join(', ')}` : `${res.dfl.map((p) => esc(p.name)).join(', ')} — Undrafted, no payout`;
    }
    html += `<div class="pot"><div class="lbl">DFL pot</div><div class="amt num">$${S.config.dflStake * (N - 1)} <small>$${S.config.dflStake}/Degen</small></div><div class="who">${dflWho}</div></div>`;
  }
  return html + '</div>';
}

// ── Draft board ──
function draftPool(ds, players) {
  const odds = new Map((ds.r.odds || []).map((o) => [L.nameKey(o.name), o.odds]));
  const pool = players.filter((p) => p.status !== 'wd').map((p) => ({ name: p.name, id: p.id, key: p.key, odds: odds.get(p.key) ?? null, order: p.order }));
  const have = new Set(pool.map((p) => p.key));
  (ds.r.odds || []).forEach((o, i) => { const k = L.nameKey(o.name); if (!have.has(k)) pool.push({ name: o.name, id: null, key: k, odds: o.odds, order: 1000 + i }); });
  pool.sort((a, b) => (L.impliedProb(b.odds) - L.impliedProb(a.odds)) || a.order - b.order || a.name.localeCompare(b.name));
  return pool;
}

function renderDraft(ds, players) {
  const { r, fmt, picks, clock } = ds;
  if (!ds.hasOrder) {
    return `<section class="card"><div class="card-h"><h2>Draft</h2></div><div class="empty">The draft order for this week hasn't been set yet.<br><span class="faint">The commissioner can set it or upload the season's draft orders on the Commish tab.</span></div></section>`;
  }
  const admin = !!S.adminPin;
  const mine = clock && clock.degen === S.me;
  const canPick = clock && (mine || admin) && !r.draftLocked;
  const taken = new Map(picks.map((p) => [L.nameKey(p.golfer.name), p.degen]));
  const pool = draftPool(ds, players);
  const q = L.nameKey(S.draftSearch);
  const list = pool.filter((p) => (!q || p.key.includes(q)) && (S.showTaken || !taken.has(p.key)));
  const totalRounds = fmt.rounds + (fmt.dfl ? 1 : 0);

  // Upcoming order strip: next 12 slots of the snake
  const seq = L.snakeSequence(r.order, fmt);
  const upcoming = seq.slice(picks.length, picks.length + 12);

  let html = `<section class="card" id="draft">
    <div class="card-h"><h2>Draft</h2><span class="right faint num">Pick ${picks.length + 1} of ${ds.total}</span></div>
    <div class="draft-banner ${mine ? 'mine' : ''}">
      <div class="clock">${clock ? esc(clock.degen) : '—'}</div>
      <div class="meta">${mine ? '<b>You\'re on the clock.</b> ' : 'On the clock · '}Round ${clock.round} of ${totalRounds}${clock.dfl ? ' · <b>DFL round</b> — pick who finishes dead last' : ''}${r.draftLocked ? ' · <b>Draft locked</b>' : ''}</div>
    </div>
    <div class="order-strip">${upcoming.map((s, i) => `<span class="slot ${i === 0 ? 'now' : ''} ${s.degen === S.me ? 'me' : ''}">${i === 0 ? '▶ ' : ''}${esc(s.degen)}<span class="faint" style="font-weight:500"> ${s.pick}</span></span>`).join('')}</div>
    <div class="search">
      <input id="draftSearch" type="search" placeholder="Search ${pool.length} golfers" value="${esc(S.draftSearch)}" autocomplete="off">
      <label><input type="checkbox" id="showTaken" ${S.showTaken ? 'checked' : ''}> Taken</label>
    </div>`;
  if (!pool.length) {
    html += `<div class="empty">ESPN hasn't posted this week's field yet.<br><span class="faint">It usually appears early in tournament week. The commissioner can also paste DraftKings odds to load the field.</span></div>`;
  } else {
    html += `<div class="players">${list.slice(0, 250).map((p) => {
      const by = taken.get(p.key);
      const armed = S.armed === p.key;
      return `<div class="player-row ${by ? 'taken' : ''}">
        <span class="nm">${esc(p.name)}</span>
        <span class="od">${p.odds != null ? L.fmtOdds(p.odds) : ''}</span>
        ${by ? degenTag(by) : `<button class="btn sm ${armed ? 'green' : 'primary'}" type="button" data-pick="${esc(p.key)}" data-name="${esc(p.name)}" data-id="${esc(p.id || '')}" ${canPick ? '' : 'disabled'}>${armed ? 'Confirm' : 'Draft'}</button>`}
      </div>`;
    }).join('') || '<div class="empty">No golfers match.</div>'}</div>`;
  }
  const notes = [];
  if (r.oddsAt) notes.push(`Odds pasted ${new Date(r.oddsAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`);
  if (!S.me) notes.push('Tap <b>Who?</b> at the top to say which Degen you are.');
  else if (!mine && !admin) notes.push(`You can draft when it's your turn. You're <b>${esc(S.me)}</b>.`);
  if (admin && !mine) notes.push('Commissioner mode: you can make this pick for them.');
  if (notes.length) html += `<div class="note">${notes.join(' · ')}</div>`;
  return html + '</section>';
}

// "Updated 12:19 PM · Refresh" — lives in the header of the first scores card.
function refreshCtl(w) {
  const lb = S.lb[w];
  if (!lb || !lb.ts) return '';
  const t = new Date(lb.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `<span class="right refresh-ctl">${lb.stale ? '<span class="neg-amt">ESPN unreachable · </span>' : ''}<span class="faint">Updated ${t}</span><button type="button" id="refreshLb" ${S.lbLoading[w] ? 'disabled' : ''}>${S.lbLoading[w] ? 'Refreshing…' : 'Refresh'}</button></span>`;
}

// ── Tournament scoring (team table) ──
function renderTeams(ds, players, own) {
  const { r, fmt, picks, clock } = ds;
  const order = r.order || [];
  if (!order.length && !picks.length) return '';
  const lb = lbFor(ds.t.week);
  const degens = order.length ? order : [...new Set(picks.map((p) => p.degen))];
  const totalRounds = fmt.rounds + (fmt.dfl ? 1 : 0);
  const counted = {};
  for (const d of degens) counted[d] = new Set(L.mmgwFor(picks.filter((p) => p.degen === d), lb, fmt).counted);

  let head = '<th class="sticky-col">Degen</th>';
  for (let i = 1; i <= totalRounds; i++) head += `<th class="round">${fmt.dfl && i === totalRounds ? 'DFL pick' : `Round ${i}`}</th><th class="c">Score</th>`;
  const rows = degens.map((d) => {
    let cells = `<td class="sticky-col">${degenTag(d)}</td>`;
    for (let i = 1; i <= totalRounds; i++) {
      const pk = picks.find((p) => p.degen === d && p.round === i);
      if (!pk) {
        const isNext = clock && clock.degen === d && clock.round === i;
        cells += `<td class="${isNext ? 'pick-next' : 'pick-empty'}">${isNext ? 'On the clock' : '—'}</td><td></td>`;
        continue;
      }
      const pl = L.findPlayer(players, pk.golfer);
      const out = pl && pl.status !== 'active';
      const isCounted = pl && counted[d].has(pl.key);
      cells += `<td><span class="golfer ${out ? 'cut' : ''} ${isCounted ? 'counted' : ''}">${esc(pk.golfer.name)}</span>${out ? `<span class="tag-cut">${pl.status.toUpperCase()}</span>` : ''}</td>
        <td class="c sc">${!pl ? '<span class="faint">–</span>' : out ? `<span class="score num out-score">${pl.toPar == null ? pl.status.toUpperCase() : L.fmtToPar(pl.toPar)}</span>` : scoreCell(pl.toPar)}</td>`;
    }
    return `<tr class="${d === S.me ? 'me' : ''}">${cells}</tr>`;
  }).join('');
  return `<section class="card">
    <div class="card-h"><h2>Tournament Scoring</h2>${refreshCtl(ds.t.week)}</div>
    <div class="scroll"><table class="team-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note">Bold golfers are the ${fmt.mmgwCount} counting toward each Degen's MMGW score.</div>
  </section>`;
}

// ── MMGW index ──
function renderMMGW(ds, lb) {
  const { r, fmt, picks } = ds;
  const degens = (r.order && r.order.length ? r.order : [...new Set(picks.map((p) => p.degen))]);
  if (!degens.length) return `<section class="card"><div class="card-h"><h2>MMGW Index</h2></div><div class="empty faint">No teams yet.</div></section>`;
  const rows = degens.map((d) => ({ d, m: L.mmgwFor(picks.filter((p) => p.degen === d), lb, fmt) }));
  rows.sort((a, b) => (a.m.cut - b.m.cut) || ((a.m.score ?? 999) - (b.m.score ?? 999)));
  let rank = 0, last = null;
  const body = rows.map((x, i) => {
    if (!x.m.cut && x.m.score !== last) { rank = i + 1; last = x.m.score; }
    return `<tr class="${x.d === S.me ? 'me' : ''}"><td class="rank num">${x.m.cut || x.m.score == null ? '' : rank}</td><td>${degenTag(x.d)}</td><td class="r">${x.m.cut ? '<span class="cut-badge">CUT</span>' : scoreCell(x.m.score)}</td></tr>`;
  }).join('');
  return `<section class="card">
    <div class="card-h"><h2>MMGW Index</h2><span class="right faint" style="font-size:12px">Best ${fmt.mmgwCount}${fmt.dfl ? ' (all 4)' : ` of ${fmt.rounds}`}</span></div>
    <table class="mmgw"><tbody>${body}</tbody></table>
    <div class="note">${fmt.dfl ? 'No cut at the TOUR Championship. DFL pick not included.' : `Fewer than ${fmt.mmgwCount} golfers making the cut = CUT.`} Bragging rights only.</div>
  </section>`;
}

// ── FRL card: round-1 board ──
function renderFrlCard(ds, sw, res, players, own) {
  if (sw.noFrl) {
    return `<section class="card"><div class="card-h"><h2>First Round Leader</h2><span class="right faint" style="font-size:12px">Off this week</span></div><div class="card-b">
      <div class="muted">${ds.t.multiCourse ? `This tournament is played on more than one course (${esc(ds.t.course)}), so there's` : 'There\'s'} no first-round leader pot this week. The $${sw.frlStake}/Degen FRL pot carries to the next tournament unchanged.</div>
    </div></section>`;
  }
  const r1 = players.filter((p) => p.rounds && p.rounds[0] && p.rounds[0].toPar != null);
  if (!r1.length) {
    return `<section class="card"><div class="card-h"><h2>First Round Leader</h2></div><div class="card-b">
      <div class="muted">$${sw.frlStake ?? S.config.frlBase} per Degen to whoever drafts the <b>solo</b> leader after Round 1. A tie between drafted golfers splits the pot; if any tied leader is Undrafted, nobody wins and it rolls over +$${S.config.frlStep}.</div>
    </div></section>`;
  }
  const sorted = [...r1].sort((a, b) => a.rounds[0].toPar - b.rounds[0].toPar || (b.rounds[0].holes - a.rounds[0].holes)).slice(0, 8);
  const rows = sorted.map((p) => {
    const d = own.reg.get(p.key);
    const r0 = p.rounds[0];
    return `<tr class="${d && d === S.me ? 'me' : ''}"><td>${esc(p.name)}</td><td>${d ? degenTag(d) : '<span class="undrafted">Undrafted</span>'}</td><td class="c faint num">${r0.holes >= 18 || r0.strokes ? (r0.strokes || 'F') : r0.holes}</td><td class="r">${scoreCell(r0.toPar)}</td></tr>`;
  }).join('');
  const label = res.frlFinal ? (res.overridden.frl ? 'Final (set by commissioner)' : 'Final') : 'Round 1 live';
  return `<section class="card"><div class="card-h"><h2>First Round Leader</h2><span class="right faint" style="font-size:12px">${label}</span></div>
    <table><thead><tr><th>Golfer</th><th>Degen</th><th class="c">R1</th><th class="r">To par</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

// ── Degen leaderboard ──
function renderLeaderboard(ds, lb, own) {
  const players = (lb && lb.players) || [];
  if (!lb) return `<section class="card"><div class="card-h"><h2>Degen Leaderboard</h2></div><div class="empty">Loading ESPN leaderboard…</div></section>`;
  if (!players.length || !lb.event || lb.event.state === 'pre') {
    const msg = lb.error ? `Couldn't reach the leaderboard: ${esc(lb.error)}` : lb.available === false ? 'ESPN doesn\'t have this tournament yet.' : 'Scores start when the first round tees off.';
    return `<section class="card"><div class="card-h"><h2>Degen Leaderboard</h2></div><div class="empty">${msg}</div></section>`;
  }
  const degens = S.config.degens;
  const filters = [['all', 'All'], ['drafted', 'Drafted'], ...degens.map((d) => [d, d])];
  const swk = season().weeks.find((x) => x.week === ds.t.week) || {};
  const frlKeys = new Set((!swk.noFrl && L.effectiveResults(ds.r).frlFinal ? L.effectiveResults(ds.r).frlLeaders : []).map((p) => p.key));
  let rows = players;
  if (S.lbFilter === 'drafted') rows = rows.filter((p) => own.reg.has(p.key) || own.dfl.has(p.key));
  else if (S.lbFilter !== 'all') rows = rows.filter((p) => own.reg.get(p.key) === S.lbFilter || own.dfl.get(p.key) === S.lbFilter);
  const body = rows.map((p) => {
    const d = own.reg.get(p.key);
    const dd = own.dfl.get(p.key);
    const out = p.status !== 'active';
    const degenCell = d ? degenTag(d) : dd ? `${degenTag(dd)} <span class="faint" style="font-size:11px">DFL</span>` : '<span class="undrafted">Undrafted</span>';
    return `<tr class="${d || dd ? 'drafted' : ''} ${out ? 'cut-row' : ''} ${(d || dd) === S.me && S.me ? 'me' : ''}">
      <td class="pos num sticky-col">${esc(p.pos)}</td>
      <td class="golfer-cell">${esc(p.name)}${frlKeys.has(p.key) ? '<span class="frl-flag">FRL</span>' : ''}</td>
      <td class="c">${out ? `<span class="score num out-score">${p.toPar == null ? p.status.toUpperCase() : L.fmtToPar(p.toPar)}</span>` : scoreCell(p.toPar)}</td>
      <td>${degenCell}</td>
      <td class="c num">${esc(p.todayStr)}</td>
      <td class="c num faint">${esc(p.thru)}</td>
    </tr>`;
  }).join('');
  return `<section class="card">
    <div class="card-h"><h2>Degen Leaderboard</h2>${(ds.r.order && ds.r.order.length) || ds.picks.length ? `<span class="right faint" style="font-size:12px">${players.length} golfers</span>` : refreshCtl(ds.t.week)}</div>
    <div class="filters">${filters.map(([k, l]) => `<button type="button" data-lbf="${k}" aria-pressed="${S.lbFilter === k}">${esc(l)}</button>`).join('')}</div>
    <div class="scroll"><table class="lb-table">
      <thead><tr><th class="sticky-col">Pos</th><th>Golfer</th><th class="c">Score</th><th>Degen</th><th class="c">Today</th><th class="c">Thru</th></tr></thead>
      <tbody>${body || '<tr><td colspan="6" class="empty">Nobody here.</td></tr>'}</tbody>
    </table></div>
  </section>`;
}

// ───────────────────────── MONEY VIEW ─────────────────────────
function renderMoney() {
  const s = season();
  const anyDfl = s.standings.some((r) => r.dfls);
  const leader = s.standings[0];
  const rows = s.standings.map((r, i) => `<tr class="${r.degen === S.me ? 'me' : ''} ${i === 0 && r.winnings > 0 ? 'leader' : ''}">
    <td class="sticky-col">${degenTag(r.degen)}</td>
    <td class="c num">${r.wins}</td>
    <td class="c num">${r.frls}</td>
    ${anyDfl ? `<td class="c num">${r.dfls}</td>` : ''}
    <td class="r num amt">${money(r.winnings)}</td>
    <td class="r num ${r.net > 0 ? 'pos-amt' : r.net < 0 ? 'neg-amt' : ''}">${r.net > 0 ? '+' : ''}${money(r.net)}</td>
  </tr>`).join('');
  const played = s.weeks.filter((w) => w.final && w.drafted).length;
  const cur = L.currentWeek(S.tournaments, todayISO());
  const curW = s.weeks.find((w) => w.week === cur);
  const frlNow = curW ? curW.frlStake : s.nextFrlStake;
  const N = S.config.degens.length;
  return `
  <div class="pots">
    <div class="pot"><div class="lbl">Season leader</div><div class="amt">${leader && leader.winnings > 0 ? esc(leader.degen) : '—'}</div><div class="who">${leader && leader.winnings > 0 ? `${money(leader.winnings)} won` : 'No money won yet'}</div></div>
    <div class="pot"><div class="lbl">Tournaments settled</div><div class="amt num">${played} <small>of ${S.tournaments.length}</small></div></div>
    <div class="pot ${frlNow > S.config.frlBase ? 'rolled' : ''}"><div class="lbl">FRL pot${curW && curW.noFrl ? ' (off this week)' : ' this week'}</div><div class="amt num">$${frlNow * (N - 1)} <small>$${frlNow}/Degen</small></div>${curW && curW.noFrl ? '<div class="who">Multi-course event — carries over</div>' : ''}</div>
  </div>
  <section class="card">
    <div class="card-h"><h2>Season Money Leaderboard</h2></div>
    <div class="scroll"><table class="money">
      <thead><tr><th class="sticky-col">Degen</th><th class="c">Wins</th><th class="c">FRLs</th>${anyDfl ? '<th class="c">DFL</th>' : ''}<th class="r">Winnings</th><th class="r">Net</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="note"><b>Winnings</b> = money collected from the other Degens. <b>Net</b> = winnings minus stakes paid out on pots you didn't win (all six nets add up to $0).</div>
  </section>`;
}

// ───────────────────────── SCHEDULE VIEW ─────────────────────────
function renderSchedule() {
  const s = season();
  const cur = L.currentWeek(S.tournaments, todayISO());
  const list = (arr) => (arr && arr.length ? arr.map(esc).join(', ') : '');
  const rows = S.tournaments.map((t) => {
    const w = s.weeks.find((x) => x.week === t.week) || {};
    const winner = w.winnerDegen ? (w.winnerDegen === 'Undrafted' ? '<span class="undrafted">Undrafted</span>' : degenTag(w.winnerDegen)) : '';
    const frlD = w.noFrl ? '<span class="faint">No FRL</span>' : w.frlDegens && w.frlDegens.length ? (w.frlDegens[0] === 'Undrafted' ? '<span class="undrafted">Undrafted</span>' : w.frlDegens.map(degenTag).join(' ')) : '';
    const lastName = (n) => esc(String(n).split(' ').slice(-1)[0]);
    return `<tr class="clickable ${t.week === cur ? 'current' : ''}" data-week="${t.week}">
      <td class="num faint">${t.week}</td>
      <td class="tname sticky-col">${esc(t.name)}${t.tag ? `<span class="badge ${t.tag}">${t.tag === 'Co-sanctioned' ? 'Co-sanc.' : t.tag}</span>` : ''}</td>
      <td>${esc(t.dateLabel)}</td>
      <td class="c"><span class="tier tier-${t.tier}">${t.tier}</span></td>
      <td class="muted loc">${esc(t.location)}</td>
      <td class="r num">$${w.stake}</td>
      <td class="r num">$${w.payout}</td>
      <td class="r num ${w.noFrl ? 'faint' : ''}">${w.noFrl ? '—' : `$${w.frlStake}`}</td>
      <td class="r num ${w.noFrl ? 'faint' : ''}">${w.noFrl ? '—' : `$${w.frlPayout}`}</td>
      <td class="c">${winner}</td>
      <td class="c">${frlD}</td>
      <td>${w.golfWinner ? lastName(w.golfWinner) : ''}</td>
      <td>${w.golfFrl && w.golfFrl.length ? w.golfFrl.map(lastName).join(', ') : ''}</td>
    </tr>`;
  }).join('');
  return `<section class="card">
    <div class="card-h"><h2>${S.tournaments[0] ? new Date(S.tournaments[0].start).getUTCFullYear() : ''} PGA Tour Schedule</h2><span class="right faint" style="font-size:12px">Tap a row to open it</span></div>
    <div class="scroll"><table class="sched">
      <thead><tr><th>#</th><th class="sticky-col">Tournament</th><th>Date</th><th class="c">Tier</th><th class="loc">Location</th><th class="r">Stakes</th><th class="r">Payout</th><th class="r">FRL Stakes</th><th class="r">FRL Payout</th><th class="c">Winner</th><th class="c">FRL</th><th>Golf Winner</th><th>Golf FRL</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="note">Stakes are per Degen; Payout = stakes × ${S.config.degens.length - 1}. Rolled-over FRL stakes show on the week they apply.</div>
  </section>`;
}

// ───────────────────────── ADMIN VIEW ─────────────────────────
function renderAdmin() {
  if (!S.adminPin) {
    return `<section class="card"><div class="card-h"><h2>Commissioner</h2></div><div class="card-b form">
      <div class="help">Enter the commissioner PIN to set draft orders, paste odds, fix picks, and override results.</div>
      <div class="row"><div class="field"><label for="adminPinIn">Commissioner PIN</label><input id="adminPinIn" type="password" inputmode="numeric" autocomplete="off"></div><button class="btn primary" type="button" id="adminLogin" style="height:38px">Unlock</button></div>
    </div></section>`;
  }
  const w = S.adminWeek || S.route.week || L.currentWeek(S.tournaments, todayISO());
  S.adminWeek = w;
  const ds = draftState(w);
  const { t, r, fmt } = ds;
  const degens = S.config.degens;
  const order = r.order || [];
  const ovr = r.override || {};
  const auto = r.result || {};
  const N = degens.length;
  const lastPick = ds.picks[ds.picks.length - 1];

  return `
  ${S.storage === 'memory' ? '<div class="warn"><b>Database not connected</b> — see README step 3.</div>' : ''}
  <section class="card"><div class="card-h"><h2>Week</h2><span class="right"><button class="btn sm" type="button" id="adminLogout">Lock</button></span></div>
    <div class="card-b form">
      <div class="field"><label for="adminWeek">Tournament</label><select id="adminWeek">${S.tournaments.map((x) => `<option value="${x.week}" ${x.week === w ? 'selected' : ''}>Wk ${x.week} · ${esc(x.name)} (${esc(x.dateLabel)})</option>`).join('')}</select></div>
      <div class="field"><label>Draft order (1st → 6th)</label>
        <div class="order-picker">${degens.map((_, i) => `<select data-order="${i}" aria-label="Pick ${i + 1}"><option value="">${i + 1}</option>${degens.map((d) => `<option ${order[i] === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`).join('')}</div>
      </div>
      <div class="row">
        <div class="field"><label for="wkRounds">Rounds</label><input id="wkRounds" type="number" min="1" max="12" placeholder="${fmt.rounds}" value="${esc(r.rounds ?? '')}"></div>
        <div class="field"><label for="wkStake">Stake / Degen</label><input id="wkStake" type="number" min="0" placeholder="${S.config.tierStakes[t.tier]} (Tier ${t.tier})" value="${esc(r.stake ?? '')}"></div>
        <div class="field"><label for="wkFrl">FRL stake / Degen</label><input id="wkFrl" type="number" min="0" placeholder="auto (${season().weeks.find((x) => x.week === w)?.frlStake ?? S.config.frlBase})" value="${esc(r.frlStake ?? '')}"></div>
        <div class="field"><label for="wkFrlMode">FRL this week</label><select id="wkFrlMode">
          <option value="" ${!r.frl ? 'selected' : ''}>Auto (${t.multiCourse ? 'off — multi-course' : 'on'})</option>
          <option value="on" ${r.frl === 'on' ? 'selected' : ''}>On</option>
          <option value="off" ${r.frl === 'off' ? 'selected' : ''}>Off (no FRL, pot carries)</option></select></div>
        <div class="field"><label for="wkEspn">ESPN event ID</label><input id="wkEspn" inputmode="numeric" placeholder="auto" value="${esc(r.espnEventId ?? '')}"></div>
      </div>
      <div class="help">Leave a box blank to use the default. Payout = stake × ${N - 1}. Changing a stake updates the season leaderboard right away.</div>
      <div class="row"><button class="btn primary" type="button" id="saveWeek">Save week</button>
        <label class="help" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="wkLock" ${r.draftLocked ? 'checked' : ''}> Lock draft</label></div>
    </div>
  </section>

  <section class="card"><div class="card-h"><h2>Draft tools</h2><span class="right faint num">${ds.picks.length}/${ds.total} picks</span></div>
    <div class="card-b form">
      <div class="row">
        <button class="btn" type="button" id="undoPick" ${lastPick ? '' : 'disabled'}>Undo last pick${lastPick ? ` (${esc(lastPick.degen)}: ${esc(lastPick.golfer.name)})` : ''}</button>
        <button class="btn danger" type="button" id="resetDraft" ${ds.picks.length ? '' : 'disabled'}>Reset draft</button>
      </div>
      <div class="help">While unlocked, you can make picks for whoever is on the clock from the This Week tab.</div>
    </div>
  </section>

  ${renderPickEditor(ds)}

  <section class="card"><div class="card-h"><h2>DraftKings odds</h2></div>
    <div class="card-b form">
      <div class="help">Copy the outright winner list from DraftKings (or any sheet) and paste it here. One golfer per line, like <code>Scottie Scheffler +450</code>. A name line followed by an odds line also works. Golfers that aren't on ESPN yet get added to the draft list.</div>
      <div class="field"><textarea id="oddsText" placeholder="Scottie Scheffler +450&#10;Rory McIlroy +800">${esc((r.odds || []).map((o) => `${o.name} ${L.fmtOdds(o.odds)}`).join('\n'))}</textarea></div>
      <div class="row"><button class="btn primary" type="button" id="saveOdds">Save odds</button><span class="help">${r.odds ? `${r.odds.length} golfers saved` : 'None saved'}</span></div>
    </div>
  </section>

  <section class="card"><div class="card-h"><h2>Results</h2></div>
    <div class="card-b form">
      <div class="help">ESPN fills these automatically. Only set an override if something's wrong. Use golfer names exactly as drafted, separate ties with commas, or type <code>none</code> for no result.</div>
      <div class="field"><label for="ovWinner">Tournament winner</label><input id="ovWinner" placeholder="${esc(auto.winner ? auto.winner.name : 'auto')}" value="${esc(ovr.winner ?? '')}"></div>
      <div class="field"><label for="ovFrl">First-round leader(s)</label><input id="ovFrl" placeholder="${esc(auto.frlLeaders && auto.frlLeaders.length ? auto.frlLeaders.map((p) => p.name).join(', ') : 'auto')}" value="${esc(Array.isArray(ovr.frl) ? ovr.frl.join(', ') : ovr.frl ?? '')}"></div>
      <div class="field"><label for="ovWd">Withdrawn (WD) golfers</label><input id="ovWd" placeholder="Only if ESPN misses one, e.g. Cameron Champ, Camilo Villegas" value="${esc(Array.isArray(ovr.wd) ? ovr.wd.join(', ') : '')}"></div>
      ${fmt.dfl ? `<div class="field"><label for="ovDfl">Dead last (DFL)</label><input id="ovDfl" placeholder="${esc(auto.dfl && auto.dfl.length ? auto.dfl.map((p) => p.name).join(', ') : 'auto')}" value="${esc(Array.isArray(ovr.dfl) ? ovr.dfl.join(', ') : ovr.dfl ?? '')}"></div>` : ''}
      <div class="row"><button class="btn primary" type="button" id="saveOverride">Save overrides</button><button class="btn" type="button" id="refreshEspn">Re-pull from ESPN</button></div>
    </div>
  </section>

  <section class="card"><div class="card-h"><h2>Upload draft orders</h2></div>
    <div class="card-b form">
      <div class="help">Upload a .json file with the draft order for any number of tournaments. Keys can be week numbers or tournament names:</div>
      <pre>{
  "The American Express": ["MK","CC","GW","JR","JS","MM"],
  "2": ["CC","GW","JR","JS","MM","MK"]
}</pre>
      <div class="row"><input type="file" id="ordersFile" accept=".json,application/json"></div>
    </div>
  </section>

  <section class="card"><div class="card-h"><h2>League settings</h2></div>
    <div class="card-b form">
      <div class="field"><label for="cfgDegens">Degens (comma-separated)</label><input id="cfgDegens" value="${esc(degens.join(', '))}"></div>
      <div class="row">
        <div class="field"><label for="cfgT1">Tier 1 stake</label><input id="cfgT1" type="number" value="${S.config.tierStakes[1]}"></div>
        <div class="field"><label for="cfgT2">Tier 2 stake</label><input id="cfgT2" type="number" value="${S.config.tierStakes[2]}"></div>
        <div class="field"><label for="cfgT3">Tier 3 stake</label><input id="cfgT3" type="number" value="${S.config.tierStakes[3]}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="cfgFrlBase">FRL base</label><input id="cfgFrlBase" type="number" value="${S.config.frlBase}"></div>
        <div class="field"><label for="cfgFrlStep">FRL rollover +</label><input id="cfgFrlStep" type="number" value="${S.config.frlStep}"></div>
        <div class="field"><label for="cfgDfl">DFL stake</label><input id="cfgDfl" type="number" value="${S.config.dflStake}"></div>
      </div>
      <div class="row"><button class="btn primary" type="button" id="saveConfig">Save settings</button></div>
      <div class="help">Changing the Degens list mid-season will break past draft orders. It's meant for setting up a new league or season.</div>
    </div>
  </section>

  <section class="card"><div class="card-h"><h2>Schedule</h2></div>
    <div class="card-b form">
      <div class="help">Upload a new pga_tour_schedule.json (same format) for a new season.</div>
      <div class="row"><div class="field"><label for="schedYear">Season year</label><input id="schedYear" type="number" value="${S.tournaments[0] ? new Date(S.tournaments[0].start).getUTCFullYear() : 2027}"></div><input type="file" id="schedFile" accept=".json,application/json"></div>
    </div>
  </section>`;
}

// Commissioner: every slot of the draft, with the golfer editable on picks already made.
function renderPickEditor(ds) {
  const { t, r, fmt, picks } = ds;
  if (!ds.hasOrder && !picks.length) return `<section class="card"><div class="card-h"><h2>Draft picks</h2></div><div class="empty">Set this week's draft order first.</div></section>`;
  const w = t.week;
  if (!S.lb[w] && !S.lbLoading[w]) loadLb(w).then(render);
  const pool = draftPool(ds, (S.lb[w] && S.lb[w].players) || []);
  const seq = ds.hasOrder ? L.snakeSequence(r.order, fmt) : picks.map((p) => ({ pick: p.pick, round: p.round, degen: p.degen, dfl: p.dfl }));
  const rows = seq.map((slot, i) => {
    const pk = picks[i];
    const roundLbl = slot.dfl ? 'DFL' : slot.round;
    if (!pk) return `<tr><td class="num faint">${slot.pick}</td><td class="c num faint">${roundLbl}</td><td>${degenTag(slot.degen)}</td><td class="faint" colspan="2">${i === picks.length ? 'On the clock' : 'Not picked yet'}</td></tr>`;
    return `<tr><td class="num faint">${pk.pick}</td><td class="c num faint">${roundLbl}</td><td>${degenTag(pk.degen)}</td>
      <td style="width:100%"><input class="pick-input" id="pk-${i}" list="fieldList" value="${esc(pk.golfer.name)}" aria-label="Pick ${pk.pick} golfer" autocomplete="off"></td>
      <td><button class="btn sm" type="button" data-editpick="${i}">Save</button></td></tr>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>Draft picks</h2><span class="right faint num">${picks.length}/${ds.total}</span></div>
    <datalist id="fieldList">${pool.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>
    <div class="scroll" style="max-height:520px;overflow-y:auto"><table class="pick-edit">
      <thead><tr><th>#</th><th class="c">Rd</th><th>Degen</th><th>Golfer</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="note">Change a golfer and tap <b>Save</b> on that row. Start typing to pick from this week's field. A golfer can only be on one team.</div>
  </section>`;
}

// ───────────────────────── Render & events ─────────────────────────
function render() {
  if (!S.tournaments.length) return;
  if (S.route.tab === 'week' && !S.route.week) parseRoute();
  renderTabs();
  const view = $('#view');
  const focusId = document.activeElement && document.activeElement.id;
  const caret = focusId === 'draftSearch' ? document.activeElement.selectionStart : null;
  const scrollPlayers = $('.players') ? $('.players').scrollTop : 0;
  S._season = null;
  // Keep anything typed but not yet saved (e.g. a pick edit) across background refreshes.
  const dirty = S.skipDirty ? [] : [...view.querySelectorAll('input[id], textarea[id], select[id]')]
    .filter((el) => el.type !== 'file' && (el.type === 'checkbox' ? el.checked !== el.defaultChecked : el.tagName === 'SELECT' ? [...el.options].some((o) => o.selected !== o.defaultSelected) : el.value !== el.defaultValue))
    .map((el) => [el.id, el.type === 'checkbox' ? el.checked : el.value]);
  S.skipDirty = false;
  view.innerHTML = S.route.tab === 'money' ? renderMoney() : S.route.tab === 'schedule' ? renderSchedule() : S.route.tab === 'admin' ? renderAdmin() : renderWeek();
  for (const [id, v] of dirty) {
    const el = document.getElementById(id);
    if (!el || id === 'draftSearch') continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
  if (focusId && $(`#${focusId}`)) { const el = $(`#${focusId}`); el.focus(); if (caret != null) el.setSelectionRange(caret, caret); }
  if ($('.players')) $('.players').scrollTop = scrollPlayers;
  schedulePoll();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, tr[data-week]');
  if (!el) return;

  if (el.dataset.week && el.matches('.arrow')) return go(`#/week/${el.dataset.week}`);
  if (el.matches('tr[data-week]')) return go(`#/week/${el.dataset.week}`);
  if (el.dataset.lbf) { S.lbFilter = el.dataset.lbf; return render(); }
  if (el.id === 'refreshLb') { const w0 = S.route.week; S.lbLoading[w0] = false; const p = loadLb(w0, true); render(); await p; if (S.lb[w0]) S.lb[w0]._fetchedAt = Date.now(); toast('Leaderboard refreshed'); return render(); }

  if (el.dataset.pick) {
    const key = el.dataset.pick;
    if (S.armed !== key) { S.armed = key; render(); setTimeout(() => { if (S.armed === key) { S.armed = null; render(); } }, 4000); return; }
    S.armed = null;
    const ds = draftState(S.route.week);
    if (!ds.clock) return;
    el.disabled = true;
    try {
      await api('/api/pick', { week: S.route.week, degen: ds.clock.degen, by: S.me, pin: S.pin, adminPin: S.adminPin || undefined, golfer: { name: el.dataset.name, id: el.dataset.id || null } });
      toast(`${ds.clock.degen} drafts ${el.dataset.name}`);
      S.draftSearch = '';
    } catch (err) {
      if (err.status === 401) { const p = prompt('League PIN'); if (p) { S.pin = p; localStorage.setItem('gd.pin', p); } }
      else toast(err.message, true);
    }
    await loadAll();
    return render();
  }

  if (el.dataset.editpick != null) {
    const i = Number(el.dataset.editpick);
    const name = $(`#pk-${i}`).value.trim();
    const ds = draftState(S.adminWeek);
    const match = draftPool(ds, (S.lb[S.adminWeek] && S.lb[S.adminWeek].players) || []).find((p) => p.key === L.nameKey(name));
    if (!match && !confirm(`"${name}" isn't in this week's field. Save it anyway?`)) return;
    try {
      await api('/api/admin', { pin: S.adminPin, action: 'editPick', week: S.adminWeek, index: i, golfer: { name: match ? match.name : name, id: match ? match.id : null } });
      toast(`Pick ${ds.picks[i].pick} → ${match ? match.name : name}`);
      await loadAll(); render();
    } catch (err) { toast(err.message, true); }
    return;
  }

  // ── admin ──
  const adm = (body, okMsg) => api('/api/admin', { pin: S.adminPin, ...body }).then(async (d) => { if (okMsg) toast(typeof okMsg === 'function' ? okMsg(d) : okMsg); await loadAll(); render(); return d; }).catch((err) => { toast(err.message, true); if (err.status === 401) { S.adminPin = ''; localStorage.removeItem('gd.adminPin'); render(); } });
  const w = S.adminWeek;
  switch (el.id) {
    case 'adminLogin': {
      const pin = $('#adminPinIn').value.trim();
      try { await api('/api/admin', { pin, action: 'checkPin' }); S.adminPin = pin; localStorage.setItem('gd.adminPin', pin); render(); toast('Commissioner mode on'); } catch (err) { toast(err.message, true); }
      return;
    }
    case 'adminLogout': S.adminPin = ''; localStorage.removeItem('gd.adminPin'); return render();
    case 'saveWeek': {
      const order = [...document.querySelectorAll('[data-order]')].map((s) => s.value);
      const patch = { rounds: num($('#wkRounds').value), stake: num($('#wkStake').value), frlStake: num($('#wkFrl').value), espnEventId: $('#wkEspn').value.trim() || null, draftLocked: $('#wkLock').checked || null, frl: $('#wkFrlMode').value || null };
      if (order.every(Boolean)) patch.order = order;
      else if (order.some(Boolean)) return toast('Fill all six draft slots (or none)', true);
      return adm({ action: 'setWeek', week: w, patch }, 'Week saved');
    }
    case 'undoPick': return adm({ action: 'undoPick', week: w }, 'Last pick removed');
    case 'resetDraft': if (confirm('Delete every pick for this tournament?')) return adm({ action: 'resetDraft', week: w }, 'Draft reset'); return;
    case 'saveOdds': return adm({ action: 'setOdds', week: w, text: $('#oddsText').value }, (d) => `${d.count} golfers saved`);
    case 'saveOverride': {
      const list = (v) => { v = v.trim(); if (!v) return null; if (/^none$/i.test(v)) return 'none'; return v.split(',').map((x) => x.trim()).filter(Boolean); };
      const winner = $('#ovWinner').value.trim();
      const body = { action: 'setOverride', week: w, winner: winner ? (/^none$/i.test(winner) ? 'none' : winner) : null, frl: list($('#ovFrl').value) };
      if ($('#ovDfl')) body.dfl = list($('#ovDfl').value);
      body.wd = list($('#ovWd').value) || 'none';
      return adm(body, 'Overrides saved');
    }
    case 'refreshEspn': await adm({ action: 'refreshResults', week: w }); await loadLb(w, true); await loadAll(); render(); return toast('Pulled fresh from ESPN');
    case 'saveConfig': return adm({ action: 'setConfig', patch: {
      degens: $('#cfgDegens').value.split(',').map((x) => x.trim()).filter(Boolean),
      tierStakes: { 1: $('#cfgT1').value, 2: $('#cfgT2').value, 3: $('#cfgT3').value },
      frlBase: $('#cfgFrlBase').value, frlStep: $('#cfgFrlStep').value, dflStake: $('#cfgDfl').value,
    } }, 'Settings saved');
  }
});
const num = (v) => (String(v).trim() === '' ? null : Number(v));

document.addEventListener('input', (e) => {
  if (e.target.id === 'draftSearch') { S.draftSearch = e.target.value; render(); }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'weekSelect') return go(`#/week/${el.value}`);
  if (el.id === 'showTaken') { S.showTaken = el.checked; return render(); }
  if (el.id === 'adminWeek') { S.adminWeek = Number(el.value); S.skipDirty = true; return render(); }
  if (el.id === 'ordersFile' || el.id === 'schedFile') {
    const f = el.files[0];
    if (!f) return;
    let json;
    try { json = JSON.parse(await f.text()); } catch { return toast('That file isn\'t valid JSON', true); }
    try {
      const d = el.id === 'ordersFile'
        ? await api('/api/admin', { pin: S.adminPin, action: 'uploadOrders', json })
        : await api('/api/admin', { pin: S.adminPin, action: 'uploadSchedule', json, year: $('#schedYear').value });
      toast(el.id === 'ordersFile' ? `Saved ${d.saved} draft order${d.saved === 1 ? '' : 's'}${d.errors.length ? ` · ${d.errors.length} skipped` : ''}` : `Schedule loaded (${d.count} events)`, d.errors && d.errors.length);
      if (d.errors && d.errors.length) alert(d.errors.join('\n'));
      await loadAll(); render();
    } catch (err) { toast(err.message, true); }
    el.value = '';
  }
});

// ───────────────────────── Who am I ─────────────────────────
function whoAmI() {
  const m = $('#modal');
  let pick = S.me;
  const draw = () => {
    m.innerHTML = `<form method="dialog" class="modal-b">
      <h3>Which Degen are you?</h3>
      <div class="muted" style="font-size:14px">This phone will draft as this Degen. You can change it anytime from the top-right corner.</div>
      <div class="who-grid">${S.config.degens.map((d) => `<button type="button" data-me="${d}" aria-pressed="${pick === d}">${d}</button>`).join('')}</div>
      <div class="field"><label for="pinIn">League PIN (if your league uses one)</label><input id="pinIn" type="password" inputmode="numeric" value="${esc(S.pin)}" autocomplete="off"></div>
      <div class="modal-actions"><button class="btn primary" value="ok" ${pick ? '' : 'disabled'}>Done</button></div>
    </form>`;
  };
  draw();
  m.onclick = (e) => { const b = e.target.closest('[data-me]'); if (b) { pick = b.dataset.me; draw(); } };
  m.onclose = () => {
    if (pick) { S.me = pick; localStorage.setItem('gd.me', pick); }
    const p = $('#pinIn') && $('#pinIn').value.trim();
    S.pin = p || ''; localStorage.setItem('gd.pin', S.pin);
    render();
  };
  m.showModal();
}

// ───────────────────────── Boot ─────────────────────────
(async function boot() {
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  try {
    await loadAll();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">Couldn't load the league: ${esc(e.message)}</div>`;
    return;
  }
  parseRoute();
  render();
  if (!S.me) whoAmI();
})();
