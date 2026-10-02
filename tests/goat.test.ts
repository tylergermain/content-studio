import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dogAt, type DogState } from '../src/shared/dog.js';
import { DEFAULT_FURNITURE, kindDef, pieceRadius, type Piece } from '../src/shared/furniture.js';
import { ELEVATOR, ELEVATOR_FRONT, MEETING_ROOM, STAIRS } from '../src/shared/layout.js';
import { officeNav, type Pt } from '../src/shared/nav.js';
import { keepClearIn } from '../src/shared/office-fixed.js';
import { GOAT_PET_MS, type GoatState, type PeerInfo, type ServerMsg } from '../src/shared/protocol.js';
import { goatHome, type GoatFloor, type GoatHome } from '../src/server/goat.js';
import { APART, FOLLOW_GAP, ambleWay, asideFrom, bagsOf, buttAt, choose, dist, dogMeets, followSpot, goatNav, grazeAt, homeFloor, nibbleAt, planOdds, plantsOf, rugCorners, rugsOf, staysPut, wayTo, type GoatPlan } from '../src/server/goat-plan.js';

// Marc, the office goat: where he goes (server/goat-plan.ts) and the building's one of him (server/goat.ts).

const base = officeNav(0, undefined, DEFAULT_FURNITURE, {});
const nav = goatNav(base, {});
/** Out on the open floor, in the aisle south of the desks. */
const OPEN: Pt = [0, 7.5];
const ALL = { plants: true, people: true, rugs: true, bags: true };

