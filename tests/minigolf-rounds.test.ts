import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { streetBelow } from '../src/shared/layout.js';
import { HOLES } from '../src/shared/minigolf/course.js';
import { heightAt, roll, teeBall } from '../src/shared/minigolf/physics.js';
import { within } from '../src/shared/minigolf/surface.js';
import type { Hole } from '../src/shared/minigolf/types.js';
import { PUTT_RULES, type PuttBall, type PuttServerMsg } from '../src/shared/protocol.js';
import { PuttRecords } from '../src/server/minigolf/records.js';
import { DEFAULT_LEAD, OVER_FOR, PuttRounds, strikeAt, wrap, type PuttWho } from '../src/server/minigolf/rounds.js';
import { puttHandlers, puttHooks, puttView } from '../src/server/ws/handlers/minigolf.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';

// Putt Street's rounds as the office referees them (server/minigolf/): groups and turns, the cap and
// the pick-up, groups waiting for the one ahead, penalties and club-length moves, the clamp on when a
// putt is struck, the records in minigolf.json, and the handler on a made-up office.

const tyler: PuttWho = { id: 't1', name: 'Tyler', color: '#09ca59' };
const gavin: PuttWho = { id: 'g1', name: 'Gavin', color: '#4f86f7' };
const ada: PuttWho = { id: 'a1', name: 'Ada', color: '#ff8800' };

/**
 * A plain hole for the rounds: a lane 2 m wide and 6 m long, teed up 4 m from the cup, kerbs at either
 * end, the felt's edge open to the west (off the felt) and water to the east, and a patch nobody can
 * stand on a meter and a half up from the tee.
 */
function lane(n: number): Hole {
  const z = 10 * n;
  const p = (x: number, dz: number) => ({ x, z: z + dz });
  return {
    n,
    name: `Lane ${n}`,
    par: 2,
    cell: p(0, 3),
    tee: p(0, 0.5),
    cup: p(0, 4.5),
    felt: [{ poly: [p(-1, 0), p(1, 0), p(1, 6), p(-1, 6)], h: 0.04 }],
    walls: [
      { pts: [p(-1, 0), p(1, 0)], height: 0.15 },
      { pts: [p(-1, 6), p(1, 6)], height: 0.15 },
    ],
    water: [{ poly: [p(1, 0), p(3, 0), p(3, 6), p(1, 6)], h: 0 }],
    keepOff: [[p(-1, 1.5), p(1, 1.5), p(1, 2.5), p(-1, 2.5)]],
  };
}
const LANES = Array.from({ length: 9 }, (_, i) => lane(i + 1));

/** The power that drops a putt from `ball` straight at the cup (the middle of the window that does). */
function holing(hole: Hole, ball: PuttBall): number {
  const yaw = Math.atan2(hole.cup.x - ball.x, hole.cup.z - ball.z);
  const ok: number[] = [];
  for (let p = 0; p <= 1; p += 0.002) if (roll(hole, { from: ball, yaw, power: p, startAt: 0 }).holed) ok.push(p);
  assert.ok(ok.length, 'some power drops it');
  return ok[Math.floor(ok.length / 2)];
}
const ACE = holing(LANES[0], teeBall(LANES[0]));
/** A putt that stops in the patch nobody can stand on. */
const INTO_PATCH = (() => {
  for (let p = 0; p <= 1; p += 0.002) {
    const r = roll(LANES[0], { from: teeBall(LANES[0]), yaw: 0, power: p, startAt: 0 });
    if (r.moved) return p;
  }
  throw new Error('no putt stops in the patch');
})();

