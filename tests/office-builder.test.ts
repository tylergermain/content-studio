// The office builder's rules (shared/office-builder.ts, shared/furniture.ts): what a layout may be, what
// the floor's furniture gives it (what's in the way, where there is to sit), and how a floor keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { ROOM_DEFAULTS, cleanPlan } from '../src/shared/floorplan.js';
import { DEFAULT_FURNITURE, FURNITURE, FURNITURE_KINDS, MAX_PIECES, cleanFurniture, floorSeat, furnitureSeats, pieceAway, pieceBox, pieceCollider, setFloorSeats, type Piece } from '../src/shared/furniture.js';
import { ELEVATOR, ELEVATOR_FRONT, SEATING, SEATING_BY_ID, seatAt } from '../src/shared/layout.js';
import { officeNav } from '../src/shared/nav.js';
import { ORIGINAL_DESKS, deskRect, layoutDesks, layoutProblems, problemAt, validateLayout } from '../src/shared/office-builder.js';

const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
const withPiece = (p: Piece) => ({ desks: {}, furniture: [...defaults(), p] });

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-studio-builder-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the office as it comes is a layout the builder accepts, and saves as it is', () => {
  assert.equal(layoutProblems({ desks: {}, furniture: defaults() }).size, 0);
  const layout = validateLayout({});
  assert.ok(typeof layout === 'object');
  assert.deepEqual(layout.desks, {});
  assert.deepEqual(layout.furniture, defaults());
  // What a browser sends back is what it was sent.
  assert.deepEqual(cleanFurniture(JSON.parse(JSON.stringify(DEFAULT_FURNITURE))), defaults());
});

test('desks have to be the room\'s own, on the floor, a quarter turn at a time and clear of everything else', () => {
  assert.equal(typeof validateLayout({ 'desk-1': { x: NaN, z: 0, rotY: 0 } }), 'string');
  assert.equal(typeof validateLayout({ 'desk-1': { x: 0, z: 0, rotY: 0.4 } }), 'string');
  assert.match(validateLayout({ 'desk-1': { x: 40, z: 0, rotY: 0 } }) as string, /inside the room/);
  assert.match(validateLayout({ 'desk-1': { ...ORIGINAL_DESKS[1] } }) as string, /overlaps desk 2/);
  // On the plant between the pods.
  assert.match(validateLayout({ 'desk-1': { x: -6, z: 0, rotY: 0 } }) as string, /overlaps the ficus/);
  assert.match(validateLayout({ 'station-queue': { x: 0, z: 0, rotY: 0 } }) as string, /Only the main office desks/);
  // Anywhere in the room that's free will do, not just among the other desks.
  const moved = validateLayout({ 'desk-1': { x: 5.13, z: 3.9, rotY: Math.PI * 2.5 } });
  assert.ok(typeof moved === 'object');
  assert.deepEqual(moved.desks['desk-1'], { x: 5.25, z: 4, rotY: Math.PI / 2 });
});

test('a list of furniture is checked a piece at a time: its id, its kind, where it is and what it is', () => {
  assert.equal(typeof cleanFurniture('nope'), 'string');
  assert.equal(typeof cleanFurniture([{ id: 'a', kind: 'throne', x: 0, z: 0, rotY: 0 }]), 'string');
  assert.equal(typeof cleanFurniture([{ id: 'a', kind: 'sofa', x: 0, z: Infinity, rotY: 0 }]), 'string');
  assert.equal(typeof cleanFurniture([{ id: 'a', kind: 'sofa', x: 0, z: 0, rotY: 0.3 }]), 'string', 'a sofa turns a quarter at a time');
  assert.equal(typeof cleanFurniture([{ id: 'BAD ID', kind: 'pouf', x: 0, z: 0, rotY: 0 }]), 'string');
  assert.equal(typeof cleanFurniture([{ id: 'desk-3', kind: 'pouf', x: 0, z: 0, rotY: 0 }]), 'string', "a desk's id isn't a piece's");
  assert.equal(typeof cleanFurniture([{ id: 'a', kind: 'pouf', x: 0, z: 0, rotY: 0 }, { id: 'a', kind: 'pouf', x: 3, z: 0, rotY: 0 }]), 'string');
  assert.equal(typeof cleanFurniture(Array.from({ length: MAX_PIECES + 1 }, (_, i) => ({ id: `r-${i}`, kind: 'rug-small', x: 0, z: 0, rotY: 0 }))), 'string');
  const clean = cleanFurniture([
    { id: 'a', kind: 'pouf', x: 1.234, z: -2.01, rotY: 0.3, color: 'red', scale: 9, text: 'hi', extra: true },
    { id: 'b', kind: 'ficus', x: 0, z: 0, rotY: 0, scale: 9, color: '#123456' },
    { id: 'c', kind: 'sign', x: 0, z: 3, rotY: Math.PI * 3.5, color: '#ABCDEF', text: '  Friday \n Labs  and a great deal more than fits on it ' },
  ]);
  assert.ok(typeof clean === 'object');
  // Round things turn any way; a color that isn't one is the kind's own; nothing it didn't ask for is kept.
  assert.deepEqual(clean[0], { id: 'a', kind: 'pouf', x: 1.25, z: -2, rotY: 0.3, color: FURNITURE.pouf.color });
  assert.deepEqual(clean[1], { id: 'b', kind: 'ficus', x: 0, z: 0, rotY: 0, scale: 1.8 });
  assert.deepEqual(clean[2], { id: 'c', kind: 'sign', x: 0, z: 3, rotY: (Math.PI * 3) / 2, color: '#abcdef', text: 'Friday Labs and a great deal' });
});

