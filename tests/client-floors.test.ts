import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_PALETTES, floorPalette } from '../src/shared/floors.js';
import { FLOOR, WING, WING_DESKS, wingMinZ } from '../src/shared/layout.js';
import type { FloorInfo } from '../src/shared/protocol.js';
import { builtFloors, floorStoreys, floorWings, pastTheWing, seatBuilt } from '../src/client/core/floors.js';
import { setStoreys, storeys, storeysKey } from '../src/client/world/facade.js';
import { store } from '../src/client/state/index.js';

const floor = (id: string, extra: Partial<FloorInfo> = {}) => ({ id, name: id, waiting: 0, people: 0, palette: 0, ...extra }) as FloorInfo;

test('the built floors leave out the ones still being cloned', () => {
  store.floors = [floor('a'), floor('b', { cloning: true }), floor('c')];
  assert.deepEqual(
    builtFloors().map((f) => f.id),
    ['a', 'c'],
  );
});

test("each floor's back office goes as far as its own, the one you're on as its plan has it", () => {
  const floors = [floor('a', { wing: 2 }), floor('b'), floor('c', { wing: 1 })];
  store.floor = 'b';
  store.floorPlan = { wing: 1, labels: {} };
  assert.deepEqual(floorWings(floors), [2, 1, 1]);
  store.floor = null;
  assert.deepEqual(floorWings(floors), [2, 0, 1]);
});

test("each storey on the outside has its floor's name and the trim of its paint: the builder's look over its own, the one you're on as its plan has it", () => {
  const studio = FLOOR_PALETTES.findIndex((p) => p.name === 'Studio');
  const friday = FLOOR_PALETTES.findIndex((p) => p.name === 'Friday');
  const innovators = FLOOR_PALETTES.findIndex((p) => p.name === 'Innovators');
  const floors = [floor('friday-labs', { name: 'Friday Labs', palette: 0, look: friday }), floor('ai-innovators', { name: 'AI Innovators', palette: 2, look: innovators }), floor('content', { name: 'Content', palette: 3 })];
  store.floor = 'content';
  store.floorPlan = { wing: 0, labels: {}, look: studio };
  assert.deepEqual(floorStoreys(floors), [
    { name: 'Friday Labs', accent: '#09ca59' },
    { name: 'AI Innovators', accent: '#0080fe' },
    { name: 'Content', accent: '#218cff' },
  ]);
  // A floor nobody's painted is its own color; the one you're on goes by its plan, not the list (which can lag it).
  store.floorPlan = { wing: 0, labels: {} };
  assert.deepEqual(
    floorStoreys(floors).map((s) => s.accent),
    ['#09ca59', '#0080fe', floorPalette(3).trim],
  );
  store.floor = 'friday-labs';
  assert.deepEqual(
    floorStoreys(floors).map((s) => s.accent),
    [floorPalette(0).trim, '#0080fe', floorPalette(3).trim],
  );
  store.floor = null;
  assert.deepEqual(floorStoreys([]), []);
});

test("the outside's storeys change their key when a name or a color does, and not otherwise", () => {
  const floors = [floor('a', { name: 'Alpha', palette: 1 }), floor('b', { name: 'Beta', palette: 2 })];
  store.floor = 'a';
  store.floorPlan = { wing: 0, labels: {} };
  setStoreys(floorStoreys(floors));
  const key = storeysKey();
  assert.deepEqual(storeys(), floorStoreys(floors));
  setStoreys(floorStoreys(floors));
  assert.equal(storeysKey(), key);
  store.floorPlan = { wing: 0, labels: {}, look: 4 };
  setStoreys(floorStoreys(floors));
  assert.notEqual(storeysKey(), key);
  store.floorPlan = { wing: 0, labels: {} };
  setStoreys(floorStoreys([floors[0], { ...floors[1], name: 'Gamma' }]));
  assert.notEqual(storeysKey(), key);
  setStoreys([]);
  store.floor = null;
});

test("a back office desk is there to sit at once the floor's built out that far; any other seat always is", () => {
  const first = WING_DESKS.find((d) => d.wing === 1)!;
  const second = WING_DESKS.find((d) => d.wing === 2)!;
  store.floorPlan = { wing: 0, labels: {} };
  assert.equal(seatBuilt(first.id), false);
  assert.equal(seatBuilt('no-such-desk'), true);
  store.floorPlan = { wing: 1, labels: {} };
  assert.equal(seatBuilt(first.id), true);
  assert.equal(seatBuilt(second.id), false);
  store.floorPlan = { wing: WING.rows, labels: {} };
  assert.equal(seatBuilt(second.id), true);
});

test("past the wing: standing where the back office would be, further back than this floor's goes", () => {
  const x = (WING.minX + WING.maxX) / 2;
  const deep = wingMinZ(WING.rows) + 0.5;
  assert.equal(pastTheWing({ x, y: 0, z: deep }, 0), true);
  assert.equal(pastTheWing({ x, y: 0, z: deep }, WING.rows), false);
  // In the room itself, down in the garage or up on the roof, it's not the back office.
  assert.equal(pastTheWing({ x, y: 0, z: FLOOR.minZ + 1 }, 0), false);
  assert.equal(pastTheWing({ x, y: -3, z: deep }, 0), false);
  assert.equal(pastTheWing({ x, y: 5, z: deep }, 0), false);
  assert.equal(pastTheWing({ x: WING.minX - 1, y: 0, z: deep }, 0), false);
});