/** A random number generator that's the same every run. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Every step of a way is somewhere he can stand. */
function onOpenFloor(way: Pt[], grid = nav, what = 'the way') {
  for (let i = 1; i < way.length; i++) {
    const n = Math.ceil(dist(way[i - 1], way[i]) / 0.2);
    for (let k = 0; k <= n; k++) {
      const x = way[i - 1][0] + ((way[i][0] - way[i - 1][0]) * k) / n;
      const z = way[i - 1][1] + ((way[i][1] - way[i - 1][1]) * k) / n;
      assert.ok(grid.walkable(x, z), `${what} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
}

test('he keeps out of doorways and off the stairs: none of it is floor to him', () => {
  for (const { rect, what } of keepClearIn({})) {
    const middle: Pt = [(rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2];
    assert.ok(!nav.walkable(middle[0], middle[1]), `${what} isn't somewhere he stands`);
  }
  assert.ok(base.walkable(ELEVATOR.x, ELEVATOR_FRONT + 0.6), 'the dog can stand in front of the elevator');
  for (let x = STAIRS.fromX + 0.25; x < STAIRS.toX; x += 0.5) assert.ok(!nav.walkable(x, (STAIRS.minZ + STAIRS.maxZ) / 2), `the stairs at ${x}`);
  // A floor that's all one level has no stairs, and no foot of them to keep clear of.
  const flat = goatNav(officeNav(0, undefined, DEFAULT_FURNITURE, { loft: false }), { loft: false });
  assert.ok(flat.walkable(STAIRS.fromX + 2, STAIRS.minZ + 0.9));
  assert.ok(nav.walkable(OPEN[0], OPEN[1]));
});

test('there is no way into the meeting room, whose door he keeps out of, so he never sets off for it', () => {
  const inside: Pt = [MEETING_ROOM.minX + 1.2, MEETING_ROOM.minZ + 1.6];
  assert.ok(nav.walkable(inside[0], inside[1]), 'the room itself is floor');
  assert.equal(wayTo(nav, OPEN, inside), undefined);
  // The dog, who knows no doorways, has one.
  assert.ok(wayTo(base, OPEN, inside));
});

test('ambling: somewhere a good way off, round the furniture all the way', () => {
  const rnd = seeded();
  for (let i = 0; i < 25; i++) {
    const way = ambleWay(nav, OPEN, rnd);
    assert.ok(way, 'there is somewhere to go');
    assert.deepEqual(way[0], OPEN);
    assert.ok(dist(way[way.length - 1], OPEN) >= 4, 'at least four meters off');
    onOpenFloor(way);
  }
});

test('what he does next: only what the floor has, by the roll, and never the zoomies twice running', () => {
  const plans = (was: GoatPlan | undefined, has = ALL) => planOdds(was, has).map(([p]) => p);
  assert.deepEqual(plans(undefined), ['amble', 'graze', 'look', 'nibble', 'butt', 'lie', 'zoom']);
  assert.deepEqual(plans(undefined, { plants: false, people: false, rugs: false, bags: false }), ['amble', 'lie', 'zoom']);
  assert.ok(!plans('zoom').includes('zoom'));
  assert.equal(choose(undefined, ALL, 0), 'amble');
  assert.equal(choose(undefined, ALL, 0.999), 'zoom');
  assert.equal(choose('zoom', ALL, 0.999), 'lie');
  // Mostly he ambles and grazes; what he just did is less likely again.
  const odds = (was: GoatPlan | undefined) => Object.fromEntries(planOdds(was, ALL));
  assert.ok(odds(undefined).graze >= odds(undefined).look && odds(undefined).graze > odds(undefined).zoom);
  for (const p of ['amble', 'graze', 'look', 'nibble', 'butt', 'lie'] as const) assert.ok(odds(p)[p] < odds(undefined)[p], `${p} again is less likely`);
  // Every roll lands on something he can do.
  const rnd = seeded(3);
  const seen = new Set<GoatPlan>();
  for (let i = 0; i < 400; i++) seen.add(choose(undefined, ALL, rnd()));
  assert.deepEqual([...seen].sort(), ['amble', 'butt', 'graze', 'lie', 'look', 'nibble', 'zoom']);
});

test('grazing: up to a plant he can get to, round the furniture, then in until his mouth is over its pot', () => {
  const plants = plantsOf(DEFAULT_FURNITURE, 0);
  assert.equal(plants.length, 8);
  assert.ok(plants.every((p) => kindDef(p.kind).group === 'Plants'));
  let reached = 0;
  for (const plant of plants) {
    const e = grazeAt(nav, plant, OPEN);
    if (!e) continue;
    reached++;
    assert.equal(e.piece, plant.id);
    const end = e.path[e.path.length - 1];
    const far = dist(end, [plant.x, plant.z]);
    // His mouth is half a meter ahead of him: over the pot, his chest clear of it.
    assert.ok(far > pieceRadius(plant) + 0.25 && far < pieceRadius(plant) + 0.5, `${plant.id}: he stops ${far.toFixed(2)} from its middle`);
    assert.ok(Math.abs(Math.atan2(plant.x - end[0], plant.z - end[1]) - e.face) < 0.2, `${plant.id}: he faces it`);
    // All but the last step in is open floor.
    onOpenFloor(e.path.slice(0, -1), nav, `the way to ${plant.id}`);
  }
  assert.ok(reached >= 6, `he can get to ${reached} of the 8 plants`);
  // With the back office built out, the plants in its way are put away: nothing to graze on there.
  assert.ok(plantsOf(DEFAULT_FURNITURE, 1).length < plants.length);
});

test('mischief: he nibbles the nearest corner of a rug from off the rug, and butts the punching bag from its front or back', () => {
  const rugs = rugsOf(DEFAULT_FURNITURE, 0);
  assert.equal(rugs.length, 5);
  const rug = rugs.find((r) => r.id === 'lounge-rug')!;
  const e = nibbleAt(nav, rug, OPEN);
  assert.ok(e);
  const end = e.path[e.path.length - 1];
  const corner = rugCorners(rug).find((c) => Math.abs(dist(end, c) - 0.5) < 0.02);
  assert.ok(corner, 'his mouth is on one of its corners');
  assert.ok(Math.abs(end[0] - rug.x) > 3.5 || Math.abs(end[1] - rug.z) > 3.5, 'and he stands off it');
  assert.ok(rugCorners(rug).every((c) => dist(c, OPEN) >= dist(corner, OPEN) - 1e-9), 'the nearest corner');
  assert.equal(rugCorners({ id: 'r', kind: 'rug-round', x: 0, z: 0, rotY: 0 }).length, 4);

  const bag: Piece = { id: 'bag', kind: 'punching-bag', x: 2, z: 9.5, rotY: 0 };
  const furniture = [...DEFAULT_FURNITURE, bag];
  assert.deepEqual(bagsOf(furniture, 0), [bag]);
  assert.deepEqual(bagsOf(DEFAULT_FURNITURE, 0), []);
  const withBag = goatNav(officeNav(0, undefined, furniture, {}), {});
  const butt = buttAt(withBag, bag, OPEN);
  assert.ok(butt);
  const stand = butt.path[butt.path.length - 1];
  // Square on to it, his nose just short of the bag, on the side he came from (its back, from the north).
  assert.ok(Math.abs(stand[0] - bag.x) < 0.01 && Math.abs(Math.abs(stand[1] - bag.z) - 0.8) < 0.01, `he stands at ${stand}`);
  assert.ok(stand[1] < bag.z, 'on the side he came from');
  assert.equal(butt.piece, 'bag');
});

test('following: a polite distance behind them, beside that where the dog sits, and no circling someone who only turns round', () => {
  const p = { x: 0, z: 7.5, rotY: Math.PI / 2, moving: false };
  const spot = followSpot(nav, p);
  assert.ok(Math.abs(spot[0] + FOLLOW_GAP) < 1e-9 && Math.abs(spot[1] - 7.5) < 1e-9, 'straight behind someone facing +x');
  assert.ok(FOLLOW_GAP >= 1.5, 'further back than the dog (1.1)');
  // The dog sits at their heel: he goes beside it, as far from them, and clear of it.
  const dog: Pt = [-1.1, 7.5];
  const beside = followSpot(nav, p, dog);
  assert.ok(Math.abs(dist(beside, [p.x, p.z]) - FOLLOW_GAP) < 1e-9);
  assert.ok(dist(beside, dog) >= APART + 0.3, `he keeps ${dist(beside, dog).toFixed(2)} from the dog`);
  // Someone backed up against a wall: the nearest place he can stand.
  const cornered = followSpot(nav, { x: -17.5, z: 0, rotY: Math.PI / 2, moving: false });
  assert.ok(nav.walkable(cornered[0], cornered[1]));

  // Standing near them while they stand: he stays, even when they turn round. Once they walk off, he goes.
  assert.ok(staysPut([-1.8, 7.5], p, spot));
  assert.ok(staysPut([-1.8, 7.5], { ...p, rotY: -Math.PI / 2 }, followSpot(nav, { ...p, rotY: -Math.PI / 2 })));
  assert.ok(!staysPut([-1.8, 7.5], { ...p, x: 6, moving: true }, followSpot(nav, { ...p, x: 6, moving: true })));
  assert.ok(!staysPut([-6, 7.5], p, spot), 'too far behind to stay');
});

test('he and the dog: he sees it coming, lets it by, and steps out of its way where he stands in it', () => {
  const still = (at: Pt) => ({ path: [at], speed: 0 });
  const walk = (from: Pt, to: Pt, speed = 1.3) => ({ path: [from, to], speed });
  // The dog trots straight at where he stands: they'd meet in about two seconds.
  const hit = dogMeets(still([0, 7.5]), 0, walk([4, 7.5], [-4, 7.5]), 0, 3);
  assert.ok(hit !== undefined && hit > 2 && hit < 2.8, `in ${hit} s`);
  assert.equal(dogMeets(still([0, 7.5]), 0, walk([4, 7.5], [-4, 7.5]), 0, 1.2), undefined, 'not within the next second');
  assert.equal(dogMeets(still([0, 9.5]), 0, walk([4, 7.5], [-4, 7.5]), 0, 6), undefined, 'two meters to the side, it goes by');
  assert.equal(dogMeets(still([0, 7.5]), 0, still([0.4, 7.5]), 0, 1), 0, 'the dog lay down right beside him');
  // Crossing paths: both walking, they'd be in the same place at the same time.
  assert.ok(dogMeets(walk([0, 4.5], [0, 10.5], 0.9), 2.5, walk([3.6, 7.5], [-4, 7.5]), 1.5, 0.9, true) !== undefined);
  // Beside it already but walking away from it: that's let be, or he'd never get away.
  assert.equal(dogMeets(walk([0, 3], [0, 9], 0.9), 0, still([0.3, 2.7]), 0, 0.9, true), undefined);
  assert.ok(dogMeets(walk([0, 3], [0, 9], 0.9), 0, still([0, 4.2]), 0, 0.9, true) !== undefined, 'but not walking into it');

  // Stepping aside: somewhere near he can stand that the dog doesn't come by, nor end up at.
  const dog = walk([4, 7.5], [-4, 7.5]);
  const aside = asideFrom(nav, OPEN, dog, 0, 4);
  assert.ok(aside);
  assert.ok(nav.walkable(aside[0], aside[1]));
  assert.ok(dist(aside, OPEN) <= 2.6 + 1e-9, 'not far');
  for (let t = 0; t <= 6.2; t += 0.1) {
    const d = dogAt(dog, t);
    assert.ok(dist(aside, [d.x, d.z]) > APART, `the dog passes ${dist(aside, [d.x, d.z]).toFixed(2)} from him at ${t.toFixed(1)} s`);
  }
  // Where the dog is settled, or headed, isn't floor to him: his ways go round it.
  const round = goatNav(base, {}, [OPEN]);
  assert.ok(!round.walkable(0.3, 7.8) && round.walkable(1.2, 7.5));
  assert.equal(wayTo(nav, [-3, 7.5], [3, 7.5])?.length, 2, 'straight there with no dog in the way');
  const way = wayTo(round, [-3, 7.5], [3, 7.5]);
  assert.ok(way && way.length > 2, 'round the dog, not through it');
  onOpenFloor(way, round);
});

test('which floor he lives on: the one he last rode to while the building has it, else the bottom one', () => {
  assert.equal(homeFloor(['friday-labs', 'ai-innovators', 'content']), 'friday-labs');
  assert.equal(homeFloor(['friday-labs', 'ai-innovators', 'content'], 'content'), 'content');
  assert.equal(homeFloor(['friday-labs', 'ai-innovators'], 'content'), 'friday-labs', 'a floor taken off the building');
  assert.equal(homeFloor([]), undefined);
  assert.equal(homeFloor([], 'content'), undefined);
});

// ---- The building's one goat ----------------------------------------------------------------------------

const DOG: DogState = { name: 'Rex', coat: 0, breed: 'pup', path: [[16, 1.6]], speed: 0, elapsed: 60_000, act: 'lie' };
/** The dog on every floor of a test building: lying in the lounge, until a test sets it walking. */
let dog: () => DogState = () => DOG;
const person = (id: string, floor: string, x: number, z: number, extra: Partial<PeerInfo> = {}): PeerInfo => ({ id, name: id, color: '#fff', look: {} as PeerInfo['look'], x, y: 0, z, rotY: 0, moving: false, voice: false, muted: false, sharing: false, floor, ...extra });

/** A building of `ids` floors with a goat, on the test's clock: who's on each floor, and what each was last told of him. */
function building(t: TestContext, ids: string[], dirs?: Map<string, string>) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  const people = new Map<string, PeerInfo[]>(ids.map((id) => [id, []]));
  const told = new Map<string, (GoatState | null)[]>(ids.map((id) => [id, []]));
  const where = dirs ?? new Map(ids.map((id) => [id, mkdtempSync(path.join(os.tmpdir(), `goat-${id}-`))]));
  const ctx = {
    peers: (f: GoatFloor) => people.get(f.id) ?? [],
    emit: (f: GoatFloor, msg: ServerMsg) => void (msg.t === 'goat' && told.get(f.id)?.push(msg.goat)),
  };
  const homes = new Map<string, GoatHome>();
  const open = (id: string) => {
    const floor: GoatFloor = { id, dog: { view: () => dog() }, plan: { wing: 0, layoutNow: () => ({ desks: {}, furniture: DEFAULT_FURNITURE, room: {}, revision: 0 }) } };
    homes.set(id, goatHome(floor, ctx, where.get(id)!));
  };
  for (const id of ids) open(id);
  t.after(() => {
    dog = () => DOG;
    for (const h of homes.values()) h.stop();
    if (!dirs) for (const d of where.values()) rmSync(d, { recursive: true, force: true });
  });
  const last = (id: string) => told.get(id)!.at(-1);
  /** A tenth of a second at a time: the clock a timer sees is where the whole tick ends. */
  const tick = (ms: number) => {
    for (let left = ms; left > 0; left -= 100) t.mock.timers.tick(Math.min(100, left));
  };
  return { people, told, homes, dirs: where, last, tick, view: (id: string) => homes.get(id)!.view() };
}