test('every kind in the catalog is something the builder can stand on an empty stretch of floor', () => {
  for (const kind of FURNITURE_KINDS) {
    const k = FURNITURE[kind];
    assert.ok(('r' in k && k.r > 0) || ('w' in k && k.w > 0 && k.d > 0), `${kind} takes up floor`);
    assert.equal(problemAt(withPiece({ id: 'new', kind, x: 5, z: 7.5, rotY: 0 }), 'new'), undefined, kind);
  }
});

test('furniture keeps off what\'s built in, out of the doorways, and off other furniture; rugs go under anything', () => {
  const at = (kind: Piece['kind'], x: number, z: number, rotY = 0) => problemAt(withPiece({ id: 'new', kind, x, z, rotY }), 'new');
  assert.match(at('armchair', ELEVATOR.x, ELEVATOR_FRONT - 1)!, /the elevator/);
  assert.match(at('armchair', ELEVATOR.x, ELEVATOR_FRONT + 0.6)!, /block the elevator's doors/);
  assert.match(at('table', 17.5, 0)!, /inside the room/);
  assert.match(at('armchair', 10.5, 0)!, /overlaps the sofa/);
  assert.match(at('armchair', ORIGINAL_DESKS[0].x, ORIGINAL_DESKS[0].z)!, /overlaps desk 1/);
  // Two round things only touch when they're closer than their two reaches.
  assert.equal(at('pouf', 13 + 1.31, 0), undefined);
  assert.match(at('pouf', 13 + 1.2, 0)!, /overlaps the coffee table/);
  // A rug lies under the desks, the couch, even the elevator's doors: only the walls stop it.
  assert.equal(at('rug', ORIGINAL_DESKS[0].x, ORIGINAL_DESKS[0].z), undefined);
  assert.equal(at('rug-small', ELEVATOR.x, ELEVATOR_FRONT + 1.2), undefined);
  assert.match(at('rug', 16, 0)!, /inside the room/);
  // Turned a quarter, a table's long side runs the other way.
  const box = pieceBox({ id: 't', kind: 'table', x: 0, z: 0, rotY: Math.PI / 2 });
  assert.ok(Math.abs(box.maxX - box.minX - 1.1) < 1e-9 && Math.abs(box.maxZ - box.minZ - 2.4) < 1e-9);
});

test("the rules go by the floor's own room: with no mezzanine there are no stairs to keep off", () => {
  const sofa = withPiece({ id: 'new', kind: 'sofa', x: 6, z: 12.25, rotY: 0 });
  // No room said is the office as it comes, mezzanine and all: what everything that doesn't say gets.
  assert.match(problemAt(sofa, 'new')!, /in the way of the stairs/);
  assert.equal(problemAt(sofa, 'new', ROOM_DEFAULTS), problemAt(sofa, 'new'));
  assert.match(validateLayout({}, sofa.furniture) as string, /in the way of the stairs/);
  // How many tees are out on the balcony changes nothing on the floor.
  assert.match(validateLayout({}, sofa.furniture, { tees: 2 }) as string, /the stairs/);
  // All one level, the floor where they stood is floor: for the piece, the whole layout, and the plan it's kept in.
  assert.equal(problemAt(sofa, 'new', { loft: false }), undefined);
  assert.equal(layoutProblems(sofa, { loft: false }).size, 0);
  assert.equal(typeof validateLayout({}, sofa.furniture, { tees: 2, loft: false }), 'object');
  assert.equal(cleanPlan({ desks: {}, furniture: sofa.furniture, room: { loft: false } }).furniture?.length, sofa.furniture.length);
  assert.equal(cleanPlan({ desks: {}, furniture: sofa.furniture }).furniture, undefined);
  // (The rest of what a floor's room changes is in tests/room-options.test.ts.)
});

test('a team desk is a desk you bump into and a chair you sit in, facing it, that shares your screen', () => {
  const desk: Piece = { id: 'mine', kind: 'team-desk', x: 4, z: 4, rotY: 0 };
  const hard = pieceCollider(desk)!;
  // Only the desk is in your way: the chair's floor is yours to walk up to.
  assert.ok(hard.maxZ < 4 && hard.top === 0.78, JSON.stringify(hard));
  const [seat] = furnitureSeats([desk]);
  assert.equal(seat.share, true);
  assert.ok(seat.z > 4, 'the chair is on the near side of it');
  assert.ok(Math.abs(seat.rotY - Math.PI) < 1e-9, 'facing the desk');
  // Turned to face east, the chair's on the other side of it.
  const [turned] = furnitureSeats([{ ...desk, rotY: Math.PI / 2 }]);
  assert.ok(turned.x > 4 && Math.abs(turned.z - 4) < 1e-9);
  assert.equal(pieceCollider({ id: 'r', kind: 'rug', x: 0, z: 0, rotY: 0 }), undefined);
});

test('the seats on a floor are its furniture\'s, with the office\'s other ones', () => {
  // As it comes: the lounge's couch (facing the TV) and its two poufs, where they always were.
  const seats = furnitureSeats(DEFAULT_FURNITURE);
  assert.deepEqual(seats.map((s) => s.id).sort(), ['couch', 'lounge-beanbag-1', 'lounge-beanbag-2']);
  for (const s of seats) {
    const was = SEATING_BY_ID.get(s.id)!;
    assert.ok(Math.abs(was.x - s.x) < 1e-9 && Math.abs(was.z - s.z) < 1e-9 && Math.abs(was.rotY - s.rotY) < 2e-3, `${s.id} is where the office has it`);
    assert.deepEqual([s.places, s.hips, s.depth, s.out, !!s.tv], [was.places, was.hips, was.depth, was.out, !!was.tv], s.id);
  }
  // A floor with the couch gone and a sofa of its own somewhere else.
  const mine: Piece[] = [{ id: 'f-sofa', kind: 'sofa', x: 0, z: 9, rotY: Math.PI }];
  assert.equal(floorSeat(mine, 0, 'couch'), undefined, 'the couch went with the furniture');
  assert.equal(floorSeat(mine, 0, 'f-sofa')?.tv, undefined, 'its back is to the TV');
  assert.equal(floorSeat(mine, 0, 'bench')?.id, 'bench', "the balcony's bench isn't furniture");
  assert.equal(floorSeat(DEFAULT_FURNITURE, 0, 'couch')?.tv, true);

  // In a browser, the floor's seats take the last floor's place wherever seats are looked up.
  const before = SEATING.length;
  try {
    setFloorSeats(furnitureSeats(mine));
    assert.equal(seatAt('couch:0'), undefined);
    assert.equal(seatAt('f-sofa:2')?.seatId, 'f-sofa');
    assert.equal(seatAt('bench:1')?.seatId, 'bench');
    assert.equal(SEATING.length, before - 2);
  } finally {
    setFloorSeats(furnitureSeats(DEFAULT_FURNITURE));
  }
  assert.equal(seatAt('couch:2')?.seatId, 'couch');
  assert.equal(SEATING.length, before);
});

test('what stands in the way into the back office is put away while that\'s built out', () => {
  const plant = DEFAULT_FURNITURE.find((p) => p.id === 'plant-5')!;
  assert.equal(pieceAway(plant, 0), false);
  assert.equal(pieceAway(plant, 1), true);
  assert.equal(pieceAway(DEFAULT_FURNITURE.find((p) => p.id === 'couch')!, 2), false);
  assert.equal(officeNav(0).walkable(plant.x, plant.z), false);
  assert.equal(officeNav(1).walkable(plant.x, plant.z), true);
});

test('getting round a floor goes round its own desks and furniture', () => {
  const pose = { x: -6.75, z: -6.75, rotY: Math.PI / 2 };
  const rect = deskRect(pose);
  assert.ok(Math.abs(rect.maxX - rect.minX - 1.1) < 0.001);
  assert.ok(Math.abs(rect.maxZ - rect.minZ - 2.2) < 0.001);
  const custom = officeNav(0, layoutDesks({ 'desk-1': pose }));
  assert.equal(custom.walkable(pose.x, pose.z), false);
  assert.equal(officeNav(0).walkable(-6.75, -6.75), true);
  // The couch moved across the room: the dog walks where it was, and round where it is.
  const moved = defaults().map((p) => (p.id === 'couch' ? { ...p, x: 5, z: 8 } : p));
  const nav = officeNav(0, undefined, moved);
  assert.equal(nav.walkable(10.5, 0), true);
  assert.equal(nav.walkable(5, 8), false);
  assert.equal(officeNav(0).walkable(10.5, 0), false);
  // A rug is nothing to walk round.
  assert.equal(officeNav(0, undefined, [{ id: 'r', kind: 'rug', x: 5, z: 3, rotY: 0 }]).walkable(5, 3), true);
});

test('a floor keeps its layout across restarts, with its signs and its back office, and refuses a stale or broken one', () => {
  withDir((dir) => {
    const plan = new FloorPlanStore(dir);
    plan.expand();
    plan.label('desk-1', 'Research', undefined, 'Tyler');
    const desks = { 'desk-1': { x: -6.75, z: -6.75, rotY: 0 } };
    const furniture = [...defaults(), { id: 'f-me', kind: 'team-desk', x: 4, z: 4, rotY: 0, color: '#5bc0eb' } satisfies Piece];
    assert.equal(plan.layout({ desks, furniture, look: 3 }, 0, () => false), undefined);
    assert.equal(plan.state().layoutRevision, 1);

    const reloaded = new FloorPlanStore(dir);
    assert.deepEqual(reloaded.state().desks, desks);
    assert.deepEqual(reloaded.state().furniture, furniture);
    assert.equal(reloaded.state().look, 3);
    assert.equal(reloaded.state().wing, 1);
    assert.equal(reloaded.state().labels['desk-1'].text, 'Research');
    assert.equal(reloaded.seat('f-me')?.share, true);
    assert.equal(reloaded.layoutNow().revision, 1);

    // From an older layout, with a worker at the desk that moved, or with something where it can't be: refused, and nothing changes.
    assert.match(plan.layout({ desks: {}, furniture }, 0, () => false)!, /changed/);
    assert.match(plan.layout({ desks: {}, furniture }, 1, () => true)!, /worker/);
    assert.match(plan.layout({ desks, furniture: [...furniture, { id: 'x', kind: 'sofa', x: 4, z: 4, rotY: 0 }] }, 1, () => false)!, /overlaps/);
    assert.equal(plan.state().layoutRevision, 1);
    // What's handed out is a copy.
    const copy = plan.state();
    copy.desks!['desk-1'].x = 500;
    copy.furniture![0].x = 500;
    assert.equal(plan.state().desks!['desk-1'].x, -6.75);
    assert.notEqual(plan.state().furniture![0].x, 500);
    // No paint asked for is the floor's own again.
    assert.equal(plan.layout({ desks: {}, furniture: defaults() }, 1, () => false), undefined);
    assert.equal(plan.state().look, undefined);
    assert.deepEqual(plan.state().desks, {});
  });
});

test('a saved plan that no longer fits the office loses its layout, and keeps the rest', () => {
  withDir((dir) => {
    const file = path.join(dir, 'floorplan.json');
    // Desks only, as the first builder saved them: the furniture is the office's as it comes.
    writeFileSync(file, JSON.stringify({ wing: 0, labels: {}, desks: { 'desk-1': { x: -6.75, z: -6.25, rotY: 4.71238898038469 } }, layoutRevision: 3 }));
    const old = new FloorPlanStore(dir);
    assert.deepEqual(Object.keys(old.state().desks!), ['desk-1']);
    assert.equal(old.state().furniture, undefined);
    assert.equal(old.state().layoutRevision, 3);
    assert.deepEqual(old.layoutNow().furniture, DEFAULT_FURNITURE);

    // A piece in the elevator: the whole layout goes, the sign and the back office stay.
    const bad = cleanPlan({ wing: 2, labels: { 'desk-2': { text: 'Docs', color: '#2b2d42', by: 'A', at: 1 } }, desks: {}, furniture: [{ id: 'a', kind: 'sofa', x: 8.5, z: -12, rotY: 0 }], look: 99, layoutRevision: 7 });
    assert.deepEqual([bad.wing, bad.labels['desk-2'].text, bad.desks, bad.furniture, bad.look, bad.layoutRevision], [2, 'Docs', undefined, undefined, undefined, undefined]);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).layoutRevision, 3);
  });
});
