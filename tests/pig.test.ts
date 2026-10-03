import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOP } from '../src/shared/hoop.js';
import { HANDS_OUT, MATCH_R, feetOf, forfeit, letters, newGame, scoreLine, shotRefused, shotResult, shotTaken, type PigState } from '../src/shared/pig.js';
import { AWAY_GRACE, AWAY_REACH, HAND_AFTER, INVITE_FOR, PigGames, SHOW_END, type PigDeps, type PigWho, type Whereabouts } from '../src/server/pig.js';
import { Court } from '../src/server/court.js';

// A game of PIG at the hoop: the rules (shared/pig.ts), and the office's games (server/pig.ts), which
// decide every shot, hand the ball to whoever's turn it is, and call it when someone walks off.

const tyler = { id: 't1', name: 'Tyler', color: '#09ca59' };
const gavin = { id: 'g1', name: 'Gavin', color: '#4f86f7' };
/** Where someone stands `d` m straight out from the rim. */
const out = (d: number) => ({ x: HOOP.rim.x + d, z: HOOP.z });

test('the leader sinks one, and the other has to match it from the same spot', () => {
  let g = newGame(tyler, gavin);
  assert.equal(g.turn, 0);
  assert.equal(g.leader, 0);
  assert.equal(g.spot, null, 'the leader shoots from anywhere');
  g = shotResult(g, true, out(6));
  assert.equal(g.turn, 1);
  assert.equal(g.leader, 0);
  assert.deepEqual(g.spot, { ...out(6), dist: 6 });
  assert.match(g.news, /Tyler sank one from 6\.0 m: Gavin to match it/);
  // Gavin matches it: no letter, and Tyler sets the next one.
  g = shotResult(g, true, out(6));
  assert.deepEqual([g.turn, g.leader, g.spot, g.players[1].letters], [0, 0, null, 0]);
});

test('a follower who misses gets a letter, P then I then G, and the leader keeps the lead', () => {
  let g = newGame(tyler, gavin);
  for (const [i, word] of ['P', 'PI'].entries()) {
    g = shotResult(g, true, out(4));
    g = shotResult(g, false, out(4));
    assert.equal(letters(g.players[1].letters), word);
    assert.equal(g.players[1].letters, i + 1);
    assert.deepEqual([g.turn, g.leader, g.winner], [0, 0, null]);
  }
  assert.equal(scoreLine(g), 'TYLER · GAVIN PI');
  g = shotResult(g, true, out(4));
  g = shotResult(g, false, out(4));
  assert.equal(g.players[1].letters, 3);
  assert.equal(g.winner, 0);
  assert.equal(g.end, 'pig');
  assert.match(g.news, /Gavin spelled PIG — Tyler wins/);
  // It's over: nothing changes it any more.
  assert.equal(shotResult(g, true, out(3)), g);
  assert.equal(forfeit(g, 0, 'left'), g);
});

test("a leader's miss passes the turn: the other leads, from anywhere", () => {
  let g = newGame(tyler, gavin);
  g = shotResult(g, false, out(9));
  assert.deepEqual([g.turn, g.leader, g.spot], [1, 1, null]);
  assert.equal(g.players[0].letters, 0, 'no letter for missing your own shot');
  g = shotResult(g, true, out(3));
  assert.deepEqual([g.turn, g.leader], [0, 1]);
  g = shotResult(g, false, out(3));
  assert.equal(scoreLine(g), 'TYLER P · GAVIN');
});

test('out of turn, mid-shot, or off the spot, a shot is refused; a drop never is', () => {
  let g = newGame(tyler, gavin);
  assert.match(shotRefused(g, 'g1', out(3))!, /It's Tyler's shot/);
  assert.equal(shotRefused(g, 't1', out(12)), null);
  assert.equal(shotRefused(g, 'someone-else', out(3)), null, "not theirs to say: they can't have the ball");
  g = shotTaken(g);
  assert.match(shotRefused(g, 't1', out(3))!, /still in the air/);
  g = shotResult(g, true, out(5));
  assert.equal(shotRefused(g, 'g1', out(5 + MATCH_R * 0.9)), null);
  assert.match(shotRefused(g, 'g1', out(6.5))!, /from the ring on the floor \(you're 1\.5 m off\)/);
  assert.match(shotRefused(g, 't1', out(5))!, /It's Gavin's shot/);
  // Where someone stood is worked out from where the ball left their hands, back along its way.
  const feet = feetOf({ x: 1, z: 2, vx: -3, vz: 4 });
  assert.ok(Math.abs(feet.x - (1 + 0.6 * HANDS_OUT)) < 1e-9 && Math.abs(feet.z - (2 - 0.8 * HANDS_OUT)) < 1e-9);
});

// ---- The office's games ----------------------------------------------------------------------------

/** A building with one floor ('f') and the hoop, a clock, and timers run by hand. */
function office() {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; off: boolean }[] = [];
  const where = new Map<string, Whereabouts>();
  const sent: { floor: string; pig: PigState | null }[] = [];
  const toasts: string[] = [];
  const told: [string, unknown][] = [];
  const won: string[] = [];
  const court = new Court(() => now);
  const deps: PigDeps = {
    where: (id) => where.get(id),
    findOwner: (floor, owner) => [...where.entries()].find(([id, w]) => w.floor === floor && id.startsWith(owner.slice(0, 1).toLowerCase()))?.[0],
    changed: (floor, pig) => sent.push({ floor, pig }),
    ball(_floor, reserved, holder) {
      court.reserve(reserved);
      if (holder !== undefined) court.hand(holder);
    },
    toast: (_floor, text) => toasts.push(text),
    tell: (id, msg) => told.push([id, msg]),
    won: (w) => won.push(w.name),
    later(ms, fn) {
      const t = { at: now + ms, fn, off: false };
      timers.push(t);
      return () => void (t.off = true);
    },
    now: () => now,
  };
  const games = new PigGames(deps);
  /** Moves the clock on `ms`, running every timer due on the way, in order. */
  const wait = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => !t.off && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.off = true;
      due.fn();
    }
    now = until;
  };
  const stand = (id: string, d: number, floor = 'f') => where.set(id, { floor, ...out(d), y: 0 });
  return { games, court, where, sent, toasts, told, won, wait, stand, state: () => games.game('f') };
}