/** Where a state has him now. */
const at = (g: GoatState): Pt => {
  const p = dogAt(g, g.elapsed / 1000);
  return [p.x, p.z];
};

test('the building has one goat, on its bottom floor: standing somewhere he can, and off on his day by himself', (t) => {
  const b = building(t, ['one', 'two', 'three']);
  const marc = b.view('one');
  assert.ok(marc, 'he lives on the first floor');
  assert.equal(b.view('two'), null);
  assert.equal(b.view('three'), null);
  assert.equal(marc.act, 'stand');
  assert.equal(marc.pets, 0);
  assert.ok(nav.walkable(...at(marc)), 'out of the doorways, off the furniture');
  // A few seconds on he sets off; whatever he does, his floor is told and the others aren't.
  b.tick(7000);
  assert.ok(b.told.get('one')!.length >= 1);
  assert.equal(b.told.get('two')!.length, 0);
  for (let i = 0; i < 40; i++) {
    b.tick(3000);
    const g = b.view('one')!;
    for (let k = 1; k < g.path.length - 1; k++) assert.ok(nav.walkable(g.path[k][0], g.path[k][1]), `${g.act}: a corner of his way at ${g.path[k]}`);
    if (g.act === 'graze') assert.ok(g.piece?.startsWith('plant-'));
    if (g.act === 'nibble') assert.ok(g.piece?.includes('rug'));
  }
});

