import test from 'node:test';
import assert from 'node:assert/strict';
import scheduleRows from '../js/schedule-data.js';
import * as L from '../js/league.js';
import { mockScoreboard } from '../scripts/mock-espn.js';

const schedule = L.parseSchedule(scheduleRows, 2027);
const cfg = L.DEFAULT_CONFIG;

test('schedule parses dates, tiers, formats', () => {
  assert.equal(schedule.length, 32);
  assert.deepEqual([schedule[0].start, schedule[0].end], ['2027-01-18', '2027-01-24']);
  const masters = schedule.find((t) => t.name === 'Masters Tournament');
  assert.equal(masters.tag, 'Major');
  assert.equal(masters.format.rounds, 8);
  assert.equal(masters.format.mmgwCount, 5);
  const players = schedule.find((t) => /PLAYERS/.test(t.name));
  assert.equal(players.format.rounds, 8);
  const tc = schedule.find((t) => t.name === 'TOUR Championship');
  assert.deepEqual([tc.format.rounds, tc.format.dfl, tc.format.mmgwCount], [4, true, 4]);
  const apr = schedule.find((t) => t.dateLabel === 'March 29-April 4');
  assert.deepEqual([apr.start, apr.end], ['2027-03-29', '2027-04-04']);
  const aug = schedule.find((t) => t.dateLabel === 'July 26-Aug. 1');
  assert.deepEqual([aug.start, aug.end], ['2027-07-26', '2027-08-01']);
  assert.equal(schedule.find((t) => t.name === 'Valero Texas Open').format.rounds, 6);
  for (const t of schedule) assert.ok(t.start && t.end, t.dateLabel);
});

test('current week selection', () => {
  assert.equal(L.currentWeek(schedule, '2026-11-19'), 1);
  assert.equal(L.currentWeek(schedule, '2027-02-10'), 4);
  assert.equal(L.currentWeek(schedule, '2027-12-01'), 32);
});

test('snake order incl. DFL round', () => {
  const order = ['MK', 'CC', 'GW', 'JR', 'JS', 'MM'];
  const seq = L.snakeSequence(order, { rounds: 4, dfl: true });
  assert.equal(seq.length, 30);
  assert.equal(seq[5].degen, 'MM');
  assert.equal(seq[6].degen, 'MM');
  assert.equal(seq[11].degen, 'MK');
  assert.equal(seq[24].round, 5);
  assert.ok(seq[24].dfl);
  assert.equal(seq[24].degen, 'MK');
});

test('odds paste parsing', () => {
  const txt = 'Scottie Scheffler +450\nRory McIlroy\n+800\nLudvig Åberg\t1400\nJ.J. Spaun -110\nWINNER\n';
  const o = L.parseOddsText(txt);
  assert.deepEqual(o.map((x) => [x.name, x.odds]), [['Scottie Scheffler', 450], ['Rory McIlroy', 800], ['Ludvig Åberg', 1400], ['J.J. Spaun', -110]]);
  assert.equal(L.nameKey('Ludvig Åberg'), L.nameKey('Ludvig Aberg'));
  assert.equal(L.nameKey('Nicolai Højgaard'), 'nicolai hojgaard');
});

test('ESPN normalizer: live round 3 with and without status objects', () => {
  for (const withStatus of [true, false]) {
    const ev = L.normalizeEspnEvent(L.matchEspnEvent(mockScoreboard({ stage: 'r3', withStatus }).events, 'The American Express'));
    assert.equal(ev.name, 'The American Express');
    assert.equal(ev.period, 3);
    const cut = ev.players.filter((p) => p.status === 'cut');
    assert.equal(cut.length, 21, `withStatus=${withStatus}`);
    const live = ev.players.find((p) => p.status === 'active' && p.rounds[2].started);
    assert.ok(/^\d+$/.test(live.thru));
    const notStarted = ev.players.find((p) => p.status === 'active' && !p.rounds[2].started);
    assert.ok(notStarted.thru.includes(':'), notStarted.thru);
    assert.equal(ev.players[0].posNum, 1);
  }
});

