// The Steps (shared/steps.ts): a six-tier amphitheatre across the lounge, for a floor that asks for it.
// Its numbers, what the rules and the paths make of it, where there is to sit on it, and the walk up
// and down it with the real PlayerController over the same list of solids the 3D office builds from.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { PlayerController } from '../src/client/player/index.js';
import type { Collider } from '../src/client/world/types.js';
import { FloorPlanStore } from '../src/server/floorplan.js';
import { ROOM_DEFAULTS, cleanPlan, type RoomOptions } from '../src/shared/floorplan.js';
import { DEFAULT_FURNITURE, floorSeat, type Piece } from '../src/shared/furniture.js';
import { BEANBAGS, DESKS, FLOOR, POLE, POLES, SLAB, TV, seatPlace } from '../src/shared/layout.js';
import { deskPoint, officeNav } from '../src/shared/nav.js';
import { layoutProblems, problemAt, structureProblem } from '../src/shared/office-builder.js';
import { FIXED, KEEP_CLEAR, fixedIn, keepClearIn } from '../src/shared/office-fixed.js';
import { STEPS, STEPS_RECT, STEPS_TOP, hasSteps, onSteps, stepsSeats, stepsSolids } from '../src/shared/steps.js';

const WITH_STEPS = { steps: true } as const;
const defaults = (): Piece[] => DEFAULT_FURNITURE.map((p) => ({ ...p }));
/** The office's furniture that's where the Steps go: the lounge. */
const LOUNGE = ['lounge-rug', 'couch', 'coffee-table', 'lounge-beanbag-1', 'lounge-beanbag-2'];

/** The office floor: upstairs, over the garage, so off it you'd drop to the street. */
const officeFloor: Collider = { ...FLOOR, bottom: -SLAB, top: 0 };