test('a pat: only from someone on his floor within reach, rate-limited; he turns to them, then follows them for about a minute', (t) => {
  const b = building(t, ['one', 'two']);
  const here = at(b.view('one')!);
  const ada = person('ada', 'one', here[0] + 1.5, here[1]);
  b.people.get('one')!.push(ada);
  assert.equal(b.homes.get('two')!.pet(ada), false, "he isn't on that floor");
  assert.equal(b.homes.get('one')!.pet(person('bo', 'one', here[0] + 6, here[1])), false, 'out of reach');
  assert.equal(b.homes.get('one')!.pet(person('cy', 'one', here[0] + 1, here[1], { y: 3 })), false, 'up in the loft');
  assert.equal(b.homes.get('one')!.pet(person('di', 'two', here[0] + 1, here[1])), false, 'on another floor');
  assert.equal(b.homes.get('one')!.pet(ada), true);
  const pet = b.last('one')!;
  assert.equal(pet.act, 'pet');
  assert.equal(pet.petBy, 'ada');
  assert.equal(pet.pets, 1);
  assert.ok(Math.abs(pet.face! - Math.PI / 2) < 1e-6, 'he turns to her');
  assert.equal(b.homes.get('one')!.pet(ada), false, 'again straight away is too soon');
  b.tick(450);
  assert.equal(b.homes.get('one')!.pet(ada), true);
  assert.equal(b.last('one')!.pets, 2);
  // Once the pat is over he tags along: when she walks off, he comes after her and stops a polite way off.
  b.tick(GOAT_PET_MS + 50);
  assert.equal(b.last('one')!.following, 'ada');
  Object.assign(ada, { x: 0, z: 7.5, rotY: Math.PI / 2 });
  b.tick(20_000);
  const g = b.view('one')!;
  assert.equal(g.following, 'ada');
  assert.equal(g.watching, 'ada');
  const gap = dist(at(g), [ada.x, ada.z]);
  assert.ok(gap > 1 && gap < FOLLOW_GAP + 0.8, `he stands ${gap.toFixed(2)} from her`);
  // About a minute after the pat he wanders off.
  b.tick(60_000);
  assert.equal(b.view('one')!.following, undefined);
});

