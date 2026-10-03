// A floor's own room (RoomOptions in shared/floorplan.ts): what a floor with no mezzanine (loft: false)
// changes for the builder's rules, for getting round the floor, for where there is to sit, and for
// how a floor keeps its layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { ROOM_DEFAULTS, cleanPlan, roomOf } from '../src/shared/floorplan.js';
import { DEFAULT_FURNITURE, floorSeat, type Piece } from '../src/shared/furniture.js';
import { LOFT, MEETING_ROOM, MEETING_TABLE, STAIRS } from '../src/shared/layout.js';
import { officeNav, setOfficeRoom, walkable } from '../src/shared/nav.js';
import { layoutProblems, mezzanineProblem, problemAt, validateLayout } from '../src/shared/office-builder.js';
import { FIXED, KEEP_CLEAR, LOFT_SEATS, fixedIn, hasLoft, keepClearIn } from '../src/shared/office-fixed.js';

const FLAT = { loft: false } as const;
const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
const withPiece = (p: Piece) => ({ desks: {}, furniture: [...defaults(), p] });
/** Halfway up where the stairs run, and on the floor at the foot of them. */
const ON_STAIRS = { x: (STAIRS.fromX + STAIRS.toX) / 2, z: (STAIRS.minZ + STAIRS.maxZ) / 2 };
const AT_FOOT = { x: STAIRS.fromX - 0.5, z: 12 };
const sofaOnStairs: Piece = { id: 'new', kind: 'sofa', x: 6, z: 12.25, rotY: 0 };

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-studio-room-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("what's built in goes by the room: the stairs and the loft's posts only on a floor with the mezzanine", () => {
  const names = (room?: { loft?: boolean }) => [...fixedIn(room).rects, ...fixedIn(room).circles, ...keepClearIn(room)].map((f) => f.what);
  // No room said, the office's own, and one that says so are all the office as it comes.
  assert.equal(fixedIn(), FIXED);
  assert.equal(fixedIn(ROOM_DEFAULTS), FIXED);
  assert.equal(fixedIn({ tees: 2 }), FIXED);
  assert.equal(keepClearIn({ loft: true }), KEEP_CLEAR);
  assert.ok(hasLoft() && hasLoft({}) && hasLoft(ROOM_DEFAULTS) && !hasLoft(FLAT));
  for (const what of ['the stairs', "one of the loft's posts", 'the foot of the stairs']) {
    assert.ok(names().includes(what), `${what} with the mezzanine`);
    assert.ok(!names(FLAT).includes(what), `no ${what} without it`);
  }
  // Nothing else goes with it: the meeting room under where the loft was stays, glass, door, table and chairs.
  const gone = new Set(['the stairs', "one of the loft's posts", 'the foot of the stairs']);
  assert.deepEqual(names(FLAT), names().filter((w) => !gone.has(w)));
  for (const what of ["the meeting room's glass", 'the meeting table', 'a meeting chair', "the meeting room's door", 'the elevator']) assert.ok(names(FLAT).includes(what), what);
});

test("furniture and desks can stand where the stairs were on a one-level floor, and can't on one with the mezzanine", () => {
  const sofa = withPiece(sofaOnStairs);
  assert.match(problemAt(sofa, 'new')!, /in the way of the stairs/);
  assert.match(problemAt(sofa, 'new', ROOM_DEFAULTS)!, /in the way of the stairs/);
  assert.equal(problemAt(sofa, 'new', FLAT), undefined);
  assert.match(layoutProblems(sofa).get('new')!, /the stairs/);
  assert.equal(layoutProblems(sofa, FLAT).size, 0);
  // In front of the bottom step, which is kept clear only while there's a step.
  const chair = withPiece({ id: 'new', kind: 'armchair', x: AT_FOOT.x, z: AT_FOOT.z, rotY: 0 });
  assert.match(problemAt(chair, 'new')!, /block the foot of the stairs/);
  assert.equal(problemAt(chair, 'new', FLAT), undefined);
  // A worker's desk, the same.
  const desk = { desks: { 'desk-1': { x: 6, z: 11.5, rotY: Math.PI } }, furniture: defaults() };
  assert.match(problemAt(desk, 'desk-1')!, /the stairs/);
  assert.equal(problemAt(desk, 'desk-1', FLAT), undefined);
  // The whole layout, as the office checks it before saving.
  assert.match(validateLayout({}, sofa.furniture) as string, /Sofa is in the way of the stairs/);
  assert.match(validateLayout({}, sofa.furniture, { loft: true }) as string, /the stairs/);
  assert.equal(typeof validateLayout({}, sofa.furniture, FLAT), 'object');
});