/** The office's clock and timers, run by hand. */
class Clock {
  t = 1_000_000;
  private timers: { at: number; fn: () => void }[] = [];
  now = () => this.t;
  later = (ms: number, fn: () => void) => {
    const timer = { at: this.t + ms, fn };
    this.timers.push(timer);
    return () => void (this.timers = this.timers.filter((x) => x !== timer));
  };
  /** On by `ms`, running whatever comes due on the way, in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

/** A course on a made-up office: its messages, toasts, records and where everyone stands. */
function course(holes: readonly Hole[] = LANES) {
  const dir = mkdtempSync(path.join(tmpdir(), 'putt-'));
  const clock = new Clock();
  const sent: PuttServerMsg[] = [];
  const told: { id: string; text: string }[] = [];
  const toasts: string[] = [];
  /** Where each player stands; by their own ball unless a test says otherwise. */
  const spots = new Map<string, { x: number; h: number; z: number } | null>();
  const records = new PuttRecords(dir, clock.now);
  const rounds: PuttRounds = new PuttRounds({
    now: clock.now,
    later: clock.later,
    broadcast: (m) => sent.push(m),
    tell: (id, text) => told.push({ id, text }),
    toastAll: (text) => toasts.push(text),
    where: (id) => {
      if (spots.has(id)) return spots.get(id)!;
      const ball = rounds.rounds().flatMap((r) => r.players).find((p) => p.id === id)?.ball;
      return ball ? { x: ball.x + 0.4, h: 0, z: ball.z } : null;
    },
    records,
    holes,
  });
  const last = <T extends PuttServerMsg['t']>(t: T) => sent.filter((m) => m.t === t).at(-1) as Extract<PuttServerMsg, { t: T }> | undefined;
  const round = () => rounds.rounds()[0];
  const ballOf = (who: PuttWho) => rounds.rounds().flatMap((r) => r.players).find((p) => p.id === who.id)!.ball!;
  /** `who` putts at the cup with `power` (or the yaw given), and the ball's left to stop. */
  const putt = (who: PuttWho, power: number, yaw?: number) => {
    const r = rounds.rounds().find((g) => g.players.some((p) => p.id === who.id))!;
    const ball = ballOf(who);
    const hole = holes[r.hole];
    const said = rounds.stroke(who, r.id, yaw ?? Math.atan2(hole.cup.x - ball.x, hole.cup.z - ball.z), power, clock.t + 90);
    clock.advance(25_000);
    return said;
  };
  return { dir, clock, sent, told, toasts, spots, records, rounds, last, round, ballOf, putt, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a group forms at the putter rack and tees off when its starter says, or when forming time is up', () => {
  const c = course();
  assert.equal(c.rounds.play(tyler), undefined);
  assert.equal(c.rounds.play(gavin), undefined);
  assert.match(c.rounds.play(tyler)!, /already in a round/);
  const r = c.round();
  assert.equal(c.rounds.rounds().length, 1, 'Gavin joined the group forming, not a new one');
  assert.deepEqual([r.stage, r.starter, r.players.map((p) => p.name)], ['forming', 't1', ['Tyler', 'Gavin']]);
  assert.equal(r.until, c.clock.t + PUTT_RULES.formS * 1000);
  assert.match(c.rounds.start(gavin.id, r.id)!, /Only whoever started/);
  assert.equal(c.rounds.start(tyler.id, r.id), undefined);
  assert.deepEqual([r.stage, r.hole, r.turn], ['playing', 0, 0]);
  assert.deepEqual(r.players[0].ball, teeBall(LANES[0]), "the first player's ball is teed up");
  assert.equal(r.players[1].ball, null);
  assert.equal(c.last('putt')!.rounds[0].stage, 'playing', 'and everyone hears');
  // Up to four a group; a fifth starts another, which tees off by itself after forming time.
  const more = course();
  for (const w of [tyler, gavin, ada, { ...ada, id: 'a2' }, { ...ada, id: 'a3', name: 'Five' }]) more.rounds.play(w);
  assert.deepEqual(
    more.rounds.rounds().map((g) => g.players.length),
    [4, 1],
  );
  more.clock.advance(PUTT_RULES.formS * 1000);
  assert.ok(more.rounds.rounds().every((g) => g.stage === 'playing'));
  c.done();
  more.done();
});

test('turns go player by player, hole by hole; out of turn, mid-roll or too soon is ignored', () => {
  const c = course();
  c.rounds.play(tyler);
  c.rounds.play(gavin);
  const r = c.round();
  c.rounds.start(tyler.id, r.id);
  // Gavin can't putt on Tyler's turn.
  assert.equal(c.rounds.stroke(gavin, r.id, 0, 0.5, c.clock.t), undefined);
  assert.equal(c.last('putt.rolled'), undefined);
  // Tyler's first putt is short; nothing else goes while it rolls.
  assert.equal(c.rounds.stroke(tyler, r.id, 0, 0, c.clock.t + 90), undefined);
  const first = c.last('putt.rolled')!;
  assert.deepEqual([first.id, first.hole, first.taken, first.holed], ['t1', 0, 1, false]);
  assert.ok(r.rolling! > c.clock.t);
  c.rounds.stroke(tyler, r.id, 0, 0.5, c.clock.t + 90);
  assert.equal(c.sent.filter((m) => m.t === 'putt.rolled').length, 1, 'mid-roll is ignored');
  c.clock.advance(5000);
  assert.equal(r.rolling, undefined);
  assert.deepEqual(r.players[0].ball, first.rest, 'played from where it stopped');
  assert.deepEqual([r.turn, r.players[0].taken], [0, 1], 'still his turn');
  // Too soon after his last putt (PUTT_RULES.everyMs) is ignored too.
  c.clock.t -= 4600;
  c.rounds.stroke(tyler, r.id, 0, 0.5, c.clock.t + 90);
  assert.equal(c.sent.filter((m) => m.t === 'putt.rolled').length, 1);
  c.clock.t += 4600;
  // He holes out in two; then it's Gavin's turn, teed up.
  c.putt(tyler, holing(LANES[0], c.ballOf(tyler)));
  assert.deepEqual([r.players[0].strokes[0], r.players[0].ball, r.turn], [2, null, 1]);
  assert.deepEqual(r.players[1].ball, teeBall(LANES[0]));
  // Gavin aces it: on to hole 2, Tyler first.
  c.putt(gavin, ACE);
  assert.deepEqual([r.players[1].strokes[0], r.hole, r.turn], [1, 1, 0]);
  assert.deepEqual(r.players[0].ball, teeBall(LANES[1]));
  assert.equal(r.players[0].taken, 0);
  c.done();
});

test('six strokes and you are picked up, at seven', () => {
  const c = course();
  c.rounds.play(tyler);
  c.rounds.play(gavin);
  c.rounds.start(tyler.id, c.round().id);
  for (let i = 0; i < PUTT_RULES.strokes; i++) c.putt(tyler, 0);
  const r = c.round();
  assert.deepEqual([r.players[0].strokes[0], r.players[0].ball, r.turn], [PUTT_RULES.picked, null, 1]);
  c.done();
});

test('a turn left a minute is picked up at seven, with a warning at 45 s; it keeps counting from each putt', () => {
  const c = course();
  c.rounds.play(tyler);
  c.rounds.play(gavin);
  const r = c.round();
  c.rounds.start(tyler.id, r.id);
  assert.equal(r.until, c.clock.t + PUTT_RULES.idleS * 1000);
  c.clock.advance(PUTT_RULES.warnS * 1000 - 1);
  assert.equal(c.told.length, 0);
  c.clock.advance(1);
  assert.deepEqual(c.told, [{ id: 't1', text: '⛳ Your turn on hole 1: putt in the next 15 s' }]);
  c.clock.advance((PUTT_RULES.idleS - PUTT_RULES.warnS) * 1000);
  assert.deepEqual([r.players[0].strokes[0], r.turn], [PUTT_RULES.picked, 1], 'picked up, and Gavin is up');
  // A putt starts the clock again.
  c.clock.advance(50_000);
  c.putt(gavin, 0);
  assert.equal(r.players[1].strokes[0], null, 'not picked up: his putt started a fresh minute');
  assert.ok(r.until > c.clock.t);
  c.done();
});

test("a group waits to start a hole while an earlier group still has balls on it, and its clock doesn't run", () => {
  const c = course();
  c.rounds.play(tyler);
  const a = c.round();
  c.rounds.start(tyler.id, a.id);
  c.rounds.play(gavin);
  const b = c.rounds.rounds()[1];
  c.rounds.start(gavin.id, b.id);
  assert.deepEqual([b.stage, b.hole, b.waiting, b.until], ['playing', 0, true, 0]);
  assert.equal(c.rounds.stroke(gavin, b.id, 0, ACE, c.clock.t + 90), undefined);
  assert.equal(c.last('putt.rolled'), undefined, "Gavin's putt waits for the group ahead");
  c.clock.advance(55_000);
  c.putt(tyler, 0);
  c.clock.advance(30_000);
  assert.equal(b.players[0].strokes[0], null, 'nobody is picked up while waiting');
  // Tyler holes out: hole 1's clear, and Gavin's group goes.
  c.putt(tyler, holing(LANES[0], c.ballOf(tyler)));
  assert.equal(a.hole, 1);
  assert.equal(b.waiting, undefined);
  assert.equal(b.until - b.since, PUTT_RULES.idleS * 1000, 'its clock runs from when the hole came free');
  assert.equal(c.putt(gavin, ACE), undefined);
  assert.equal(b.players[0].strokes[0], 1);
  // Now Gavin's group is on hole 2 while Tyler's is still there: a later group never holds up an earlier one.
  assert.equal(a.waiting, undefined);
  c.done();
});

test('water and the felt edge cost a stroke and put the ball back; a ball where nobody can stand is moved a club length', () => {
  const c = course();
  c.rounds.play(tyler);
  const r = c.round();
  c.rounds.start(tyler.id, r.id);
  const tee = teeBall(LANES[0]);
  c.putt(tyler, 0.6, Math.PI / 2);
  const wet = c.sent.filter((m) => m.t === 'putt.rolled').at(-1) as Extract<PuttServerMsg, { t: 'putt.rolled' }>;
  assert.deepEqual([wet.out, wet.taken, wet.rest], ['water', 2, tee]);
  assert.ok(wet.events.some(([, e]) => e === 'splash'));
  assert.deepEqual([r.players[0].ball, r.players[0].taken], [tee, 2]);
  c.putt(tyler, 0.6, -Math.PI / 2);
  const off = c.last('putt.rolled')!;
  assert.deepEqual([off.out, off.taken, off.rest], ['off', 4, tee]);
  c.putt(tyler, INTO_PATCH, 0);
  const moved = c.last('putt.rolled')!;
  assert.equal(moved.moved, true);
  assert.equal(moved.taken, 5);
  assert.ok(!LANES[0].keepOff!.some((k) => within(k, moved.rest.x, moved.rest.z)));
  assert.notEqual(heightAt(LANES[0], moved.rest.x, moved.rest.z), null);
  assert.deepEqual(r.players[0].ball, moved.rest, 'played from where it was moved to');
  // A penalty that takes it to the cap picks it up.
  c.putt(tyler, 0.6, Math.PI / 2);
  assert.equal(r.players[0].strokes[0], PUTT_RULES.picked);
  c.done();
});

test('a putt is struck no sooner than 20 ms and no later than 150 ms after the office hears it, whatever the page says', () => {
  const now = 5_000_000;
  assert.equal(strikeAt(now - 60_000, now), now + PUTT_RULES.minLeadMs);
  assert.equal(strikeAt(now + 60_000, now), now + PUTT_RULES.leadMs);
  assert.equal(strikeAt(now + 60, now), now + 60);
  assert.equal(strikeAt(NaN, now), now + DEFAULT_LEAD);
  assert.equal(strikeAt(Infinity, now), now + DEFAULT_LEAD);
  // Through the rounds: never in the past, never more than 150 ms ahead.
  const c = course();
  c.rounds.play(tyler);
  c.rounds.start(tyler.id, c.round().id);
  for (const at of [c.clock.t - 1e9, c.clock.t + 1e9, -Infinity, c.clock.t + 100, 0]) {
    const heard = c.clock.t;
    c.rounds.stroke(tyler, c.round().id, 0, 0, at);
    const rolled = c.last('putt.rolled')!;
    assert.ok(rolled.startAt >= heard + PUTT_RULES.minLeadMs && rolled.startAt <= heard + PUTT_RULES.leadMs, `at ${at}: struck ${rolled.startAt - heard} ms on`);
    c.clock.advance(5000);
  }
  // A swing that makes no sense isn't rolled at all; a wild one is brought into range.
  const before = c.sent.filter((m) => m.t === 'putt.rolled').length;
  c.rounds.stroke(tyler, c.round().id, NaN, 0.5, c.clock.t);
  c.rounds.stroke(tyler, c.round().id, 0, Infinity, c.clock.t);
  assert.equal(c.sent.filter((m) => m.t === 'putt.rolled').length, before);
  c.rounds.stroke(tyler, c.round().id, 7 * Math.PI, 40, c.clock.t);
  assert.equal(c.last('putt.rolled')!.power, 1);
  assert.ok(Math.abs(wrap(7 * Math.PI)) <= Math.PI);
  assert.ok(Math.abs(wrap(-7 * Math.PI) - wrap(7 * Math.PI)) < 1e-9);
  c.done();
});

test('you putt from beside your ball, whichever floor you are on', () => {
  const c = course();
  c.rounds.play(tyler);
  const r = c.round();
  c.rounds.start(tyler.id, r.id);
  const tee = teeBall(LANES[0]);
  c.spots.set(tyler.id, { x: tee.x + 6, h: 0, z: tee.z });
  assert.equal(c.rounds.stroke(tyler, r.id, 0, 0.3, c.clock.t), '⛳ Walk up to your ball first');
  c.spots.set(tyler.id, null);
  assert.equal(c.rounds.stroke(tyler, r.id, 0, 0.3, c.clock.t), '⛳ Walk up to your ball first');
  c.spots.set(tyler.id, { x: tee.x, h: 3.6, z: tee.z + 1 });
  assert.equal(c.rounds.stroke(tyler, r.id, 0, 0.3, c.clock.t), '⛳ Walk up to your ball first', 'not from a balcony over it');
  assert.equal(c.last('putt.rolled'), undefined);
  c.spots.set(tyler.id, { x: tee.x + 1.5, h: 0.2, z: tee.z - 1 });
  assert.equal(c.rounds.stroke(tyler, r.id, 0, 0.3, c.clock.t), undefined);
  assert.ok(c.last('putt.rolled'));
  c.done();
});

test('nine holes and the round is over: the record (a tie keeps the first), the best on each hole, holes in one and the card go on the records', () => {
  const c = course();
  c.rounds.play(tyler);
  const r = c.round();
  c.rounds.start(tyler.id, r.id);
  for (let h = 0; h < 9; h++) c.putt(tyler, ACE);
  assert.equal(r.stage, 'over');
  assert.deepEqual(r.players[0].strokes, Array(9).fill(1));
  const board = c.records.board();
  assert.deepEqual(board.record && [board.record.total, board.record.name], [9, 'Tyler']);
  assert.deepEqual(
    board.best.map((b) => b && [b.strokes, b.name]),
    Array(9).fill([1, 'Tyler']),
  );
  assert.equal(board.aces.length, 9);
  assert.deepEqual(board.aces[0], { name: 'Tyler', hole: 8, at: board.aces[0].at }, 'newest first');
  assert.deepEqual(
    board.rounds.map((x) => [x.names, x.totals]),
    [[['Tyler'], [9]]],
  );
  assert.ok(c.toasts.includes('⛳ Hole in one! Tyler aced hole 1'));
  assert.ok(c.toasts.includes('⛳ Tyler set the Putt Street record: 9'));
  const news = c.sent.filter((m) => m.t === 'putt.board') as Extract<PuttServerMsg, { t: 'putt.board' }>[];
  assert.deepEqual(news.at(-1)!.latest, { name: 'Tyler', what: 'record', total: 9 });
  assert.ok(news.some((m) => m.latest?.what === 'ace' && m.latest.hole === 0));
  // It stays up a minute, then goes.
  assert.equal(r.until - r.since, OVER_FOR);
  c.clock.advance(r.until - c.clock.t - 1);
  assert.equal(c.rounds.rounds().length, 1);
  c.clock.advance(1);
  assert.equal(c.rounds.rounds().length, 0);
  assert.equal((c.rounds as unknown as { struck: Map<string, number> }).struck.size, 0, 'nor is when he last putted kept');
  // Gavin ties it later: the record, and each hole's best, stay Tyler's.
  c.rounds.play(gavin);
  c.rounds.start(gavin.id, c.round().id);
  for (let h = 0; h < 9; h++) c.putt(gavin, ACE);
  assert.equal(c.records.board().record!.name, 'Tyler');
  assert.ok(c.records.board().best.every((b) => b!.name === 'Tyler'));
  const last = c.last('putt.board')!;
  assert.equal(last.latest, undefined, 'no news, but everyone gets the new last rounds');
  assert.equal(last.board.rounds.length, 2);
  assert.equal(c.records.board().rounds.length, 2);
  assert.equal(c.records.board().aces.length, 18);
  c.done();
});

test('leaving: the turn passes on, the starter hands over, and an empty round goes', () => {
  const c = course();
  for (const w of [tyler, gavin, ada]) c.rounds.play(w);
  const r = c.round();
  c.rounds.quit(tyler.id, r.id);
  assert.equal(r.starter, 'g1', 'the next one in starts it');
  c.rounds.start(gavin.id, r.id);
  assert.deepEqual([r.turn, r.players[r.turn].id], [0, 'g1']);
  // Gavin leaves mid-putt: Ada's up, and his roll doesn't count for anyone.
  c.rounds.stroke(gavin, r.id, 0, 0.3, c.clock.t);
  c.rounds.quit(gavin.id);
  assert.deepEqual([r.turn, r.players.map((p) => p.id), r.rolling], [0, ['a1'], undefined]);
  assert.deepEqual(r.players[0].ball, teeBall(LANES[0]));
  c.clock.advance(10_000);
  assert.equal(r.players[0].taken, 0);
  c.rounds.quit(ada.id, r.id);
  assert.deepEqual(c.rounds.rounds(), []);
  assert.deepEqual(c.last('putt')!.rounds, []);
  c.done();
});

test('minigolf.json is written whole and read back; a corrupt one is logged, set aside and started afresh; a bad entry is dropped', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'putt-records-'));
  const file = path.join(dir, 'minigolf.json');
  let now = 1_700_000_000_000;
  const errors = t.mock.method(console, 'error', () => {});
  const a = new PuttRecords(dir, () => now);
  assert.deepEqual(a.holedOut('Tyler', 3, 2), { best: true, ace: false });
  assert.deepEqual(a.holedOut('Gavin', 3, 2), { best: false, ace: false }, 'a tie keeps the first');
  assert.deepEqual(a.holedOut('Ada', 3, 1), { best: true, ace: true });
  assert.deepEqual(a.roundOver([{ name: 'Tyler', total: 30 }, { name: 'Ada', total: 28 }]), { kept: true, record: { total: 28, name: 'Ada', at: now } });
  assert.deepEqual(a.roundOver([{ name: 'Gavin', total: 28 }]), { kept: true }, 'a tie keeps the record that was there');
  assert.deepEqual(a.roundOver([]), { kept: false });
  assert.deepEqual(new PuttRecords(dir).board(), a.board(), 'read back the same');
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no half-written file left');
  assert.equal(errors.mock.callCount(), 0);
  // A file that won't read: logged, set aside on the first save, and nothing of it kept.
  writeFileSync(file, '{"record": {"total": 2');
  const b = new PuttRecords(dir, () => now);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0].arguments[0]), /minigolf\.json/);
  assert.equal(b.board().record, null);
  now += 1;
  b.holedOut('Tyler', 0, 3);
  assert.equal(readFileSync(path.join(dir, `minigolf.json.corrupt-${now}`), 'utf8'), '{"record": {"total": 2', 'set aside, not written over');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).best[0].name, 'Tyler');
  // Not an object at all counts as corrupt too.
  writeFileSync(file, '[1, 2, 3]');
  new PuttRecords(dir, () => now).holedOut('Ada', 1, 2);
  assert.ok(readdirSync(dir).filter((f) => f.startsWith('minigolf.json.corrupt-')).length >= 1);
  // A bad entry in a good file is dropped, and the rest kept.
  writeFileSync(file, JSON.stringify({ record: { total: 'lots', name: 'X', at: 1 }, best: [{ strokes: 2, name: 'Gavin', at: 5 }, { strokes: 0, name: '', at: 1 }], aces: [{ name: 'Ada', hole: 4, at: 9 }, { name: 'Bad', hole: 12, at: 9 }], rounds: [{ names: ['Ada'], totals: [27], at: 3 }, { names: ['A', 'B'], totals: [30], at: 3 }] }));
  const c = new PuttRecords(dir);
  assert.equal(c.board().record, null);
  assert.deepEqual(c.board().best[0], { strokes: 2, name: 'Gavin', at: 5 });
  assert.equal(c.board().best[1], null);
  assert.deepEqual(c.board().aces, [{ name: 'Ada', hole: 4, at: 9 }]);
  assert.deepEqual(c.board().rounds, [{ names: ['Ada'], totals: [27], at: 3 }]);
  assert.match(String(errors.mock.calls.at(-1)!.arguments[0]), /dropped/);
  rmSync(dir, { recursive: true, force: true });
});