test('results: FRL solo, FRL tie, winner, DFL', () => {
  const r2 = L.normalizeEspnEvent(mockScoreboard({ stage: 'r2' }).events[0]);
  const res = L.computeResults(r2, { dfl: false });
  assert.ok(res.frlFinal);
  assert.deepEqual(res.frlLeaders.map((p) => p.name), ['Collin Morikawa']);
  const tie = L.computeResults(L.normalizeEspnEvent(mockScoreboard({ stage: 'r2', frlTie: true }).events[0]), {});
  assert.deepEqual(tie.frlLeaders.map((p) => p.name).sort(), ['Collin Morikawa', 'Gary Woodland']);
  const fin = L.normalizeEspnEvent(mockScoreboard({ stage: 'final' }).events[0]);
  const fr = L.computeResults(fin, { dfl: true });
  assert.ok(fr.final);
  assert.equal(fr.winner.name, fin.players[0].name);
  assert.ok(fr.dfl.length >= 1);
  const r1 = L.computeResults(L.normalizeEspnEvent(mockScoreboard({ stage: 'r1' }).events[0]), {});
  assert.equal(r1.frlFinal, false);
});

test('MMGW best 4 of 6, CUT when fewer than 4 alive', () => {
  const lb = { state: 'in', period: 3, players: [
    ...[-7, -5, -5, -3, -2, -1].map((s, i) => ({ id: `a${i}`, key: `a${i}`, name: `a${i}`, toPar: s, status: 'active' })),
    ...[-4, 2].map((s, i) => ({ id: `b${i}`, key: `b${i}`, name: `b${i}`, toPar: s, status: 'active' })),
    ...[3, 4, 5, 6].map((s, i) => ({ id: `c${i}`, key: `c${i}`, name: `c${i}`, toPar: s, status: 'cut' })),
  ] };
  const picks = (ids) => ids.map((id) => ({ golfer: { id, name: id } }));
  const fmt = { mmgwCount: 4 };
  assert.equal(L.mmgwFor(picks(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']), lb, fmt).score, -20);
  assert.equal(L.mmgwFor(picks(['b0', 'b1', 'c0', 'c1', 'c2', 'c3']), lb, fmt).cut, true);
  assert.equal(L.mmgwFor(picks(['a0', 'b0', 'b1', 'a1', 'c0', 'c1']), lb, fmt).score, -14);
});

test('season money: wins, undrafted winner, FRL rollover and split, DFL', () => {
  const degens = cfg.degens;
  const t = [schedule[5], schedule[3], schedule[4]].map((x, i) => ({ ...x, week: i + 1 })).concat(schedule.find((x) => x.name === 'TOUR Championship'));
  const mkPicks = (pairs) => pairs.map(([degen, name], i) => ({ pick: i + 1, degen, golfer: { name } }));
  const records = {
    // Week 1 (tier 3, $15): MK drafted winner A; FRL leader undrafted -> rolls to $6
    1: { picks: mkPicks([['MK', 'Alpha'], ['CC', 'Bravo']]), result: { final: true, winner: { name: 'Alpha', key: 'alpha' }, frlFinal: true, frlLeaders: [{ name: 'Zed', key: 'zed' }] } },
    // Week 2 (tier 2, $20): winner undrafted -> no money; FRL $6 tie between CC and GW golfers
    2: { picks: mkPicks([['CC', 'Cat'], ['GW', 'Dog']]), result: { final: true, winner: { name: 'Nobody', key: 'nobody' }, frlFinal: true, frlLeaders: [{ name: 'Cat', key: 'cat' }, { name: 'Dog', key: 'dog' }] } },
    // Week 3 (tier 2, $20): commissioner override winner = Echo (JR)
    3: { picks: mkPicks([['JR', 'Echo']]), override: { winner: 'Echo', frl: 'none' } },
  };
  const tc = t[3];
  records[tc.week] = {
    picks: [...mkPicks([['MM', 'Fox']]), { pick: 25, degen: 'JS', dfl: true, golfer: { name: 'Last Guy' } }],
    result: { final: true, winner: { name: 'Fox', key: 'fox' }, frlFinal: false, dfl: [{ name: 'Last Guy', key: 'last guy' }] },
  };
  const s = L.computeSeason(t, records, cfg);
  const by = Object.fromEntries(s.standings.map((r) => [r.degen, r]));
  assert.equal(by.MK.wins, 1);
  assert.equal(by.MK.winnings, 75);
  assert.equal(s.weeks[0].frlRolled, true);
  assert.equal(s.weeks[1].frlStake, 6);
  assert.equal(s.weeks[1].winnerDegen, 'Undrafted');
  // FRL split: pool 36, each gets 18, net +12
  assert.equal(by.CC.frls, 1);
  assert.equal(by.GW.frls, 1);
  assert.equal(by.CC.winnings, 12);
  // week 3 override FRL none -> rolls again from 5 (reset after week 2) to 6
  assert.equal(s.weeks[2].frlStake, 5);
  assert.equal(by.JR.winnings, 100);
  assert.equal(s.weeks[3].frlStake, 6);
  // Tour Championship tier 1 $30 -> 150; DFL $5 -> 25
  assert.equal(by.MM.winnings, 150);
  assert.equal(by.JS.winnings, 25);
  assert.equal(by.JS.dfls, 1);
  // money balances to zero
  assert.equal(s.standings.reduce((a, r) => a + r.net, 0), 0);
  assert.equal(degens.length, 6);
});

test('draft order upload formats', () => {
  const order = ['MK', 'CC', 'GW', 'JR', 'JS', 'MM'];
  const a = L.parseDraftOrders({ 1: order, 'WM Phoenix Open': order, 'Masters Tournament #': order }, schedule, cfg.degens);
  assert.deepEqual(Object.keys(a.orders).map(Number).sort((x, y) => x - y), [1, 4, 12]);
  const b = L.parseDraftOrders([{ week: 2, order }, { tournament: 'Bogus Open', order }, { week: 3, order: ['MK'] }], schedule, cfg.degens);
  assert.deepEqual(Object.keys(b.orders), ['2']);
  assert.equal(b.errors.length, 2);
});

test('FRL compares to par, not strokes (two-course events)', () => {
  const mk = (name, strokes, toPar) => ({ name, key: L.nameKey(name), id: name, status: 'active', toPar, order: 1,
    rounds: [{ strokes, toPar, holes: 18, started: true }, { strokes: null, toPar: null, holes: 0 }, {}, {}] });
  const lb = { state: 'in', period: 2, players: [mk('Jesper Svensson', 64, -8), mk('Michael Thorbjornsen', 64, -6), mk('Max Greyserman', 65, -7)] };
  const r = L.computeResults(lb, {});
  assert.deepEqual(r.frlLeaders.map((p) => p.name), ['Jesper Svensson']);
});

test('multi-course weeks have no FRL and carry the pot unchanged', () => {
  const amex = schedule[0], sentry = schedule[1], pebble = schedule[2], phx = schedule[3];
  assert.ok(amex.multiCourse && sentry.multiCourse && pebble.multiCourse);
  assert.ok(!phx.multiCourse);
  assert.ok(!schedule.find((t) => t.name === 'U.S. Open').multiCourse);
  const pk = (d, n) => [{ pick: 1, degen: d, golfer: { name: n } }];
  const fin = (w, f) => ({ final: true, winner: { name: w, key: L.nameKey(w) }, frlFinal: true, frlLeaders: [{ name: f, key: L.nameKey(f) }] });
  const t = [phx, amex, { ...phx, week: 99 }];
  const records = {
    4: { picks: pk('MK', 'A'), result: fin('A', 'Nobody') },        // undrafted FRL -> $5 rolls to $6
    1: { picks: pk('MK', 'A'), result: fin('A', 'A') },             // multi-course: FRL ignored, $6 stays
    99: { picks: pk('CC', 'B'), result: fin('B', 'B') },            // CC wins FRL at $6
  };
  const s = L.computeSeason(t, records, cfg);
  assert.equal(s.weeks[1].noFrl, true);
  assert.equal(s.weeks[1].frlStake, 6);
  assert.equal(s.weeks[2].frlStake, 6);
  const by = Object.fromEntries(s.standings.map((r) => [r.degen, r]));
  assert.equal(by.MK.frls, 0);
  assert.equal(by.CC.frls, 1);
  assert.equal(by.CC.winnings, 100 + 30);
  // commissioner can force FRL on/off
  assert.equal(L.frlActive(amex, { frl: 'on' }), true);
  assert.equal(L.frlActive(phx, { frl: 'off' }), false);
});
