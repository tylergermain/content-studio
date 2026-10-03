import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CEILING_KINDS, ROOM_DEFAULTS, type CeilingKind } from '../src/shared/floorplan.js';
import { kindDef, type Piece } from '../src/shared/furniture.js';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, LADDER, LOFT, POLES, WALL_HEIGHT } from '../src/shared/layout.js';
import { BIG, BIG_FLIGHTS, DECK_Y } from '../src/shared/mezzanine.js';
import { problemAt } from '../src/shared/office-builder.js';
import type { NightParts } from '../src/client/world/outside.js';
import { LAMPS, LAMP_Y, ceiling, lamps, type CeilingKit } from '../src/client/world/office/ceiling.js';
import type { Site } from '../src/client/world/office/fixture.js';
import { DECOR_BUILDERS } from '../src/client/world/office/furniture-decor.js';
import { roomOptions, type RoomView } from '../src/client/world/office/room-options.js';

// What hangs under the ceiling (world/office/ceiling.ts), built as the office builds it and measured:
// the pendants are where they always were with a shade for the floor's ceiling, a floor shows the one
// kit it asks for, and every kit keeps the rules it was drawn to: over every head, clear of the fire
// pole, the ladder's hatch, the elevator's shaft and a deck, with nothing to bump into and no light
// the sky wasn't told about. And the ceiling panel, which is furniture (furniture-decor.ts).

// The banners' letters are painted on canvases, which is all a kit needs of a page.
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };

/** Nothing of a kit hangs lower than this. */
const LOWEST = 4.4;
/** How far in plan a kit keeps from a fire pole, which comes down through a hole in the ceiling. */
const POLE_CLEAR = 0.9;
/** How much room a head needs over a floor it stands on. */
const HEAD = 2.3;
const KITS: readonly CeilingKit[] = ['beams', 'banners', 'grid'];

/** As much of the floor as the lamps and the kits are built into, with both fixtures built. */
function built() {
  const night = { bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: 0 } as unknown as NightParts;
  const room: RoomView = roomOptions({} as Site).handle!.room;
  const group = new THREE.Group();
  const colliders: unknown[] = [];
  const interactables: unknown[] = [];
  // The stack's ceiling, as buildStack paints it: white, with its tiles for a picture and a glow.
  const tiles = new THREE.MeshToonMaterial({ color: '#ffffff', map: new THREE.Texture() });
  tiles.emissive.set('#6a655d');
  tiles.emissiveMap = tiles.map;
  const stack = { ceiling: tiles };
  const handles: Record<string, unknown> = { night, room, stack };
  const site = { group, colliders, interactables, looks: { trim: new THREE.MeshToonMaterial() }, get: (key: string) => handles[key] } as unknown as Site;
  const hung = lamps(site);
  const pendants = [...group.children];
  const kits = ceiling(site);
  group.updateMatrixWorld(true);
  kits.group!.updateMatrixWorld(true);
  const byKind = Object.fromEntries(KITS.map((kind, i) => [kind, kits.group!.children[i]])) as Record<CeilingKit, THREE.Object3D>;
  return { night, room, group, colliders, interactables, hung, pendants, kits, byKind, tiles };
}

const show = (room: RoomView, kind: CeilingKind) => room.set({ ...ROOM_DEFAULTS, ceiling: kind });

/**
 * Points all over what's under `root`: along every edge of every triangle, no more than 0.1 apart
 * (a pipe is two points and 27 m of nothing between them, if only its corners are asked).
 */
function* samples(root: THREE.Object3D): Generator<THREE.Vector3> {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const m of meshes) {
    const at = m.geometry.getAttribute('position');
    const index = m.geometry.getIndex();
    const count = index ? index.count : at.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) corner[k].fromBufferAttribute(at, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
      for (let k = 0; k < 3; k++) {
        const a = corner[k];
        const b = corner[(k + 1) % 3];
        const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.1));
        for (let s = 0; s < steps; s++) yield a.clone().lerp(b, s / steps);
      }
    }
  }
}

const at = (p: THREE.Vector3) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;

test('the five pendants hang where they always did, a halo for each and no other light', () => {
  const { night, pendants, colliders, interactables, hung } = built();
  assert.deepEqual(LAMPS, [[-10.5, -4], [-1.5, -4], [-10.5, 4], [-1.5, 4], [13, 0]]);
  assert.equal(LAMP_Y, 4.05);
  assert.deepEqual(pendants.map((p) => p.position.toArray()), LAMPS.map(([x, z]) => [x, LAMP_Y, z]));
  // What the sky makes its halos from, once: the same five it always had, each on its bulb.
  assert.deepEqual(night.halos.map((h) => ({ at: h.at.toArray(), size: h.size, color: h.color })), LAMPS.map(([x, z]) => ({ at: [x, LAMP_Y - 0.12, z], size: 1.3, color: '#ffe08a' })));
  assert.equal(night.lamps.length, 0);
  assert.equal(colliders.length + interactables.length, 0);
  assert.deepEqual(Object.keys(hung), []);
  // Each is on a cord up to the ceiling.
  for (const p of pendants) assert.ok(Math.abs(new THREE.Box3().setFromObject(p.children[0]).max.y - WALL_HEIGHT) < 1e-6);
});