test('the handler: anyone at street level on any floor plays, the office rolls their putt for everyone, and leaving takes them out', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'putt-ctx-'));
  const sent: { to: string | 'all'; msg: unknown }[] = [];
  const clients = new Map<string, Client>();
  const ctx = {
    cfg: { dataDir: dir },
    clients,
    floors: new Map([
      ['f0', {}],
      ['f1', {}],
    ]),
    broadcast: (msg: unknown) => sent.push({ to: 'all', msg }),
    sendTo: (c: Client, msg: unknown) => sent.push({ to: c.id, msg }),
    warn: (c: Client, text: string | undefined) => text && sent.push({ to: c.id, msg: { t: 'toast', text, level: 'warn' } }),
    toastAll: (text: string) => sent.push({ to: 'all', msg: { t: 'toast', text, level: 'info' } }),
  } as unknown as Ctx;
  const tee = teeBall(HOLES[0]);
  const client = (id: string, name: string, floor: string | undefined, at: { x: number; y: number; z: number }) => {
    const c = { id, out: false, throttles: new Map(), peer: { id, name, color: '#123456', floor, ...at } } as unknown as Client;
    clients.set(id, c);
    return c;
  };
  // Tyler is on the floor above the bottom one, down on the street by hole 1's tee.
  const t1 = client('t1', 'Tyler', 'f1', { x: tee.x + 0.45, y: streetBelow(1), z: tee.z });
  const up = client('u1', 'Roofie', 'roof', { x: 0, y: 0, z: 0 });
  const H = puttHandlers as unknown as Record<string, (ctx: Ctx, c: Client, msg: unknown) => void>;
  H['putt.play'](ctx, up, { t: 'putt.play' });
  assert.deepEqual(sent.at(-1), { to: 'u1', msg: { t: 'toast', text: '⛳ Come down to Putt Street to play', level: 'warn' } });
  H['putt.play'](ctx, t1, { t: 'putt.play', name: 'Someone Else', color: '#000000' });
  const view = puttView(ctx, undefined);
  assert.equal(view.rounds.length, 1);
  assert.deepEqual([view.rounds[0].players[0].name, view.rounds[0].players[0].color], ['Tyler', '#123456'], "the session's name and colour, not the message's");
  const id = view.rounds[0].id;
  H['putt.start'](ctx, t1, { t: 'putt.start', round: id });
  H['putt.stroke'](ctx, t1, { t: 'putt.stroke', round: id, yaw: 0, power: 0.55, at: 'soon' });
  const rolled = sent.map((s) => s.msg as PuttServerMsg).find((m) => m.t === 'putt.rolled') as Extract<PuttServerMsg, { t: 'putt.rolled' }>;
  assert.ok(rolled, 'everyone is told how it rolled');
  assert.equal(rolled.holed, true, "the first hole's known ace");
  assert.ok(sent.some((s) => s.to === 'all' && (s.msg as PuttServerMsg).t === 'putt.rolled'));
  // Gone from the office: out of the round, which goes.
  clients.delete('t1');
  puttHooks.closed!(ctx, t1);
  assert.deepEqual(puttView(ctx, undefined).rounds, []);
  rmSync(dir, { recursive: true, force: true });
});