function controller(t: TestContext, colliders: Collider[]) {
  const win = new EventTarget();
  const doc = new EventTarget();
  for (const [name, value] of [['window', win], ['document', doc]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const player = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement, [officeFloor, ...colliders]);
  player.camYaw = 0;
  function keys(...codes: string[]) {
    player.clearKeys();
    for (const code of codes) {
      const event = new Event('keydown');
      Object.defineProperty(event, 'code', { value: code });
      win.dispatchEvent(event);
    }
  }
  function frames(count: number, dt = 1 / 60) {
    for (let i = 0; i < count; i++) player.update(dt);
  }
  return { player, keys, frames };
}

test('a floor has the Steps only when it says so', () => {
  assert.deepEqual([hasSteps(), hasSteps({}), hasSteps(ROOM_DEFAULTS), hasSteps({ steps: false }), hasSteps(WITH_STEPS), hasSteps({ ...ROOM_DEFAULTS, steps: true })], [false, false, false, false, true, true]);
  assert.deepEqual(STEPS, { east: 13.5, west: 9, minZ: -4.4, maxZ: 4.4, tiers: 6, run: 0.75, rise: 0.28, rail: 1.05, wall: 0.1 });
  assert.deepEqual(STEPS_RECT, [8.9, 13.5, -4.5, 4.5]);
  assert.ok(Math.abs(STEPS_TOP - 1.68) < 1e-9);
  // Six tiers take it exactly from the bottom riser back to the wall.
  assert.ok(Math.abs(STEPS.east - STEPS.tiers * STEPS.run - STEPS.west) < 1e-9);
  assert.ok(onSteps(11, 0) && onSteps(8.95, 4.45) && !onSteps(13.6, 0) && !onSteps(11, 4.6) && !onSteps(8.8, 0));
  // Each tier is under what a walker steps up without jumping (STEP in client/player/collide.ts is 0.3).
  assert.ok(STEPS.rise < 0.3);
});

test('what you bump into of the Steps: six tiers, the back wall, and a stepped wall down each side', () => {
  const solids = stepsSolids();
  assert.equal(solids.length, 19);
  const tiers = solids.slice(0, 6);
  tiers.forEach((s, i) => {
    assert.ok(Math.abs(s.maxX - (13.5 - i * 0.75)) < 1e-9 && Math.abs(s.minX - (13.5 - (i + 1) * 0.75)) < 1e-9, JSON.stringify(s));
    assert.deepEqual([s.minZ, s.maxZ, s.bottom], [-4.4, 4.4, undefined], 'solid from the floor up');
    assert.ok(Math.abs(s.top - (i + 1) * 0.28) < 1e-9);
  });
  const back = solids[6];
  assert.ok(Math.abs(back.minX - 8.9) < 1e-9 && back.maxX === 9 && Math.abs(back.minZ + 4.5) < 1e-9 && Math.abs(back.maxZ - 4.5) < 1e-9 && Math.abs(back.top - 2.73) < 1e-9, JSON.stringify(back));
  // A side wall's box beside every tier, a rail's height over it.
  for (const [n, side] of [solids.slice(7, 13), solids.slice(13)].entries()) {
    side.forEach((s, i) => {
      assert.deepEqual([s.minX, s.maxX], [tiers[i].minX, tiers[i].maxX]);
      assert.ok(Math.abs(s.top - (tiers[i].top + 1.05)) < 1e-9);
      // The north one outside z -4.4, the south one outside z 4.4, each 0.1 thick.
      const [from, to] = n === 0 ? [-4.5, -4.4] : [4.4, 4.5];
      assert.ok(Math.abs(s.minZ - from) < 1e-9 && Math.abs(s.maxZ - to) < 1e-9, JSON.stringify(s));
    });
  }
  // All of it is inside the floor it takes.
  const [minX, maxX, minZ, maxZ] = STEPS_RECT;
  for (const s of solids) assert.ok(s.minX >= minX - 1e-9 && s.maxX <= maxX + 1e-9 && s.minZ >= minZ - 1e-9 && s.maxZ <= maxZ + 1e-9, JSON.stringify(s));
  // A fresh list each time, for whoever keeps it.
  assert.notEqual(stepsSolids(), solids);
  assert.deepEqual(stepsSolids(), solids);
});

test('a bench on every tier: three places facing the TV, your feet on the tier below', () => {
  const seats = stepsSeats();
  assert.deepEqual(seats.map((s) => s.id), ['steps-1', 'steps-2', 'steps-3', 'steps-4', 'steps-5', 'steps-6']);
  seats.forEach((s, i) => {
    // On the tier's front edge, 0.2 back from its riser, feet on the one below (the floor, for the first).
    assert.ok(Math.abs(s.x - (13.5 - i * 0.75 - 0.2)) < 1e-9, `${s.id} at x ${s.x}`);
    assert.ok(Math.abs(s.y - i * 0.28) < 1e-9, `${s.id} at y ${s.y}`);
    assert.deepEqual([s.z, s.rotY, s.places, s.tv, s.out, s.depth], [0, Math.PI / 2, [-2.9, 0, 2.9], true, 0.55, 0]);
    // You sit on the tier itself, 0.28 over your feet.
    assert.ok(s.hips > STEPS.rise && s.hips < STEPS.rise + 0.2);
    assert.ok(!s.roof && !s.game && !s.bar && !s.share);
    // Its three places are along the tier, inside the side walls, and face the screen.
    const places = s.places.map((_, n) => seatPlace(s, n));
    assert.deepEqual(places.map((p) => Math.round(p.z * 10) / 10).sort((a, b) => a - b), [-2.9, 0, 2.9]);
    for (const p of places) {
      assert.ok(Math.abs(p.x - s.x) < 1e-9 && p.y === s.y && p.z > STEPS.minZ + 1 && p.z < STEPS.maxZ - 1);
      assert.ok(Math.sin(p.rotY) * (TV.x - p.x) > 0, 'facing east, to the TV');
      // Getting up puts you a stride in front: on the tier below, or the floor in front of the bottom one.
      const out = p.x + p.out;
      assert.ok(i === 0 ? out > STEPS.east : out > 13.5 - i * 0.75 && out < 13.5 - (i - 1) * 0.75, `${s.id} gets up to x ${out}`);
    }
  });
  assert.equal(new Set(seats.flatMap((s) => s.places.map((_, n) => seatPlace(s, n).key))).size, 18);

  // They're there to sit on only on a floor that has the Steps.
  for (const s of seats) {
    assert.deepEqual(floorSeat(DEFAULT_FURNITURE, 0, s.id, WITH_STEPS), s);
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, s.id), undefined);
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, s.id, { mezzanine: 'none' }), undefined);
  }
  assert.equal(floorSeat(DEFAULT_FURNITURE, 0, 'steps-7', WITH_STEPS), undefined);
  // The office's other seats are where they were, with the Steps or without.
  for (const id of ['bench', 'boss-chair', 'roof-sofa-1']) assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id, WITH_STEPS)?.id, id);
  // A piece of furniture called the same comes first, as any piece does.
  const pouf: Piece = { id: 'steps-1', kind: 'pouf', x: 0, z: 0, rotY: 0 };
  assert.equal(floorSeat([pouf], 0, 'steps-1', WITH_STEPS)?.x, 0);
});