test('a pendant wears the shade of the ceiling its floor has: the yellow cone, unless it says', () => {
  const { room, pendants } = built();
  // Its cord and its bulb, and then a shade for each kind of ceiling.
  const shades = (p: THREE.Object3D) => Object.fromEntries(CEILING_KINDS.map((kind, i) => [kind, p.children[2 + i]])) as Record<CeilingKind, THREE.Object3D>;
  for (const p of pendants) assert.equal(p.children.length, 2 + CEILING_KINDS.length);
  const worn = () => pendants.map((p) => CEILING_KINDS.filter((kind) => shades(p)[kind].visible));
  assert.deepEqual(worn(), pendants.map(() => ['tiles']));
  const cone = shades(pendants[0]).tiles as THREE.Mesh<THREE.ConeGeometry, THREE.MeshToonMaterial>;
  assert.equal(cone.geometry.type, 'ConeGeometry');
  assert.equal(cone.material.color.getHexString(), 'ffd166');
  assert.equal((shades(pendants[0]).beams as typeof cone).material.color.getHexString(), '09ca59');
  for (const kind of CEILING_KINDS) {
    show(room, kind);
    assert.deepEqual(worn(), pendants.map(() => [kind]), kind);
    // No shade hangs lower than the bulb it's round, which a desk's sign under it clears.
    for (const p of pendants) assert.ok(new THREE.Box3().setFromObject(shades(p)[kind]).min.y > new THREE.Box3().setFromObject(p.children[1]).min.y - 0.06, kind);
  }
});

test('a floor shows the kit it asks for, and one that says nothing has none', () => {
  const { room, kits, byKind } = built();
  assert.equal(kits.group!.children.length, KITS.length);
  const shown = () => KITS.filter((kind) => byKind[kind].visible);
  assert.deepEqual(shown(), []);
  for (const kind of KITS) {
    show(room, kind);
    assert.deepEqual(shown(), [kind]);
  }
  show(room, 'tiles');
  assert.deepEqual(shown(), []);
});

test('the ceiling itself goes with the kit, and a floor that says nothing has its tiles as they were', () => {
  const { room, tiles } = built();
  const { map, emissiveMap } = tiles;
  const glow = tiles.emissive.getHex();
  const painted = () => ({ map: tiles.map, glow: tiles.emissiveMap, emissive: tiles.emissive.getHex(), color: tiles.color.getHex() });
  const asItCame = { map, glow: emissiveMap, emissive: glow, color: 0xffffff };
  assert.deepEqual(painted(), asItCame);
  const seen = new Map<CeilingKind, ReturnType<typeof painted>>();
  for (const kind of KITS) {
    show(room, kind);
    const now = painted();
    assert.ok(now.map && now.glow, `${kind} has a picture and a glow`);
    assert.notEqual(now.map, map, `${kind} is still the tiles`);
    seen.set(kind, now);
    show(room, 'tiles');
    assert.deepEqual(painted(), asItCame, `the tiles after ${kind}`);
    // Painted once: a floor that comes back to it gets the same.
    show(room, kind);
    assert.deepEqual(painted(), now, `${kind} again`);
  }
  // Each is its own: the boards, the white and the black are three pictures.
  assert.equal(new Set(KITS.map((kind) => seen.get(kind)!.map)).size, KITS.length);
  // The white is the brightest of them and the black the darkest, however the room's lit.
  const glows = Object.fromEntries(KITS.map((kind) => [kind, new THREE.Color(seen.get(kind)!.emissive).getHSL({ h: 0, s: 0, l: 0 }).l]));
  assert.ok(glows.banners > glows.beams && glows.beams > glows.grid, JSON.stringify(glows));
});