const T: PigWho = { ...tyler, owner: 'Tyler' };
const G: PigWho = { ...gavin, owner: 'Gavin' };
/** A throw from `d` m out, the way someone standing there throws at the hoop. */
const throwAt = (d: number) => ({ x: HOOP.rim.x + d - HANDS_OUT, z: HOOP.z, vx: -8, vz: 0 });

test('one asks, the other says yes: the game starts with the ball in the asker’s hands, and theirs alone', () => {
  const o = office();
  o.stand('t1', 4);
  o.stand('g1', 6);
  assert.equal(o.games.invite('f', T, G), undefined);
  assert.equal(o.state(), null);
  assert.deepEqual(o.told[0][0], 'g1');
  assert.equal(o.games.answer('f', G, 't1', true), undefined);
  const g = o.state()!;
  assert.deepEqual(
    g.players.map((p) => p.name),
    ['Tyler', 'Gavin'],
  );
  assert.deepEqual(o.court.state(), { holder: 't1', for: 't1' });
  assert.ok(!o.court.take('g1'), 'nobody else picks it up');
  assert.match(o.toasts[0], /Tyler and Gavin are playing PIG/);
});

test('asking someone who asked you is a yes; a no thanks is passed on; an invite runs out', () => {
  const o = office();
  o.stand('t1', 4);
  o.stand('g1', 6);
  o.games.invite('f', T, G);
  o.games.invite('f', G, T);
  assert.ok(o.state(), 'Gavin asking Tyler back started it');
  const p = office();
  p.stand('t1', 4);
  p.stand('g1', 6);
  p.games.invite('f', T, G);
  assert.equal(p.games.answer('f', G, 't1', false), undefined);
  assert.deepEqual(p.told.at(-1), ['t1', { text: '🐷 Gavin said no thanks' }]);
  p.games.invite('f', T, G);
  p.wait(INVITE_FOR + 1);
  assert.match(p.games.answer('f', G, 't1', true)!, /ran out/);
  assert.equal(p.state(), null);
});

test('nobody plays from across the room, and there is one game a floor', () => {
  const o = office();
  o.stand('t1', 4);
  o.stand('g1', 14);
  assert.match(o.games.invite('f', T, G)!, /Gavin has to be at the hoop too/);
  o.stand('t1', 14);
  assert.match(o.games.invite('f', T, G)!, /Come over to the hoop first/);
  o.stand('t1', 4);
  o.stand('g1', 4);
  o.games.invite('f', T, G);
  o.games.answer('f', G, 't1', true);
  const ann = { id: 'a1', owner: 'Ann', name: 'Ann', color: '#ffffff' };
  o.stand('a1', 3);
  assert.match(o.games.invite('f', ann, T)!, /one game at a time/);
});

/** A game under way between Tyler (leading) and Gavin. */
function playing() {
  const o = office();
  o.stand('t1', 4);
  o.stand('g1', 5);
  o.games.invite('f', T, G);
  o.games.answer('f', G, 't1', true);
  /** `id` throws from `d` m out, and the office's flight says `made`, landing `at` seconds on. */
  const shoot = (id: string, d: number, made: boolean, at = 1) => {
    const s = throwAt(d);
    const why = o.games.mayThrow('f', id, s, false);
    if (why) return why;
    o.court.throw(id, { ...s, y: 1.4, vy: 5 });
    o.games.thrown('f', id, s, { made, at });
    return null;
  };
  return { ...o, shoot };
}