test("the Steps are built in on a floor that has them: one block, where the lounge was", () => {
  const names = (room?: RoomOptions) => [...fixedIn(room).rects, ...fixedIn(room).circles, ...keepClearIn(room)].map((f) => f.what);
  assert.ok(!names().includes('the Steps'));
  assert.deepEqual(names(WITH_STEPS).filter((w) => w !== 'the Steps'), names(), 'nothing else moves');
  assert.deepEqual(fixedIn(WITH_STEPS).rects.at(-1), { rect: [8.9, 13.5, -4.5, 4.5], what: 'the Steps' });
  assert.equal(keepClearIn(WITH_STEPS).length, KEEP_CLEAR.length);
  assert.notEqual(fixedIn(WITH_STEPS), FIXED);
  assert.equal(fixedIn({ steps: false }), FIXED);
  assert.equal(fixedIn({ ...WITH_STEPS, ceiling: 'banners', tees: 2 }), fixedIn(WITH_STEPS));
  // They stand clear of the fire pole's railing, the loft, the big mezzanine and the elevator.
  for (const p of POLES) assert.ok(p.x + POLE.rail + 1 < STEPS_RECT[0], 'a meter and more between the pole and the back wall');
  for (const room of [WITH_STEPS, { ...WITH_STEPS, mezzanine: 'big', flights: 2 }, { ...WITH_STEPS, mezzanine: 'none', meeting: 'forum' }, { ...WITH_STEPS, meeting: 'desk' }] as RoomOptions[]) {
    const others = fixedIn(room).rects.filter((f) => f.what !== 'the Steps');
    for (const f of others) assert.ok(f.rect[0] >= STEPS_RECT[1] || f.rect[1] <= STEPS_RECT[0] || f.rect[2] >= STEPS_RECT[3] || f.rect[3] <= STEPS_RECT[2], `${f.what} in ${JSON.stringify(room)}`);
  }

  // The office's lounge is where they go, and nothing else of the office is: no desk, and no bean bag's spot.
  const office = { desks: {}, furniture: defaults() };
  assert.deepEqual([...layoutProblems(office, WITH_STEPS).keys()], ['couch', 'coffee-table', 'lounge-beanbag-1']);
  assert.equal(structureProblem(office, {}, WITH_STEPS), 'Clear the floor for the Steps first: Sofa is in the way of the Steps');
  assert.equal(structureProblem(office, {}, { ...WITH_STEPS, mezzanine: 'none' }), 'Clear the floor for the Steps first: Sofa is in the way of the Steps');
  const cleared = { desks: {}, furniture: defaults().filter((p) => !LOUNGE.includes(p.id)) };
  assert.equal(structureProblem(cleared, {}, WITH_STEPS), undefined);
  // Taking them away again is never refused, and a rug or a sign can lie in under them.
  assert.equal(structureProblem(cleared, WITH_STEPS, {}), undefined);
  assert.equal(problemAt({ desks: {}, furniture: [{ id: 'new', kind: 'rug', x: 11, z: 0, rotY: 0 }] }, 'new', WITH_STEPS), undefined);
  assert.match(problemAt({ desks: {}, furniture: [{ id: 'new', kind: 'armchair', x: 11, z: 0, rotY: 0 }] }, 'new', WITH_STEPS)!, /^Armchair is in the way of the Steps$/);
  assert.equal(problemAt({ desks: {}, furniture: [{ id: 'new', kind: 'armchair', x: 11, z: 0, rotY: 0 }] }, 'new'), undefined);

  // Whoever walks the floor by its grid goes round them: the block is shut, the stage in front and the aisles beside it are open.
  const nav = officeNav(0, undefined, cleared.furniture, WITH_STEPS);
  const flat = officeNav(0, undefined, cleared.furniture);
  for (const [x, z] of [[11, 0], [9.2, -4.2], [13.2, 4.2]]) {
    assert.equal(nav.walkable(x, z), false, `(${x}, ${z}) on the Steps`);
    assert.equal(flat.walkable(x, z), true);
  }
  for (const [x, z] of [[14.6, 0], [11, -5.4], [11, 5.4], [8.2, 3.5]]) assert.equal(nav.walkable(x, z), true, `(${x}, ${z}) beside the Steps`);
  // Every desk and bean bag still has a side a worker can walk in by.
  for (const seat of [...DESKS, ...BEANBAGS]) assert.ok([-1, 1].some((side) => nav.walkable(...deskPoint(seat, side * 0.7, 1.75))), seat.id);
});