test('nothing of a kit is in the way, lights the room by itself, or is lit without the sky knowing', () => {
  const { night, kits, colliders, interactables, byKind } = built();
  assert.equal(kits.colliders, undefined);
  assert.equal(kits.interactables, undefined);
  assert.equal(colliders.length + interactables.length, 0);
  assert.equal(night.halos.length, LAMPS.length);
  assert.equal(night.lamps.length, 0);
  // The globes' glass and the kits' lights: one bulb each, however many are lit by it.
  assert.equal(night.bulbs.length, 2);
  const bulbs = new Set<THREE.Material>(night.bulbs.map((b) => b.mat));
  for (const kind of KITS) {
    byKind[kind].traverse((o) => {
      const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      if (!m.isMesh) return;
      assert.equal(m.castShadow, false, `${kind} throws a shadow the ceiling over it doesn't`);
      const lit = m.material instanceof THREE.MeshToonMaterial && m.material.emissive.getHex() !== 0;
      if (lit) assert.ok(bulbs.has(m.material), `${kind} has a light that isn't a bulb`);
    });
  }
  assert.ok(KITS.filter((kind) => kind !== 'beams').every((kind) => (byKind[kind].getObjectsByProperty('isMesh', true) as THREE.Mesh[]).some((m) => bulbs.has(m.material as THREE.Material))));
});

test('every kit is over every head, inside the room, and clear of the fire pole, the hatch and the elevator', () => {
  const { byKind } = built();
  const hatch = LADDER.hatch;
  const shaft = { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2 };
  for (const kind of KITS) {
    let n = 0;
    for (const p of samples(byKind[kind])) {
      n++;
      assert.ok(p.y >= LOWEST, `${kind} hangs to ${at(p)}`);
      assert.ok(p.y <= WALL_HEIGHT + 1e-6, `${kind} goes through the ceiling at ${at(p)}`);
      assert.ok(p.x >= FLOOR.minX && p.x <= FLOOR.maxX && p.z >= FLOOR.minZ - 1e-6 && p.z <= FLOOR.maxZ + 1e-6, `${kind} is through a wall at ${at(p)}`);
      for (const pole of POLES) assert.ok(Math.hypot(p.x - pole.x, p.z - pole.z) >= POLE_CLEAR, `${kind} is ${Math.hypot(p.x - pole.x, p.z - pole.z).toFixed(2)} from the fire pole at ${at(p)}`);
      assert.ok(!(p.x < hatch.maxX + 0.3 && p.z > hatch.minZ - 0.3 && p.z < hatch.maxZ + 0.3), `${kind} is over the ladder's hatch at ${at(p)}`);
      assert.ok(!(p.x > shaft.minX - 0.05 && p.x < shaft.maxX + 0.05 && p.z < ELEVATOR_FRONT - 1e-6), `${kind} is in the elevator's shaft at ${at(p)}`);
    }
    assert.ok(n > 500, `${kind} is only ${n} points`);
  }
});

test('whichever upstairs a floor has, a kit is over the heads of whoever is up there', () => {
  const { byKind } = built();
  /** How high the floor under (x, z) is on a floor with the big mezzanine and both flights: the deck, or the step of a flight. */
  const bigFloor = (x: number, z: number) => {
    if (z >= BIG.minZ - 0.1) return DECK_Y;
    const f = BIG_FLIGHTS.find((f) => x > f.minX - 0.4 && x < f.maxX + 0.4 && z > f.fromZ && z < f.toZ);
    return f ? (DECK_Y * (z - f.fromZ)) / (f.toZ - f.fromZ) : 0;
  };
  for (const kind of KITS) {
    for (const p of samples(byKind[kind])) {
      assert.ok(p.y - bigFloor(p.x, p.z) >= HEAD, `${kind} is ${(p.y - bigFloor(p.x, p.z)).toFixed(2)} over the big mezzanine at ${at(p)}`);
      // The corner loft has a roof on it, 0.2 thick.
      const overLoft = p.x > LOFT.minX - 0.1 && p.z > LOFT.minZ - 0.1;
      if (overLoft) assert.ok(p.y >= LOFT.y + LOFT.height + 0.2, `${kind} is in the loft's roof at ${at(p)}`);
    }
  }
  // The grid is the newsroom's: it stops short of the deck's rail, with room to lean on it.
  for (const p of samples(byKind.grid)) assert.ok(p.z < BIG.minZ - 1, `the grid is over the deck at ${at(p)}`);
});

test('the banners count up from the west, the last of them the fire pole’s side', () => {
  const { byKind } = built();
  const letters = (byKind.banners.getObjectsByProperty('isMesh', true) as THREE.Mesh[]).filter((m) => m.geometry.type === 'PlaneGeometry');
  // Nine banners, each with its level on both faces: the two share what's written.
  assert.equal(letters.length, 18);
  const xs = [...new Set(letters.map((m) => Math.round(m.position.x * 4) / 4))].sort((a, b) => a - b);
  assert.deepEqual(xs, [-4, -2.75, -1.5, -0.25, 1, 2.25, 3.5, 4.75, 6]);
  assert.equal(new Set(letters.map((m) => (m.material as THREE.Material).uuid)).size, 9);
  for (const m of letters) assert.ok(Math.abs(Math.abs(m.rotation.y) - Math.PI / 2) < 1e-9);
});

