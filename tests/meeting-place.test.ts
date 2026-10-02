// A floor's meeting place (shared/meeting-place.ts): the glass room the office comes with, the stage's
// panel table or the anchor desk. Each has to be what the rules, the paths and the server all read the
// same way: five seats under the same ids, laptops that fit on its table, chairs a worker can walk in
// to, and a floor that only moves it once nothing's in the way and nobody's sat there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Box3 } from 'three';
import { Dog } from '../src/server/dog.js';
import { FloorPlanStore } from '../src/server/floorplan.js';
import type { DogState } from '../src/shared/dog.js';
import { ROOM_DEFAULTS, cleanPlan, type RoomOptions } from '../src/shared/floorplan.js';
import { DEFAULT_FURNITURE, type Piece } from '../src/shared/furniture.js';
import { DESK_BY_ID, ELEVATOR, ELEVATOR_FRONT, MEETING_BOARD, MEETING_LAPTOP, MEETING_ROOM, MEETING_SEATS, MEETING_TABLE, type DeskDef } from '../src/shared/layout.js';
import { MEETING_KINDS, meetingOf, meetingPlace, meetingSeats, type MeetingKind, type MeetingPlace } from '../src/shared/meeting-place.js';
import { deskPoint, officeNav, type NavGrid, type Pt } from '../src/shared/nav.js';
import { layoutDesks, layoutProblems, structureProblem, validateLayout } from '../src/shared/office-builder.js';
import { FIXED, KEEP_CLEAR, fixedIn, keepClearIn, type Rect } from '../src/shared/office-fixed.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const FORUM = { meeting: 'forum' } as const;
const DESK = { meeting: 'desk' } as const;
const roomWith = (kind: MeetingKind): RoomOptions => (kind === 'room' ? {} : { meeting: kind });
const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
const names = (room?: RoomOptions) => [...fixedIn(room).rects, ...fixedIn(room).circles, ...keepClearIn(room)].map((f) => f.what);
/** What the meeting place is to the rules, by name: everything else is the same on every floor. */
const MEETING_NAMES = new Set(["the meeting room's glass", 'the meeting table', "the meeting room's door", 'the panel table', "the stage's board", 'the anchor desk', 'the prompter']);
const tableRect = (t: MeetingPlace['table']): Rect => [t.x - t.width / 2, t.x + t.width / 2, t.z - t.depth / 2, t.z + t.depth / 2];
const near = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-9);