test('with no loft over it the meeting room is still there to keep off', () => {
  const at = (kind: Piece['kind'], x: number, z: number) => problemAt(withPiece({ id: 'new', kind, x, z, rotY: 0 }), 'new', FLAT);
  assert.match(at('armchair', MEETING_ROOM.minX, 10.5)!, /the meeting room's glass/);
  assert.match(at('armchair', MEETING_TABLE.x, MEETING_TABLE.z)!, /the meeting table/);
  assert.match(at('armchair', (MEETING_ROOM.door.x0 + MEETING_ROOM.door.x1) / 2, MEETING_ROOM.minZ - 0.5)!, /block the meeting room's door/);
  // Where the loft's corner post stood is the corner of the glass.
  assert.match(at('pouf', LOFT.minX + 0.15, LOFT.minZ + 0.15)!, /the meeting room's glass/);
});

test('bringing the mezzanine back says what stands in its way', () => {
  const sofa = withPiece(sofaOnStairs);
  assert.equal(mezzanineProblem(sofa), 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs');
  assert.equal(mezzanineProblem(sofa, FLAT), 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs');
  assert.equal(mezzanineProblem({ desks: {}, furniture: defaults() }), undefined);
  // What's wrong whatever the room isn't the mezzanine's doing.
  assert.equal(mezzanineProblem(withPiece({ id: 'new', kind: 'armchair', x: MEETING_TABLE.x, z: MEETING_TABLE.z, rotY: 0 })), undefined);
});

test('the way round the floor goes over where the stairs were only on a one-level floor', () => {
  const mezzanine = officeNav(0, undefined, DEFAULT_FURNITURE);
  const flat = officeNav(0, undefined, DEFAULT_FURNITURE, FLAT);
  assert.equal(mezzanine.walkable(ON_STAIRS.x, ON_STAIRS.z), false);
  assert.equal(officeNav(0, undefined, undefined, ROOM_DEFAULTS).walkable(ON_STAIRS.x, ON_STAIRS.z), false);
  assert.equal(flat.walkable(ON_STAIRS.x, ON_STAIRS.z), true);
  // Straight along the south wall, where it used to go round the foot of the stairs.
  const from: [number, number] = [STAIRS.fromX - 1, 12.25];
  const to: [number, number] = [STAIRS.toX - 0.75, 12.25];
  assert.equal(flat.clearLine(from, to), true);
  assert.deepEqual(flat.route(from, to), [from, to]);
  assert.notDeepEqual(mezzanine.route(from, to).at(-1), to, 'with the stairs there it stops short, at the nearest place to stand');
  // The meeting room's glass is in the way all the same, and its table.
  assert.equal(flat.walkable(MEETING_ROOM.minX, 10.5), false);
  assert.equal(flat.walkable(MEETING_TABLE.x, MEETING_TABLE.z), false);
  // Furniture stood where the stairs were is gone round like any other.
  assert.equal(officeNav(0, undefined, [...DEFAULT_FURNITURE, sofaOnStairs], FLAT).walkable(sofaOnStairs.x, sofaOnStairs.z), false);

  // A browser shows one floor: its grid follows the room it's told (see setOfficeRoom).
  assert.equal(walkable(ON_STAIRS.x, ON_STAIRS.z), false);
  try {
    setOfficeRoom(FLAT);
    assert.equal(walkable(ON_STAIRS.x, ON_STAIRS.z), true);
    assert.equal(walkable(ON_STAIRS.x, ON_STAIRS.z, 1), true, 'built out into the back office too');
  } finally {
    setOfficeRoom(ROOM_DEFAULTS);
  }
  assert.equal(walkable(ON_STAIRS.x, ON_STAIRS.z), false);
});

test("nobody sits up in the loft on a floor that hasn't one", () => {
  assert.deepEqual([...LOFT_SEATS].sort(), ['boss-chair', 'boss-guest-1', 'boss-guest-2', 'loft-couch']);
  for (const id of LOFT_SEATS) {
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id)?.id, id);
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id, ROOM_DEFAULTS)?.y, LOFT.y);
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id, FLAT), undefined, `${id} went with the loft`);
  }
  // The rest are where they were: the lounge's, the balcony's, the roof's.
  for (const id of ['couch', 'bench', 'stool-1', 'roof-sofa-1']) assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id, FLAT)?.id, id);
});