test("the office decides each shot as it lands, then hands the ball to whoever's turn it is", () => {
  const o = playing();
  assert.equal(o.shoot('t1', 6, true, 1.2), null);
  assert.equal(o.state()!.inAir, true);
  assert.equal(o.court.state().for, '', 'nobody grabs the ball out of the air');
  o.wait(1000);
  assert.equal(o.state()!.spot, null, 'not in yet');
  o.wait(200);
  assert.deepEqual(o.state()!.spot, { ...out(6), dist: 6 });
  assert.equal(o.state()!.turn, 1);
  o.wait(HAND_AFTER);
  assert.deepEqual([o.court.state().holder, o.court.state().for], ['g1', 'g1']);
  assert.ok(o.told.some(([id, m]) => id === 'g1' && /Gavin to match it/.test((m as { text: string }).text)));
});

test("refused out of turn and off the spot, and the follower's miss is a letter", () => {
  const o = playing();
  assert.match(o.shoot('g1', 4, true)!, /It's Tyler's shot/);
  o.shoot('t1', 6, true);
  o.wait(1000 + HAND_AFTER);
  assert.match(o.shoot('g1', 3, true)!, /from the ring/);
  assert.equal(o.state()!.players[1].letters, 0);
  o.shoot('g1', 6, false);
  o.wait(1000);
  assert.equal(o.state()!.players[1].letters, 1);
  assert.deepEqual([o.state()!.turn, o.state()!.leader], [0, 0]);
});

test("the leader's miss passes the turn, and the ball with it", () => {
  const o = playing();
  o.shoot('t1', 8, false, 1.5);
  o.wait(1500 + HAND_AFTER);
  assert.deepEqual([o.state()!.turn, o.state()!.leader, o.state()!.spot], [1, 1, null]);
  assert.equal(o.court.state().holder, 'g1');
  assert.equal(o.shoot('g1', 9, true), null, 'the new leader shoots from anywhere');
});

test('spelling PIG ends it: the floor hears who won, the win is tallied, the ball is anyone’s, and the board goes back after a while', () => {
  const o = playing();
  for (let i = 0; i < 3; i++) {
    o.shoot('t1', 5, true);
    o.wait(1000 + HAND_AFTER);
    o.shoot('g1', 5, false);
    o.wait(1000 + HAND_AFTER);
  }
  const g = o.state()!;
  assert.equal(g.winner, 0);
  assert.equal(g.end, 'pig');
  assert.equal(o.toasts.at(-1), '🐷 Gavin spelled PIG — Tyler wins');
  assert.deepEqual(o.won, ['Tyler']);
  assert.equal(o.court.state().for, undefined);
  o.wait(SHOW_END);
  assert.equal(o.state(), null);
  assert.equal(o.sent.at(-1)!.pig, null);
});

test('walking off the court, leaving the floor or dropping out forfeits after a grace; coming back in time doesn’t', () => {
  const o = playing();
  o.stand('g1', AWAY_REACH + 2);
  o.wait(AWAY_GRACE - 2000);
  o.stand('g1', 5);
  o.wait(3000);
  assert.equal(o.state()!.winner, null, 'back in time');
  o.stand('g1', AWAY_REACH + 2);
  o.wait(AWAY_GRACE + 1500);
  assert.equal(o.state()!.winner, 0);
  assert.equal(o.state()!.end, 'forfeit');
  assert.match(o.toasts.at(-1)!, /Gavin walked off the court — Tyler wins/);

  const p = playing();
  p.stand('t1', 4, 'another floor');
  p.wait(AWAY_GRACE + 1500);
  assert.match(p.toasts.at(-1)!, /Tyler left the floor — Gavin wins/);

  const q = playing();
  q.where.delete('g1');
  q.wait(AWAY_GRACE + 1500);
  assert.match(q.toasts.at(-1)!, /Gavin dropped out — Tyler wins/);
  assert.deepEqual(q.won, ['Tyler']);
});

test('dropping out and coming back on a new connection carries on the game as the same player', () => {
  const o = playing();
  o.where.delete('t1');
  o.wait(3000);
  o.stand('t2', 4);
  o.wait(1500);
  const g = o.state()!;
  assert.equal(g.winner, null);
  assert.equal(g.players[0].id, 't2');
  assert.equal(o.court.state().for, 't2', "it's still their turn, and the ball is theirs again");
  assert.equal(o.shoot('t2', 7, true), null);
});

test('giving up is a forfeit, at once', () => {
  const o = playing();
  o.games.quit('g1');
  assert.equal(o.state()!.winner, 0);
  assert.match(o.toasts.at(-1)!, /Gavin gave up — Tyler wins/);
});

test("the court: a ball held for someone is theirs alone to pick up, and handed to them wherever it was", () => {
  let now = 0;
  const c = new Court(() => now);
  c.take('a');
  now += 1000;
  c.throw('a', { x: 0, y: 1, z: 0, vx: 1, vy: 1, vz: 0 });
  assert.ok(c.reserve('b'));
  assert.ok(!c.reserve('b'), 'no change');
  now += 1000;
  assert.ok(!c.take('a'));
  assert.ok(c.take('b'));
  assert.deepEqual(c.state(), { holder: 'b', for: 'b' });
  c.reserve('');
  assert.ok(c.hand('a'));
  assert.deepEqual(c.state(), { holder: 'a', for: '' });
  c.reserve(undefined);
  assert.deepEqual(c.state(), { holder: 'a' });
});