test('the elevator: someone who may not lead him he sees off at the doors, and stays', (t) => {
  const b = building(t, ['one', 'two']);
  const here = at(b.view('one')!);
  const bo = person('bo', 'one', here[0] + 1, here[1]);
  b.people.get('one')!.push(bo);
  assert.ok(b.homes.get('one')!.pet(bo));
  b.tick(GOAT_PET_MS + 50);
  assert.equal(b.last('one')!.following, 'bo');
  b.people.set('one', []);
  b.people.get('two')!.push(Object.assign(bo, { floor: 'two', x: ELEVATOR.x, z: ELEVATOR_FRONT + 3 }));
  b.tick(1000);
  const off = b.last('one')!;
  assert.equal(off.riding, undefined);
  assert.equal(off.following, undefined);
  const end = off.path[off.path.length - 1];
  assert.ok(Math.abs(end[0] - ELEVATOR.x) < 1 && end[1] > ELEVATOR_FRONT + 1.4, `he goes to stand in front of the elevator (${end}), out of its doorway`);
  b.tick(40_000);
  assert.ok(b.view('one'), 'still on his own floor');
  assert.equal(b.view('two'), null);
  assert.ok(!existsSync(path.join(b.dirs.get('one')!, 'goat.json')));
});

test('the elevator: he rides after an admin he follows to their floor, lives there from then on, and a restart finds him there', (t) => {
  const b = building(t, ['one', 'two']);
  const here = at(b.view('one')!);
  const ada = person('ada', 'one', here[0] + 1, here[1]);
  b.people.get('one')!.push(ada);
  assert.ok(b.homes.get('one')!.pet(ada, true));
  b.tick(GOAT_PET_MS + 50);
  // She takes the elevator to the second floor.
  b.people.set('one', []);
  b.people.get('two')!.push(Object.assign(ada, { floor: 'two', x: ELEVATOR.x, z: ELEVATOR_FRONT + 3 }));
  b.tick(1000);
  const riding = b.last('one')!;
  assert.equal(riding.riding, true);
  const car = riding.path[riding.path.length - 1];
  assert.ok(Math.abs(car[0] - ELEVATOR.x) < 0.01 && car[1] < ELEVATOR_FRONT, 'he walks into the car');
  b.tick(30_000);
  assert.equal(b.last('one'), null, 'the floor he left is told he has gone');
  assert.equal(b.view('one'), null);
  const marc = b.view('two');
  assert.ok(marc, 'he lives on the second floor now');
  assert.equal(marc.following, 'ada');
  assert.equal(marc.pets, 1, 'the same goat');
  assert.deepEqual(JSON.parse(readFileSync(path.join(b.dirs.get('one')!, 'goat.json'), 'utf8')), { floor: 'two' });
  assert.ok(!existsSync(path.join(b.dirs.get('two')!, 'goat.json')), "it's the bottom floor that remembers");

  // The office restarts: he's where he was.
  for (const h of b.homes.values()) h.stop();
  t.mock.timers.reset();
  const again = building(t, ['one', 'two'], b.dirs);
  assert.equal(again.view('one'), null);
  assert.ok(again.view('two'));
  // His floor is taken off the building: back to the bottom one, where everyone sees him turn up.
  again.homes.get('two')!.stop();
  again.tick(10);
  assert.ok(again.view('one'));
  assert.ok(again.last('one'));
  for (const d of b.dirs.values()) rmSync(d, { recursive: true, force: true });
});

test('the dog trots, then runs, straight through where he stands: both times he is out of its way before it gets there', (t) => {
  const b = building(t, ['one']);
  b.people.get('one')!.push(person('ada', 'one', 0, 0));
  for (const speed of [1.3, 3.4]) {
    const here = at(b.view('one')!);
    // From five meters to one side of him to five the other: the dog knows nothing of him.
    const began = Date.now();
    dog = () => ({ ...DOG, path: [[here[0] - 5, here[1]], [here[0] + 5, here[1]]], speed, act: 'sniff', elapsed: Date.now() - began });
    let nearest = Infinity;
    for (let ms = 0; ms < 10_000 / speed + 500; ms += 50) {
      b.tick(50);
      const d = dogAt(dog(), dog().elapsed / 1000);
      nearest = Math.min(nearest, dist(at(b.view('one')!), [d.x, d.z]));
    }
    assert.ok(nearest > 0.7, `at ${speed} m/s the dog came within ${nearest.toFixed(2)} of him`);
    assert.ok(nav.walkable(...at(b.view('one')!)), 'and he stepped aside to somewhere he can stand');
    dog = () => DOG;
    b.tick(3000);
  }
});