test('a floor saves its room with its layout, and is checked against the room it has', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    const free = () => false;
    const onStairs = [...defaults(), sofaOnStairs];
    assert.deepEqual(plan.layoutNow().room, ROOM_DEFAULTS);
    assert.equal(plan.seat('boss-chair')?.id, 'boss-chair');
    // With the mezzanine, nothing stands on its stairs.
    assert.match(plan.layout({ desks: {}, furniture: onStairs }, 0, free)!, /^Sofa is in the way of the stairs$/);
    assert.match(plan.layout({ desks: {}, furniture: onStairs, room: { loft: true } }, 0, free)!, /^Sofa is in the way of the stairs$/);
    // All one level, it can: and the loft's seats are gone, for whoever gets round the floor and whoever sits down.
    assert.equal(plan.layout({ desks: {}, furniture: onStairs, room: { loft: false } }, 0, free), undefined);
    assert.deepEqual(plan.state().room, { mezzanine: 'none' });
    assert.deepEqual(plan.layoutNow().room, { ...ROOM_DEFAULTS, mezzanine: 'none', boss: false });
    assert.equal(plan.seat('boss-chair'), undefined);
    assert.equal(plan.seat('loft-couch'), undefined);
    assert.equal(plan.seat('couch')?.id, 'couch');
    const nav = plan.layoutNow();
    assert.equal(officeNav(0, undefined, nav.furniture, nav.room).walkable(ON_STAIRS.x, 11.4), true);

    // Across a restart the layout's still there: it's read back against the room it was saved with.
    const again = new FloorPlanStore(dir);
    assert.deepEqual(again.state().room, { mezzanine: 'none' });
    assert.deepEqual([again.state().furniture?.at(-1)?.id, again.state().furniture?.at(-1)?.x, again.state().furniture?.at(-1)?.z], ['new', sofaOnStairs.x, sofaOnStairs.z]);
    assert.equal(again.state().layoutRevision, 1);
    assert.equal(again.seat('boss-chair'), undefined);

    // The mezzanine can't come back while the sofa's where its stairs go: by saying so, or by no longer saying it's gone.
    const why = 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs';
    assert.equal(again.layout({ desks: {}, furniture: onStairs, room: { loft: true } }, 1, free), why);
    assert.equal(again.layout({ desks: {}, furniture: onStairs }, 1, free), why);
    assert.deepEqual(again.state().room, { mezzanine: 'none' });
    assert.equal(again.state().layoutRevision, 1);
    // Something wrong either way is just what's wrong.
    assert.match(again.layout({ desks: {}, furniture: [...defaults(), { id: 'new', kind: 'sofa', x: 40, z: 0, rotY: 0 }] }, 1, free)!, /^Sofa must stay inside the room$/);
    // Once it's moved, the mezzanine's back, and so are its seats.
    assert.equal(again.layout({ desks: {}, furniture: defaults() }, 1, free), undefined);
    assert.equal(again.state().room, undefined);
    assert.deepEqual(roomOf(again.state()), ROOM_DEFAULTS);
    assert.equal(again.seat('loft-couch')?.id, 'loft-couch');
    assert.equal(new FloorPlanStore(dir).seat('boss-chair')?.id, 'boss-chair');
  });
});

test('a plan read back keeps a one-level layout, and drops one that only fit while it was', () => {
  const onStairs = [...defaults(), sofaOnStairs];
  const flat = cleanPlan({ wing: 0, labels: {}, desks: {}, furniture: onStairs, room: { loft: false }, layoutRevision: 4 });
  assert.deepEqual([flat.room, flat.furniture?.length, flat.layoutRevision], [{ mezzanine: 'none' }, onStairs.length, 4]);
  // The same furniture on a floor that has the mezzanine doesn't fit: the layout goes, as any that doesn't.
  const stale = cleanPlan({ wing: 0, labels: {}, desks: {}, furniture: onStairs, layoutRevision: 4 });
  assert.deepEqual([stale.room, stale.furniture, stale.layoutRevision], [undefined, undefined, undefined]);
});