test('a ceiling panel is slats at 2.62 on rods to the ceiling, over a wall and over nobody’s way', () => {
  const def = kindDef('ceiling-panel');
  const piece: Piece = { id: 'soffit', kind: 'ceiling-panel', x: 0, z: 0, rotY: 0 };
  const panel = DECOR_BUILDERS['ceiling-panel']!(piece, def.color!, 0) as THREE.Group;
  assert.ok(panel instanceof THREE.Group);
  panel.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(panel);
  // Its footprint is the kind's, so four side by side are one soffit; and it clears a 2.6 m wall.
  assert.ok(Math.abs(box.min.x + def.w! / 2) < 1e-6 && Math.abs(box.max.x - def.w! / 2) < 1e-6);
  assert.ok(Math.abs(box.min.z + def.d! / 2) < 1e-6 && Math.abs(box.max.z - def.d! / 2) < 1e-6);
  assert.ok(box.min.y > 2.6 && box.min.y <= 2.62, `its underside is at ${box.min.y}`);
  assert.ok(Math.abs(box.max.y - WALL_HEIGHT) < 1e-6);
  const meshes = panel.getObjectsByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>[];
  const slats = meshes.filter((m) => m.material.color.getHexString() === new THREE.Color(def.color!).getHexString());
  assert.equal(slats.length, 12);
  for (const m of slats) {
    const b = new THREE.Box3().setFromObject(m);
    assert.ok(Math.abs(b.min.y - 2.62) < 1e-6 && b.max.y <= 2.7 + 1e-6);
  }
  // The slats of one carry on across the next: the gap at each side is half the gap between two.
  const edges = slats.map((m) => new THREE.Box3().setFromObject(m)).sort((a, b) => a.min.x - b.min.x);
  const gap = edges[1].min.x - edges[0].max.x;
  assert.ok(Math.abs(edges[0].min.x + def.w! / 2 - gap / 2) < 1e-6);
  // One light under it, and nothing of it flat: a flat shape would take the outline off everything painted its color (see noOutline in furnish.ts).
  assert.equal(meshes.filter((m) => m.material.emissive.getHex() !== 0).length, 1);
  for (const m of meshes) assert.ok(!['PlaneGeometry', 'CircleGeometry'].includes(m.geometry.type));
  assert.equal(def.overhead, true);
  assert.equal(def.top, 0);
});

test('a ceiling panel hangs clear to the ceiling: not under a loft, over a flight of stairs or through the lift', () => {
  const hung = (x: number, z: number, room = {}) => problemAt({ desks: {}, furniture: [{ id: 'soffit', kind: 'ceiling-panel', x, z, rotY: 0 }] }, 'soffit', room);
  // The master plan's soffit at the lift: four panels side by side, the back two up against the shaft's front.
  for (const [x, z] of [[7.3, -9.4], [9.7, -9.4], [7.3, -7], [9.7, -7]]) for (const room of [{}, { mezzanine: 'none' }, { mezzanine: 'big', flights: 2 }] as const) assert.equal(hung(x, z, room), undefined);
  // Nobody's in the way of one, and it's in nobody's: over a desk is fine.
  assert.equal(hung(-9, -4), undefined);
  // Under the corner loft its rods would come up through the floor above, the boss's office or not.
  assert.equal(hung(14, 10.5), 'Ceiling panel hangs too high to go under the loft');
  assert.equal(hung(14, 10.5, { boss: false }), 'Ceiling panel hangs too high to go under the loft');
  assert.equal(hung(14, 10.5, { mezzanine: 'none' }), undefined);
  assert.equal(hung(0, 9, { mezzanine: 'big' }), 'Ceiling panel hangs too high to go under the mezzanine');
  // Over a flight of stairs, which climbs through where it hangs; and through the elevator's shaft.
  assert.equal(hung(6, 11.5), 'Ceiling panel is in the way of the stairs');
  assert.equal(hung(6, 11.5, { mezzanine: 'none' }), undefined);
  assert.equal(hung(4.8, 2, { mezzanine: 'big' }), 'Ceiling panel is in the way of the stairs');
  assert.equal(hung(-14.4, 2, { mezzanine: 'big' }), undefined, 'the west flight is only there on a floor with two');
  assert.equal(hung(-14.4, 2, { mezzanine: 'big', flights: 2 }), 'Ceiling panel is in the way of the stairs');
  assert.equal(hung(ELEVATOR.x, ELEVATOR_FRONT - 0.5), 'Ceiling panel is in the way of the elevator');
});
