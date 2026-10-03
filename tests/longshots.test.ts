import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FARTHEST, SHOTS_KEPT, inFeet, ordinal, rankShot, rimDistance, shotDistance, tallyWin, type LongShot, type Owned } from '../src/shared/longshots.js';
import { HOOP, SWEET, idealSpeed, lookAtRim, shotSpeed, throwPitch, underCeiling } from '../src/shared/hoop.js';
import { BALCONY, FLOOR } from '../src/shared/layout.js';
import { DEFAULT_FURNITURE } from '../src/shared/furniture.js';
import { roomOf } from '../src/shared/floorplan.js';
import { LongShots, RECORD_EVERY } from '../src/server/longshots.js';
import { creditedDistance, flyShot, floorSolids, hasHoop, isDrop, STAND_SLACK } from '../src/server/shot-judge.js';

// The longest shots sunk at the hoop: the distance maths, the table (one best a person, the top ten),
// the office's own flight of a throw, its check of a throw against where the thrower stood, and the
// table on disk.

const folder = (t: TestContext) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-hoop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const shot = (owner: string, dist: number, at = 0): Owned<LongShot> => ({ owner, name: owner, color: '#09ca59', dist, at });
const room = { furniture: DEFAULT_FURNITURE, room: roomOf(undefined) };

/** A throw from `dist` m straight out from the rim, let go of at `power` on the meter, from `y` up. */
function throwFrom(dist: number, power = SWEET.at, y = 1.4) {
  const from = { x: HOOP.rim.x + dist, y, z: HOOP.z };
  const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
  const v = shotSpeed(idealSpeed(from, pitch)!, power);
  return { ...from, vx: -v * Math.cos(pitch), vy: v * Math.sin(pitch), vz: 0 };
}

test('a shot is measured along the floor, from where it left the hand to the middle of the ring, to a tenth', () => {
  assert.equal(rimDistance({ x: HOOP.rim.x + 3, z: HOOP.rim.z + 4 }), 5);
  assert.equal(shotDistance({ x: HOOP.rim.x + 9.36, z: HOOP.rim.z }), 9.4);
  assert.equal(shotDistance({ x: HOOP.rim.x + 9.34, z: HOOP.rim.z }), 9.3);
  // Height doesn't come into it.
  assert.equal(shotDistance({ x: HOOP.rim.x - 0, z: HOOP.rim.z + 2 }), 2);
  assert.equal(inFeet(9.4), 31);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
});

test('nothing on the table is further out than anyone can stand: the far corner of the floor', () => {
  const corners = [FLOOR, BALCONY].flatMap((r) => [rimDistance({ x: r.maxX, z: r.minZ }), rimDistance({ x: r.maxX, z: r.maxZ })]);
  assert.equal(FARTHEST, Math.max(...corners));
  assert.ok(FARTHEST > 35 && FARTHEST < 45, `${FARTHEST}`);
});

test('the table: longest first, one best a person, the top ten, and a tie goes to whoever sank it first', () => {
  let table: Owned<LongShot>[] = [];
  const put = (s: Owned<LongShot>) => {
    const r = rankShot(table, s);
    table = r.table;
    return r.rank;
  };
  assert.equal(put(shot('ada', 5)), 1);
  assert.equal(put(shot('bo', 7)), 1);
  assert.equal(put(shot('cy', 6)), 2);
  // Ada again, shorter than her best: nothing changes. Longer: her one row moves up.
  assert.equal(put(shot('ada', 4.9)), 0);
  assert.equal(put(shot('ada', 5)), 0, 'the same length again is no better');
  assert.equal(put(shot('ada', 8)), 1);
  assert.deepEqual(
    table.map((s) => [s.owner, s.dist]),
    [
      ['ada', 8],
      ['bo', 7],
      ['cy', 6],
    ],
  );
  // A tie: the one sunk first stays ahead.
  assert.equal(put(shot('di', 7, 10)), 3);
  for (let i = 0; i < 20; i++) put(shot(`p${i}`, 1 + i * 0.1, 20 + i));
  assert.equal(table.length, SHOTS_KEPT);
  assert.equal(new Set(table.map((s) => s.owner)).size, SHOTS_KEPT, 'one row a person');
  assert.deepEqual(
    table.map((s) => s.dist),
    [...table.map((s) => s.dist)].sort((a, b) => b - a),
  );
  // Too short for the top ten: not on it.
  assert.equal(put(shot('ed', 0.5)), 0);
  assert.ok(!table.some((s) => s.owner === 'ed'));
});

test('the PIG tally: a row a person, most wins first, and whoever got there first stays ahead', () => {
  let t: Owned<{ name: string; color: string; wins: number }>[] = [];
  const win = (owner: string) => (t = tallyWin(t, { owner, name: owner, color: '#09ca59' }));
  win('ada');
  win('bo');
  win('bo');
  win('ada');
  assert.deepEqual(
    t.map((r) => [r.owner, r.wins]),
    [
      ['bo', 2],
      ['ada', 2],
    ],
  );
  win('ada');
  assert.deepEqual(
    t.map((r) => [r.owner, r.wins]),
    [
      ['ada', 3],
      ['bo', 2],
    ],
  );
});