function withDir(fn: (dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-studio-meeting-'));
  const done = () => rmSync(dir, { recursive: true, force: true });
  let later: void | Promise<void>;
  try {
    later = fn(dir);
  } catch (err) {
    done();
    throw err;
  }
  return later instanceof Promise ? later.finally(done) : done();
}

test('a room has the glass room unless it says the stage or the anchor desk', () => {
  assert.deepEqual(MEETING_KINDS, ['room', 'forum', 'desk']);
  assert.deepEqual([meetingOf(), meetingOf({}), meetingOf(ROOM_DEFAULTS), meetingOf({ meeting: 'room' }), meetingOf(FORUM), meetingOf(DESK)], ['room', 'room', 'room', 'room', 'forum', 'desk']);
  assert.equal(meetingOf({ meeting: 'lobby' as MeetingKind }), 'room');
  // The same place every time, whatever else the room says.
  assert.equal(meetingPlace(), meetingPlace({ tees: 2, mezzanine: 'big' }));
  assert.equal(meetingPlace(FORUM), meetingPlace({ ...FORUM, steps: true }));
  assert.deepEqual(MEETING_KINDS.map((kind) => meetingPlace(roomWith(kind)).kind), MEETING_KINDS);
  assert.deepEqual(MEETING_KINDS.map((kind) => meetingPlace(roomWith(kind)).title), ['🤝 Meeting room', '🎤 Stage', '🎥 Anchor desk']);
  assert.deepEqual(MEETING_KINDS.map((kind) => meetingPlace(roomWith(kind)).where), ['🤝 in the meeting room', '🎤 on the stage', '🎥 at the anchor desk']);
});

test('the glass room is the office as it always was, to the number', () => {
  const place = meetingPlace();
  assert.equal(place.table, MEETING_TABLE);
  assert.equal(place.glass, MEETING_ROOM);
  assert.deepEqual(place.area, [9.15, 18, 8.15, 13]);
  assert.deepEqual(place.board, { x: MEETING_BOARD.x, y: MEETING_BOARD.y, z: MEETING_BOARD.z, rotY: Math.PI, width: MEETING_BOARD.width, height: MEETING_BOARD.height });
  // The sign is inside the pane beside the door, facing out, and the three spots are where the room's were.
  assert.ok(near([place.sign.x, place.sign.y, place.sign.z, place.sign.rotY, place.sign.scale], [9.585, 1.45, 8.23, Math.PI, 1]), JSON.stringify(place.sign));
  assert.deepEqual(place.use.talk, { x: 13.7, z: 10.5, radius: 2.9 });
  assert.ok(near([place.use.read.x, place.use.read.z, place.use.read.radius], [13.7, 11.52, 2.4]));
  assert.ok(near([place.use.sign.x, place.use.sign.z, place.use.sign.radius], [9.585, 6.95, 1.8]));
  assert.deepEqual(place.seats, MEETING_SEATS.map(({ x, z, rotY }) => ({ x, z, rotY })));
  assert.deepEqual(meetingSeats(), MEETING_SEATS);

  // What's built in and what's kept clear are today's lists, in today's order: the glass with the doorway
  // in the north wall, the table, a chair's middle each, and the floor either side of the door.
  const G = 0.06;
  const R = MEETING_ROOM;
  const T = MEETING_TABLE;
  const meeting = FIXED.rects.filter((f) => MEETING_NAMES.has(f.what));
  assert.deepEqual(meeting, [
    { rect: [R.minX - G, R.minX + G, R.minZ - G, R.maxZ], what: "the meeting room's glass" },
    { rect: [R.minX - G, R.door.x0, R.minZ - G, R.minZ + G], what: "the meeting room's glass" },
    { rect: [R.door.x1, R.maxX, R.minZ - G, R.minZ + G], what: "the meeting room's glass" },
    { rect: [T.x - T.width / 2, T.x + T.width / 2, T.z - T.depth / 2, T.z + T.depth / 2], what: 'the meeting table' },
  ]);
  assert.deepEqual(FIXED.rects.slice(-4), meeting, 'last of what stands on the floor, as they were');
  assert.deepEqual(FIXED.rects.map((f) => f.what), [
    'the kitchen',
    'the stairs',
    'the elevator',
    'the ladder',
    'the fire pole',
    "the issues board's kiosk",
    "the pr board's kiosk",
    "the task queue's kiosk",
    "the meeting room's glass",
    "the meeting room's glass",
    "the meeting room's glass",
    'the meeting table',
  ]);
  assert.deepEqual(FIXED.circles.map((f) => f.what), ["one of the loft's posts", "one of the loft's posts", ...MEETING_SEATS.map(() => 'a meeting chair')]);
  assert.deepEqual(FIXED.circles.slice(2).map((f) => f.circle), MEETING_SEATS.map((d) => [...deskPoint(d, 0, 0.85), 0.18]));
  assert.deepEqual(KEEP_CLEAR.map((f) => f.what), [
    "the elevator's doors",
    'the exit door',
    'the balcony doors',
    'the foot of the stairs',
    "the meeting room's door",
    'the kitchen counter',
    'the ladder',
    "the issues board's kiosk",
    "the pr board's kiosk",
    "the task queue's kiosk",
  ]);
  assert.deepEqual(KEEP_CLEAR.find((f) => f.what === "the meeting room's door")?.rect, [R.door.x0, R.door.x1, R.minZ - 1, R.minZ + 1]);
  // A room that says it in full is the same floor.
  assert.equal(fixedIn(ROOM_DEFAULTS), FIXED);
  assert.equal(fixedIn({ meeting: 'room' }), FIXED);
  assert.equal(keepClearIn({ meeting: 'room', ceiling: 'beams' }), KEEP_CLEAR);
});

test('the stage and the anchor desk, as the plan drew them', () => {
  const forum = meetingPlace(FORUM);
  assert.deepEqual(forum.table, { x: 15.5, z: 0, width: 0.8, depth: 5.5, height: 0.76 });
  assert.ok(near(tableRect(forum.table), [15.1, 15.9, -2.75, 2.75]));
  assert.deepEqual(forum.area, [13.5, 18, -3.1, 3.1]);
  // The panel sits along the east side facing west, whoever leads it in the middle.
  assert.deepEqual(forum.seats.map((s) => s.z), [0, -1.1, 1.1, -2.2, 2.2]);
  assert.ok(forum.seats.every((s) => s.x === 15.42 && s.rotY === Math.PI / 2));
  assert.ok(near([forum.board.x, forum.board.y, forum.board.z, forum.board.rotY, forum.board.width, forum.board.height], [17.92, 1.95, 5.4, -Math.PI / 2, 3.6, 1.2]));
  assert.ok(!forum.board.twoSided && !forum.glass);
  assert.ok(near([forum.sign.x, forum.sign.y, forum.sign.z, forum.sign.rotY, forum.sign.scale], [17.9, 1.45, -4.2, -Math.PI / 2, 1]));
  assert.equal(forum.fixed.length, 1);
  assert.equal(forum.fixed[0].what, 'the panel table');
  assert.ok(near(forum.fixed[0].rect, [15.1, 15.9, -2.75, 2.75]));
  assert.deepEqual(forum.clear, [{ rect: [17, 18, 3.45, 7.35], what: "the stage's board" }]);

  const desk = meetingPlace(DESK);
  assert.deepEqual(desk.table, { x: -3.9, z: -6.2, width: 7, depth: 0.8, height: 0.76 });
  assert.ok(near(tableRect(desk.table), [-7.4, -0.4, -6.6, -5.8]));
  assert.deepEqual(desk.area, [-8, 0.2, -8.2, -4.9]);
  // The anchors sit along the north side facing south.
  assert.deepEqual(desk.seats.map((s) => s.x), [-3.9, -5.3, -2.5, -6.7, -1.1]);
  assert.ok(desk.seats.every((s) => s.z === -6.2 && s.rotY === Math.PI));
  assert.deepEqual(desk.board, { x: -3.9, y: 1.25, z: -3.2, rotY: Math.PI, width: 1.8, height: 0.6, twoSided: true });
  assert.deepEqual(desk.sign, { x: -6.9, y: 0.38, z: -5.78, rotY: 0, scale: 0.72 });
  assert.deepEqual(desk.fixed.map((f) => f.what), ['the anchor desk', 'the prompter']);
  assert.ok(near(desk.fixed[0].rect, [-7.4, -0.4, -6.6, -5.8]));
  assert.deepEqual(desk.fixed[1].rect, [-4.8, -3, -3.35, -3.05]);
  assert.deepEqual(desk.clear, []);

  for (const place of [forum, desk]) {
    // Each of its three spots is inside the room, and the table's is at the table.
    for (const spot of Object.values(place.use)) assert.ok(Math.abs(spot.x) < 18 && Math.abs(spot.z) < 13 && spot.radius > 1, `${place.kind}: ${JSON.stringify(spot)}`);
    assert.deepEqual([place.use.talk.x, place.use.talk.z], [place.table.x, place.table.z]);
    // Every chair is inside what counts as being there.
    const [minX, maxX, minZ, maxZ] = place.area;
    for (const seat of meetingSeats(roomWith(place.kind))) {
      const [x, z] = deskPoint(seat, 0, 0.85);
      assert.ok(x > minX && x < maxX && z > minZ && z < maxZ, `${place.kind}: ${seat.id}'s chair at (${x}, ${z})`);
    }
  }
});

test('every meeting place has the same five seats: fresh copies, at its own places', () => {
  for (const kind of MEETING_KINDS) {
    const room = roomWith(kind);
    const seats = meetingSeats(room);
    assert.deepEqual(seats.map((d) => d.id), ['meeting-1', 'meeting-2', 'meeting-3', 'meeting-4', 'meeting-5'], kind);
    assert.deepEqual(seats.map((d) => d.label), MEETING_SEATS.map((d) => d.label));
    assert.ok(seats.every((d) => d.room === true && !d.beanbag && !d.station && !d.wing));
    assert.deepEqual(seats.map(({ x, z, rotY }) => ({ x, z, rotY })), meetingPlace(room).seats);
    // Nobody's handed the office's own, or the same one twice.
    seats[0].x = 99;
    assert.notEqual(meetingSeats(room)[0].x, 99);
    assert.ok(seats.every((d, i) => d !== MEETING_SEATS[i] && d !== DESK_BY_ID.get(d.id)));
  }
  // A browser stands the shared seats at the floor's own place (see client/world/office/meeting-place.ts):
  // the glass room's are still where the office has them, for the next floor.
  const head = MEETING_SEATS[0];
  const was = { x: head.x, z: head.z, rotY: head.rotY };
  try {
    Object.assign(head, meetingPlace(FORUM).seats[0]);
    assert.deepEqual([meetingSeats()[0].x, meetingSeats()[0].z, meetingSeats()[0].rotY], [was.x, was.z, was.rotY]);
    assert.deepEqual(meetingPlace().seats[0], was);
  } finally {
    Object.assign(head, was);
  }
  assert.deepEqual(meetingSeats(), MEETING_SEATS);
});

// ---- Laptops (the test of tests/meeting-table.test.ts, at every place) --------------------------

/** The least room between two of them. */
const ROOM = 0.1;

/** An open laptop's footprint in its own frame: x across it, z out toward whoever is typing. */
async function footprint() {
  // The model paints its screen on a canvas, which is all it needs of a page.
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
  const { Laptop } = await import('../src/client/features/workers/laptop.js');
  const laptop = new Laptop();
  laptop.update(10, undefined); // long enough for its lid to come all the way up
  const box = new Box3().setFromObject(laptop.root, true);
  laptop.dispose();
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}
type Footprint = Awaited<ReturnType<typeof footprint>>;

/** Its four corners on the floor plan, at `seat`'s place, `at.scale` the model's size and `at.z` toward the chair. */
function corners(seat: DeskDef, f: Footprint, at: { scale: number; z: number }): Pt[] {
  const [x0, x1, z0, z1] = [f.minX * at.scale, f.maxX * at.scale, f.minZ * at.scale + at.z, f.maxZ * at.scale + at.z];
  return [deskPoint(seat, x0, z0), deskPoint(seat, x1, z0), deskPoint(seat, x1, z1), deskPoint(seat, x0, z1)];
}

/** How far apart two four-sided shapes are: the widest gap across any of their sides (under 0, they overlap). */
function gap(a: Pt[], b: Pt[]): number {
  let widest = -Infinity;
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i++) {
      const [x0, z0] = shape[i];
      const [x1, z1] = shape[(i + 1) % shape.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const along = (pts: Pt[]) => pts.map(([x, z]) => (x * (z1 - z0) - z * (x1 - x0)) / len);
      const [pa, pb] = [along(a), along(b)];
      widest = Math.max(widest, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return widest;
}

test('at every meeting place, no laptop reaches into another, and each is on the table', async () => {
  const f = await footprint();
  for (const kind of MEETING_KINDS) {
    const room = roomWith(kind);
    const seats = meetingSeats(room);
    const shapes = seats.map((seat) => corners(seat, f, MEETING_LAPTOP));
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const g = gap(shapes[i], shapes[j]);
        assert.ok(g >= ROOM, `${kind}: ${seats[i].id} and ${seats[j].id} are ${g < 0 ? `${(-g).toFixed(2)} m into each other` : `only ${g.toFixed(2)} m apart`}`);
      }
    }
    const t = meetingPlace(room).table;
    shapes.forEach((shape, i) => {
      for (const [x, z] of shape) assert.ok(Math.abs(x - t.x) < t.width / 2 && Math.abs(z - t.z) < t.depth / 2, `${kind}: ${seats[i].id}'s laptop is over the table's edge at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    });
  }
  // Why the stage's and the anchor desk's places are about the middle of their tables, not 0.2 m toward
  // the chairs where the plan first had them: those tables are 0.8 deep, and a laptop there hangs over the edge.
  const reach = f.maxZ * MEETING_LAPTOP.scale + MEETING_LAPTOP.z;
  assert.ok(reach > 0.2 && reach < 0.4, `a laptop reaches ${reach.toFixed(2)} m toward its chair`);
});

// ---- Walking in ---------------------------------------------------------------------------------

/** Whether a walker gets from `from` to `to` over the grid's free cells, never cutting a corner past something in the way. */
function reaches(nav: NavGrid, from: Pt, to: Pt): boolean {
  const cell = ([x, z]: Pt) => [Math.floor((x - nav.bounds.minX) / 0.5), Math.floor((z - nav.bounds.minZ) / 0.5)] as const;
  const free = (c: number, r: number) => c >= 0 && r >= 0 && c < nav.cols && r < nav.rows && nav.walkable(nav.bounds.minX + (c + 0.5) * 0.5, nav.bounds.minZ + (r + 0.5) * 0.5);
  const [gc, gr] = cell(to);
  const [sc, sr] = cell(from);
  if (!free(sc, sr) || !free(gc, gr)) return false;
  const seen = new Set([sr * nav.cols + sc]);
  const queue: (readonly [number, number])[] = [[sc, sr]];
  for (const [c, r] of queue) {
    if (c === gc && r === gr) return true;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const [nc, nr] = [c + dc, r + dr];
      if (!free(nc, nr) || seen.has(nr * nav.cols + nc) || (dc && dr && (!free(nc, r) || !free(c, nr)))) continue;
      seen.add(nr * nav.cols + nc);
      queue.push([nc, nr]);
    }
  }
  return false;
}

/** A floor with this room as the office would leave it: the office's furniture and desks, less what's in the meeting place's way. */
function floorWith(room: RoomOptions) {
  const wrong = layoutProblems({ desks: {}, furniture: defaults() }, room);
  const furniture = defaults().filter((p) => !wrong.has(p.id));
  const desks = layoutDesks().filter((d) => !wrong.has(d.id));
  return { wrong, nav: officeNav(0, desks, furniture, room) };
}

test('a worker called to a meeting can walk in from the lift to either side of every chair', () => {
  const lift: Pt = [ELEVATOR.x, ELEVATOR_FRONT + 0.5];
  for (const kind of MEETING_KINDS) {
    const room = roomWith(kind);
    const { nav } = floorWith(room);
    for (const seat of meetingSeats(room)) {
      for (const side of [-1, 1]) {
        const at = deskPoint(seat, side * 0.7, 1.4);
        assert.equal(nav.walkable(...at), true, `${kind}: ${seat.id} at (${at[0].toFixed(2)}, ${at[1].toFixed(2)})`);
        assert.equal(reaches(nav, lift, at), true, `${kind}: no way from the lift to ${seat.id} at (${at[0].toFixed(2)}, ${at[1].toFixed(2)})`);
      }
      // And the walk it takes ends beside the chair, where it hops on.
      const way = nav.wayTo(lift, seat);
      assert.ok(way.length >= 2, `${kind}: ${seat.id}`);
      assert.ok([-1, 1].some((side) => near(way.at(-1)!, deskPoint(seat, side * 0.7, 0.95))), `${kind}: ${seat.id} ends at ${way.at(-1)}`);
      assert.ok([-1, 1].some((side) => near(way.at(-2)!, deskPoint(seat, side * 0.7, 1.4))), `${kind}: ${seat.id} comes in by ${way.at(-2)}`);
    }
  }
});

// ---- What's built in, and changing it -------------------------------------------------------------

test("what's built in goes by the meeting place: the glass room's walls go, and the table moves", () => {
  const rest = (room?: RoomOptions) => names(room).filter((w) => !MEETING_NAMES.has(w));
  for (const room of [FORUM, DESK]) {
    const built = names(room);
    for (const what of ["the meeting room's glass", 'the meeting table', "the meeting room's door"]) assert.ok(!built.includes(what), `${room.meeting}: ${what}`);
    assert.equal(built.filter((w) => w === 'a meeting chair').length, 5);
    assert.deepEqual(rest(room), rest(), 'everything else is where it was');
    assert.deepEqual(fixedIn(room).circles.filter((f) => f.what === 'a meeting chair').map((f) => f.circle), meetingSeats(room).map((d) => [...deskPoint(d, 0, 0.85), 0.18]));
  }
  assert.deepEqual(names(FORUM).filter((w) => MEETING_NAMES.has(w)), ['the panel table', "the stage's board"]);
  assert.deepEqual(names(DESK).filter((w) => MEETING_NAMES.has(w)), ['the anchor desk', 'the prompter']);
  // It goes with any upstairs, and each combination is a floor of its own.
  assert.equal(fixedIn({ ...FORUM, tees: 2, ceiling: 'banners' }), fixedIn(FORUM));
  assert.notEqual(fixedIn({ ...FORUM, mezzanine: 'none' }), fixedIn(FORUM));
  assert.deepEqual(rest({ ...DESK, mezzanine: 'big' }), rest({ mezzanine: 'big' }));

  // The way round the floor: the south-east corner is open floor without the glass room, and the new table's in the way.
  const glass = officeNav(0, undefined, DEFAULT_FURNITURE);
  const stage = floorWith({ ...FORUM, mezzanine: 'none' }).nav;
  assert.equal(glass.walkable(MEETING_ROOM.minX, 10.5), false);
  assert.equal(glass.walkable(MEETING_TABLE.x, MEETING_TABLE.z), false);
  assert.equal(stage.walkable(MEETING_ROOM.minX + 0.4, 10.5), true);
  assert.equal(stage.walkable(MEETING_TABLE.x, MEETING_TABLE.z), true);
  assert.equal(stage.walkable(15.5, 1), false, 'the panel table');
  assert.equal(glass.walkable(15.5, 1), true);
  const anchors = floorWith(DESK).nav;
  assert.equal(anchors.walkable(-3.9, -6.2), false, 'the anchor desk');
  assert.equal(anchors.walkable(-3.9, -3.2), false, 'the prompter');
  assert.equal(anchors.walkable(-3.9, -4.6), true, 'between them');
});

test('moving the meeting place says what stands in its way', () => {
  const office = { desks: {}, furniture: defaults() };
  // The stage's board hangs where the jukebox and the arcade stand; the anchor desk and its prompter stand in the north pods.
  assert.deepEqual([...floorWith(FORUM).wrong.keys()], ['jukebox', 'arcade']);
  assert.deepEqual([...floorWith(DESK).wrong.keys()], ['desk-5', 'desk-6', 'desk-7']);
  assert.equal(structureProblem(office, {}, FORUM), "Clear the floor for the meeting place first: Jukebox would block the stage's board");
  assert.equal(structureProblem(office, {}, DESK), 'Clear the floor for the meeting place first: Desk 5 is in the way of the anchor desk');
  assert.equal(structureProblem(office, FORUM, DESK), 'Clear the floor for the meeting place first: Desk 5 is in the way of the anchor desk');
  assert.equal(validateLayout({}, defaults(), FORUM), "Jukebox would block the stage's board");
  // Back to the glass room, with something in its corner.
  const corner = { desks: {}, furniture: [...defaults().filter((p) => p.id !== 'jukebox' && p.id !== 'arcade'), { id: 'new', kind: 'sofa', x: 13.7, z: 10.5, rotY: 0 } as Piece] };
  assert.equal(layoutProblems(corner, { ...FORUM, mezzanine: 'none' }).size, 0);
  assert.equal(structureProblem(corner, { ...FORUM, mezzanine: 'none' }, { mezzanine: 'none' }), 'Clear the floor for the meeting place first: Sofa is in the way of the meeting table');
  // With the mezzanine coming back too, each thing in the way is put down to what it's in the way of.
  assert.equal(structureProblem(corner, { ...FORUM, mezzanine: 'none' }, {}), 'Clear the floor for the meeting place first: Sofa is in the way of the meeting table');
  const stairs = { desks: {}, furniture: [...corner.furniture.filter((p) => p.id !== 'new'), { id: 'new', kind: 'sofa', x: 6, z: 12.25, rotY: 0 } as Piece] };
  assert.equal(structureProblem(stairs, { ...FORUM, mezzanine: 'none' }, {}), 'Clear the floor for the mezzanine first: Sofa is in the way of the stairs');
  // Once it's clear, nothing.
  assert.equal(structureProblem({ desks: {}, furniture: corner.furniture.filter((p) => p.id !== 'new') }, {}, FORUM), undefined);
  assert.equal(structureProblem(office, {}, { ceiling: 'beams' }), undefined);
});

test('a floor saves its meeting place with its layout, and only moves it once the meeting seats are free', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    const free = () => false;
    const inMeeting = (id: string) => id === 'meeting-3';
    const cleared = defaults().filter((p) => p.id !== 'jukebox' && p.id !== 'arcade');
    assert.equal(plan.layoutNow().room.meeting, 'room');
    // What's in the way first.
    assert.equal(plan.layout({ desks: {}, furniture: defaults(), room: FORUM }, 0, free), "Clear the floor for the meeting place first: Jukebox would block the stage's board");
    // Then whoever's sat there: nobody's seat moves out from under them.
    assert.equal(plan.layout({ desks: {}, furniture: cleared, room: FORUM }, 0, inMeeting), 'Clear the meeting room before moving the meeting place');
    assert.equal(plan.state().room, undefined);
    assert.equal(plan.state().layoutRevision, undefined);
    // With a meeting on, the rest of the floor can still be rearranged.
    assert.equal(plan.layout({ desks: {}, furniture: cleared }, 0, inMeeting), undefined);
    assert.equal(plan.layout({ desks: {}, furniture: cleared, room: { tees: 2, ceiling: 'beams' } }, 1, inMeeting), undefined);
    assert.equal(plan.layout({ desks: {}, furniture: cleared, room: FORUM }, 2, free), undefined);
    assert.deepEqual(plan.state().room, FORUM);
    assert.deepEqual(plan.layoutNow().room, { ...ROOM_DEFAULTS, meeting: 'forum' });

    // Across a restart, and back again: the same rule both ways.
    const again = new FloorPlanStore(dir);
    assert.deepEqual(again.state().room, FORUM);
    assert.equal(again.layout({ desks: {}, furniture: cleared }, 3, inMeeting), 'Clear the meeting room before moving the meeting place');
    assert.equal(again.layout({ desks: {}, furniture: cleared, room: DESK }, 3, inMeeting), 'Clear the floor for the meeting place first: Desk 5 is in the way of the anchor desk');
    assert.equal(again.layout({ desks: {}, furniture: cleared, room: { ...FORUM, steps: true } }, 3, inMeeting), 'Clear the floor for the Steps first: Sofa is in the way of the Steps');
    assert.equal(again.layout({ desks: {}, furniture: cleared }, 3, free), undefined);
    assert.equal(again.state().room, undefined);
    assert.equal(again.layoutNow().room.meeting, 'room');
  });
});

test('a plan read back keeps a meeting place its layout makes room for, and not one it does not', () => {
  const cleared = defaults().filter((p) => p.id !== 'jukebox' && p.id !== 'arcade');
  const forum = cleanPlan({ wing: 0, labels: {}, room: FORUM, desks: {}, furniture: cleared, layoutRevision: 2 });
  assert.deepEqual([forum.room, forum.furniture?.length, forum.layoutRevision], [FORUM, cleared.length, 2]);
  // With no layout of its own, the office's furniture less what's in the stage's way.
  const bare = cleanPlan({ room: FORUM });
  assert.deepEqual(bare.room, FORUM);
  assert.deepEqual(bare.furniture, cleared);
  // The anchor desk stands where the office has desks, and desks can't be left out: with no layout that
  // moves them, the floor has the glass room.
  const anchor = cleanPlan({ room: { ...DESK, ceiling: 'grid' } });
  assert.deepEqual(anchor.room, { ceiling: 'grid' });
  assert.equal(anchor.furniture, undefined);
  assert.deepEqual(cleanPlan({ room: DESK, desks: {}, furniture: defaults() }).room, undefined, 'the same for a layout that no longer fits');
  // One that does move them keeps it.
  const moved = { 'desk-5': { x: 9, z: -8, rotY: 0 }, 'desk-6': { x: 11.5, z: -8, rotY: 0 }, 'desk-7': { x: 9, z: 6.5, rotY: 0 } };
  const kept = cleanPlan({ room: DESK, desks: moved, furniture: defaults().filter((p) => !['plant-8', 'couch', 'coffee-table', 'lounge-beanbag-1', 'lounge-beanbag-2', 'whiteboard'].includes(p.id)), layoutRevision: 1 });
  assert.deepEqual([kept.room, kept.layoutRevision], [DESK, 1]);
});

test('the dog finds a worker in a meeting at the floor’s own meeting place', async () => {
  await withDir(async (dir) => {
    for (const kind of MEETING_KINDS) {
      const room = roomWith(kind);
      const sent: DogState[] = [];
      const worker = { id: 'w1', deskId: 'meeting-1', status: 'needs_input', acked: false } as WorkerInfo;
      const dog = new Dog(`floor-${kind}`, dir, { workers: () => [worker], people: () => [], send: (state) => sent.push(state), layout: () => ({ desks: {}, furniture: floorFurniture(room), room, revision: 1 }) });
      try {
        dog.onWorker(worker);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const bark = sent.at(-1);
        assert.equal(bark?.act, 'bark', kind);
        const [head] = meetingSeats(room);
        const end = bark.path.at(-1)!;
        // Beside the head of the table's chair, wherever this floor has it.
        assert.ok([-1, 1].some((side) => Math.hypot(end[0] - deskPoint(head, side * 0.75, 1.45)[0], end[1] - deskPoint(head, side * 0.75, 1.45)[1]) < 0.75), `${kind}: it ran to (${end[0].toFixed(2)}, ${end[1].toFixed(2)})`);
      } finally {
        dog.stop();
      }
    }
  });
});

/** The office's furniture less what's in the way in `room` (see floorWith). */
function floorFurniture(room: RoomOptions): Piece[] {
  const wrong = layoutProblems({ desks: {}, furniture: defaults() }, room);
  return defaults().filter((p) => !wrong.has(p.id));
}