test('a floor saves the Steps with its layout, and a plan with no layout loses the lounge to them', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-studio-steps-'));
  try {
    const plan = new FloorPlanStore(dir);
    const free = () => false;
    const cleared = defaults().filter((p) => !LOUNGE.includes(p.id));
    assert.equal(plan.seat('steps-3'), undefined);
    assert.equal(plan.layout({ desks: {}, furniture: defaults(), room: WITH_STEPS }, 0, free), 'Clear the floor for the Steps first: Sofa is in the way of the Steps');
    assert.equal(plan.layout({ desks: {}, furniture: cleared, room: WITH_STEPS }, 0, free), undefined);
    assert.deepEqual(plan.state().room, WITH_STEPS);
    assert.deepEqual(plan.layoutNow().room, { ...ROOM_DEFAULTS, steps: true });
    assert.equal(plan.seat('steps-3')?.y, 2 * STEPS.rise);
    const again = new FloorPlanStore(dir);
    assert.deepEqual(again.state().room, WITH_STEPS);
    assert.equal(again.seat('steps-6')?.id, 'steps-6');
    // Without them again, nobody sits there.
    assert.equal(again.layout({ desks: {}, furniture: cleared }, 1, free), undefined);
    assert.equal(again.seat('steps-6'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const bare = cleanPlan({ room: WITH_STEPS });
  assert.deepEqual(bare.room, WITH_STEPS);
  assert.deepEqual(bare.furniture?.map((p) => p.id), defaults().filter((p) => !['couch', 'coffee-table', 'lounge-beanbag-1'].includes(p.id)).map((p) => p.id));
  assert.equal(layoutProblems({ desks: {}, furniture: bare.furniture! }, bare.room).size, 0);
});

// ---- Walking them -------------------------------------------------------------------------------

test('walk straight up the Steps from the stage, at a walk and at a sprint', (t) => {
  for (const sprint of [false, true]) {
    const { player, keys, frames } = controller(t, stepsSolids());
    player.pos.set(14.4, 0, 0.5);
    keys(...(sprint ? ['KeyA', 'ShiftLeft'] : ['KeyA']));
    frames(sprint ? 40 : 300, sprint ? 0.05 : 1 / 60);
    assert.ok(Math.abs(player.pos.y - STEPS_TOP) < 1e-6, `not at the top ${sprint ? 'at a sprint' : 'at a walk'}: ${player.pos.toArray()}`);
    assert.ok(player.pos.x > STEPS.west && player.pos.x < STEPS.west + STEPS.run, `walked through the back wall: ${player.pos.x}`);
  }
});

test('getting up off a tier puts you on the one below, clear of the riser behind you', (t) => {
  const { player, keys, frames } = controller(t, stepsSolids());
  for (const seat of stepsSeats()) {
    for (const n of [0, 1, 2]) {
      const place = seatPlace(seat, n);
      player.sit(place);
      keys();
      frames(10);
      // Straight out in front, the first place it tries.
      const spot = player.standingSpot();
      assert.ok(spot && Math.abs(spot.x - (place.x + place.out)) < 1e-9 && spot.y === place.y && Math.abs(spot.z - place.z) < 1e-9, `${place.key} has room in front`);
      keys('Space');
      frames(1);
      keys();
      frames(60);
      assert.equal(player.seat, null);
      assert.ok(Math.abs(player.pos.y - place.y) < 0.01 && player.pos.x > place.x + 0.5, `${place.key} got up to ${player.pos.toArray().map((v) => v.toFixed(2))}`);
    }
  }
});

test('along a tier of the Steps, then back down to the floor', (t) => {
  const { player, keys, frames } = controller(t, stepsSolids());
  player.pos.set(11.6, 3 * STEPS.rise, 3.5);
  player.vy = 0;
  player.grounded = true;
  keys('KeyW');
  frames(200);
  assert.ok(Math.abs(player.pos.y - 3 * STEPS.rise) < 1e-6 && player.pos.z < -3.5 && player.pos.z > STEPS.minZ, `fell off the tier or through its side wall: ${player.pos.toArray()}`);
  keys('KeyD');
  frames(75);
  assert.ok(Math.abs(player.pos.y) < 1e-6 && player.pos.x > STEPS.east && player.pos.x < FLOOR.maxX, `not back on the floor: ${player.pos.toArray()}`);
});

test('the side walls and the back of the Steps hold: nobody walks into the block from the floor, or off its top', (t) => {
  const { player, keys, frames } = controller(t, stepsSolids());
  // From the north side.
  player.pos.set(11, 0, -6);
  keys('KeyS');
  frames(200);
  assert.ok(player.pos.z < STEPS.minZ - STEPS.wall && player.pos.y === 0, `walked in at the side: ${player.pos.toArray()}`);
  // From the south side.
  player.pos.set(11, 0, 6);
  keys('KeyW');
  frames(200);
  assert.ok(player.pos.z > STEPS.maxZ + STEPS.wall && player.pos.y === 0, `walked in at the other side: ${player.pos.toArray()}`);
  // From behind.
  player.pos.set(7.9, 0, 0);
  keys('KeyD');
  frames(200);
  assert.ok(player.pos.x < STEPS.west - STEPS.wall && player.pos.y === 0, `walked in at the back: ${player.pos.toArray()}`);
  // Up on the top tier: not off the back, and not off either end.
  for (const [code, check] of [
    ['KeyA', () => player.pos.x > STEPS.west],
    ['KeyW', () => player.pos.z > STEPS.minZ],
    ['KeyS', () => player.pos.z < STEPS.maxZ],
  ] as const) {
    player.pos.set(9.4, STEPS_TOP, 0);
    player.vy = 0;
    player.grounded = true;
    keys(code);
    frames(300);
    assert.ok(check() && Math.abs(player.pos.y - STEPS_TOP) < 1e-6, `${code} took them off the top tier: ${player.pos.toArray()}`);
  }
});