test("the office flies a throw itself: in from the sweet spot, out when it's let go of badly, and when it's over", () => {
  const solids = floorSolids(room);
  for (const dist of [2, 4.6, 6.75, 9]) {
    const f = flyShot(throwFrom(dist), solids);
    assert.ok(f.made, `made from ${dist} m`);
    assert.ok(f.at > 0.3 && f.at < 3, `in as it drops through, ${f.at.toFixed(2)} s after it left the hand`);
  }
  const miss = flyShot(throwFrom(6, 1), solids);
  assert.ok(!miss.made);
  assert.ok(miss.at > 0.5 && miss.at <= 5, `a miss is plain by its first bounce on the floor (${miss.at.toFixed(2)} s)`);
  // A drop isn't a shot.
  assert.ok(isDrop({ vx: 0.25, vy: 0, vz: 0 }) && !isDrop(throwFrom(4)));
  assert.ok(hasHoop(DEFAULT_FURNITURE));
  assert.ok(!hasHoop(DEFAULT_FURNITURE.filter((p) => p.kind !== 'hoop')));
});

test("a throw counts from where the office last saw its thrower stand, and no further out than that (and a step)", () => {
  const stand = { x: HOOP.rim.x + 8, y: 0, z: HOOP.z };
  const s = { x: stand.x - 0.3, y: 1.4, z: stand.z };
  assert.equal(creditedDistance(stand, s), 7.7);
  // Claiming to throw from further back than they stand: credited from where they stood (and half a step).
  assert.equal(creditedDistance(stand, { ...s, x: stand.x + 1 }), 8.5);
  // Too far from where they stood, or not from their hands (on the floor, or up in the air).
  assert.equal(creditedDistance(stand, { ...s, x: stand.x + STAND_SLACK + 0.1 }), null);
  assert.equal(creditedDistance(stand, { ...s, y: 0.2 }), null);
  assert.equal(creditedDistance(stand, { ...s, y: 4.5 }), null);
  assert.equal(creditedDistance({ ...stand, x: NaN }, s), null);
});

test('the table on disk: kept, read back after a restart, and a broken or doctored file is only what checks out', (t) => {
  const dir = folder(t);
  let now = 1_000_000;
  const table = new LongShots(dir, () => now);
  const ada = { owner: 'account:ada', name: 'Ada', color: '#ef476f' };
  const bo = { owner: 'name:Bo', name: 'Bo', color: 'not a color' };
  assert.deepEqual(table.record(ada, 6.2), { rank: 1, first: true });
  now += RECORD_EVERY;
  assert.deepEqual(table.record(bo, 4.1), { rank: 2, first: false });
  now += RECORD_EVERY;
  // Ada beating her own record is a new record too.
  assert.deepEqual(table.record(ada, 9.4), { rank: 1, first: true });
  table.win(bo);
  table.win(bo);
  table.win(ada);
  const board = table.board();
  assert.deepEqual(
    board.shots.map((s) => [s.name, s.dist]),
    [
      ['Ada', 9.4],
      ['Bo', 4.1],
    ],
  );
  assert.ok(!('owner' in board.shots[0]), 'nobody’s account goes out');
  assert.equal(board.shots[1].color, '#09ca59', 'a color that isn’t one is the board’s green');
  assert.deepEqual(
    board.wins.map((w) => [w.name, w.wins]),
    [
      ['Bo', 2],
      ['Ada', 1],
    ],
  );
  // After a restart.
  const again = new LongShots(dir, () => now);
  assert.deepEqual(again.board(), board);
  const file = path.join(dir, 'hoop.json');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  saved.shots.push({ owner: 'name:Cheat', name: 'Cheat', color: '#000000', dist: 400, at: 1 }, { owner: 'name:X', name: '', dist: 3, at: 1 }, { nonsense: true });
  saved.wins.push({ owner: 'name:Cheat', name: 'Cheat', wins: -5 }, { owner: 'name:Y', name: 'Y', wins: 1.5 });
  writeFileSync(file, JSON.stringify(saved));
  assert.deepEqual(new LongShots(dir, () => now).board(), board);
  writeFileSync(file, '{not json');
  assert.deepEqual(new LongShots(dir, () => now).board(), { shots: [], wins: [] });
});

test('the table changes at most so often for one person, and takes no make it can’t have been', (t) => {
  let now = 5_000_000;
  const table = new LongShots(folder(t), () => now);
  const ada = { owner: 'account:ada', name: 'Ada', color: '#ef476f' };
  assert.equal(table.record(ada, 3).rank, 1);
  now += 500;
  assert.equal(table.record(ada, 5).rank, 0, 'too soon after the last');
  now += RECORD_EVERY;
  assert.equal(table.record(ada, 5).rank, 1);
  now += RECORD_EVERY;
  // A make that doesn't better hers doesn't use up her turn.
  assert.equal(table.record(ada, 2).rank, 0);
  assert.equal(table.record({ ...ada, owner: 'account:bo', name: 'Bo' }, 4).rank, 2);
  for (const dist of [0, -3, NaN, Infinity, FARTHEST + 1]) {
    now += RECORD_EVERY;
    assert.equal(table.record({ ...ada, owner: `name:${dist}` }, dist).rank, 0, `${dist}`);
  }
});
