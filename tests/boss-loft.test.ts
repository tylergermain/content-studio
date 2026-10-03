import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { BOSS_COUCH, BOSS_PLANTS, BOSS_ROOM, BOSS_SIGN, BOSS_THINGS, BOSS_WALLS, bossWallClash } from '../src/shared/boss-walls.js';
import { FLOOR_PALETTES, floorPalette } from '../src/shared/floors.js';
import { DEFAULT_FURNITURE, type Piece } from '../src/shared/furniture.js';
import { LOFT, WINDOWS } from '../src/shared/layout.js';
import { layoutProblems, problemAt, structureProblem, validateLayout } from '../src/shared/office-builder.js';
import { wallFaces } from '../src/shared/wall-faces.js';
import { bossLook, paletteOf } from '../src/client/world/office/boss-look.js';

// Tyler's own office up in the corner loft: paintings on its walls as pieces of the layout (the rules in
// shared/office-builder.ts, with shared/boss-walls.ts for what's against those walls), the office in the
// floor's own colors (world/office/boss-look.ts), and the loft under it in the walls' paint with the trim
// only a thin line (world/office/loft.ts).

const QUARTER = Math.PI / 2;
const SOUTH = 2 * QUARTER; // on the south wall, facing north into the room
const EAST = 3 * QUARTER;
const NORTH = 0;
const up = { level: 1 } as const;
const EMPTY_LOFT = { boss: false } as const;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** A portrait the size of the four the boss's office has: 0.9 by 1.2, 1.04 by 1.34 with its frame, its middle 1.5 up. */
const portrait = (id: string, x: number, z: number, rotY: number, more: Partial<Piece> = {}): Piece => ({ id, kind: 'painting', x, z, rotY, size: 1.2, aspect: 0.75, lift: 1.5, ...up, ...more });
const withPieces = (pieces: Piece[]) => ({ desks: {}, furniture: [...DEFAULT_FURNITURE.map((p) => ({ ...p })), ...pieces] });
/** Napoleon, Alexander, JFK and Jobs, along the south wall between the window and the plant in the corner. */
const GREATS = [13, 14.1, 15.2, 16.3].map((x, i) => portrait(`great-${i}`, x, 13, SOUTH));

test("paintings hang on the boss's office walls as pieces of the layout, between its window and its plant", () => {
  // The office as it comes has the boss's office in its loft.
  assert.equal(layoutProblems(withPieces(GREATS)).size, 0);
  for (const g of GREATS) assert.equal(problemAt(withPieces(GREATS), g.id), undefined, g.id);
  // What the server keeps is what was checked.
  const kept = validateLayout({}, withPieces(GREATS).furniture);
  assert.equal(typeof kept, 'object');
  assert.deepEqual(
    (kept as { furniture: Piece[] }).furniture.filter((p) => p.level).map((p) => [p.x, p.z, p.rotY, p.lift]),
    GREATS.map((g) => [g.x, g.z, SOUTH, 1.5]),
  );
  // A floor that keeps the loft empty takes them the same.
  assert.equal(layoutProblems(withPieces(GREATS), EMPTY_LOFT).size, 0);
});

test("what's against the boss's office walls keeps paintings off it, and they stay on its walls under its roof", () => {
  const at = (p: Piece) => problemAt(withPieces([p]), p.id);
  // The south window and the east one.
  assert.equal(at(portrait('w', 11, 13, SOUTH)), 'Painting is in the way of the window');
  assert.equal(at(portrait('w', 18, 10.5, EAST, { size: 0.5, lift: 2 })), 'Painting is in the way of the window');
  // Under the east window, the couch.
  assert.equal(at(portrait('c', 18, 10.5, EAST, { size: 0.5, lift: 0.5 })), 'Painting is in the way of the couch');
  // The plants in the corners, on either wall.
  assert.equal(at(portrait('p', 17.3, 13, SOUTH)), 'Painting is in the way of a plant');
  assert.equal(at(portrait('p', 18, 8.6, EAST, { size: 0.6 })), 'Painting is in the way of a plant');
  // Over them a small one goes.
  assert.equal(at(portrait('p', 17.4, 13, SOUTH, { size: 0.8, lift: 2.2 })), undefined);
  // The sign, up under the roof.
  assert.equal(at(portrait('s', 15, 13, SOUTH, { size: 0.8, lift: 2.2 })), 'Painting is in the way of the sign');
  assert.equal(at(portrait('s', 15, 13, SOUTH, { size: 0.8, lift: 1.6 })), undefined);
  // Under its roof.
  assert.equal(at(portrait('t', 13, 13, SOUTH, { lift: 2.2 })), 'Painting is too tall for the loft');
  // On its two walls: not the glass, not round the corner, not a wall downstairs.
  assert.equal(at(portrait('g', 13, 8.12, NORTH)), 'Painting needs a wall to hang on');
  assert.equal(at(portrait('g', 13, 10.5, SOUTH)), 'Painting needs a wall to hang on');
  assert.equal(at(portrait('g', 17.8, 13, SOUTH, { lift: 2.2, size: 0.8 })), "Painting must stay in the boss's office");
  assert.equal(at(portrait('g', 0, 13, SOUTH)), "Painting must stay in the boss's office");
  assert.equal(at(portrait('g', 0, -13, NORTH)), "Painting must stay in the boss's office");
  // Nothing but a painting goes up while the boss's office is there.
  assert.equal(at({ id: 'sofa', kind: 'sofa', x: 14, z: 10.5, rotY: 0, ...up }), "Sofa is upstairs, where the boss's office is");
  assert.equal(at({ id: 'wall', kind: 'wall', x: 14, z: 10.5, rotY: 0, ...up }), "Wall is upstairs, where the boss's office is");
  // In an empty loft its things are gone, and so is what they kept clear.
  assert.equal(problemAt(withPieces([portrait('c', 18, 10.5, EAST, { size: 0.5, lift: 0.5 })]), 'c', EMPTY_LOFT), undefined);
});

test("the boss's office comes back only to walls its things are clear of", () => {
  const behindCouch = withPieces([portrait('c', 18, 10.5, EAST, { size: 0.5, lift: 0.5 })]);
  assert.equal(structureProblem(behindCouch, EMPTY_LOFT, {}), 'Clear upstairs first: Painting is in the way of the couch');
  assert.equal(structureProblem(withPieces(GREATS), EMPTY_LOFT, {}), undefined);
  // The paintings go with the loft.
  assert.equal(structureProblem(withPieces(GREATS), {}, { mezzanine: 'none' }), 'Clear upstairs first: Painting is upstairs, and this floor is all one level');
});

test("the boss's office's walls are the loft's south and east ones, and what's against them is where it's built", () => {
  const faces = wallFaces([{ id: 'w', kind: 'wall', x: 14, z: 10, rotY: 0, ...up }], 1, {});
  assert.equal(faces.length, 2, 'no wall stands up there');
  const [south, east] = faces;
  assert.ok(near(south.z, 13) && near(south.rotY, SOUTH) && near(south.x - south.half, BOSS_ROOM.minX) && near(south.x + south.half, 18), JSON.stringify(south));
  assert.ok(near(east.x, 18) && near(east.rotY, EAST) && near(east.z - east.half, BOSS_ROOM.minZ) && near(east.z + east.half, 13), JSON.stringify(east));
  // The windows are the ones in WINDOWS in the loft's two walls (the loft's own pair), from the loft's floor.
  const windows = BOSS_WALLS.filter((t) => t.what === 'the window');
  const inLoft = WINDOWS.filter((o) => (o.wall === 'south' && o.u > LOFT.minX && o.u < LOFT.maxX) || (o.wall === 'east' && o.u > LOFT.minZ && o.u < LOFT.maxZ));
  assert.equal(inLoft.length, 2);
  assert.deepEqual(
    windows.map((t) => [t.wall, t.u0, t.u1, +t.y0.toFixed(3), +t.y1.toFixed(3)]),
    inLoft.map((o) => [o.wall, o.u - o.width / 2, o.u + o.width / 2, +(o.y0 - LOFT.y).toFixed(3), +(o.y1 - LOFT.y).toFixed(3)]),
  );
  // The couch along the east wall, a plant each side of it, two plants' worth on the south wall's corner, the sign.
  assert.deepEqual(
    BOSS_THINGS.map((t) => `${t.wall}:${t.what}`),
    ['east:the couch', 'east:a plant', 'east:a plant', 'south:a plant', 'south:the sign'],
  );
  assert.equal(BOSS_THINGS.find((t) => t.what === 'the sign')!.y1 <= LOFT.height, true);
  assert.deepEqual([BOSS_COUCH.x, BOSS_COUCH.z], [LOFT.maxX - 0.65, (LOFT.minZ + LOFT.maxZ) / 2]);
  // Only what hangs on the walls is checked: a painting out in the room has nothing to cover.
  assert.equal(bossWallClash(portrait('x', 14, 10.5, SOUTH)), undefined);
});

test("the boss's office is in the floor's colors: Friday Labs' ink, deep green, paper and signal green", () => {
  const friday = floorPalette(10);
  assert.equal(friday.name, 'Friday');
  assert.deepEqual(bossLook(friday), { couch: '#0a0b12', cushion: '#087d3b', rug: '#f5f6f2', shade: '#09ca59' });
  // A floor knows only its walls' and trim's paint: that's enough to know it's Friday Labs.
  assert.equal(paletteOf('#F5F6F2', '#09CA59').name, 'Friday');
  assert.equal(paletteOf('#f5f6f2', '#0080fe').name, 'Innovators');
  assert.deepEqual(bossLook(paletteOf('#123456', '#09ca59')).shade, '#09ca59', 'a look of its own is worked out the same way');
  const light = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (Math.max(n >> 16, (n >> 8) & 255, n & 255) + Math.min(n >> 16, (n >> 8) & 255, n & 255)) / 510;
  };
  for (const p of FLOOR_PALETTES) {
    const look = bossLook(p);
    for (const c of Object.values(look)) assert.match(c, /^#[0-9a-f]{6}$/, p.name);
    // Nothing of the catalog's pink, lime or yellow, on any floor.
    for (const stock of ['#ef476f', '#caffbf', '#ffd166']) assert.ok(!Object.values(look).includes(stock), `${p.name} ${stock}`);
    // The trim for the shade; a near-black couch; the cushion darker than the trim but not black; a light rug.
    assert.equal(look.shade, p.trim, p.name);
    assert.ok(light(look.couch) < 0.12, `${p.name} couch ${look.couch}`);
    assert.ok(light(look.cushion) < light(p.trim) && light(look.cushion) > 0.15, `${p.name} cushion ${look.cushion}`);
    assert.ok(light(look.rug) > 0.5, `${p.name} rug ${look.rug}`);
  }
  // Paper walls are the rug; the studio's charcoal ones aren't one.
  assert.equal(bossLook(floorPalette(0)).rug, floorPalette(0).wall);
  assert.equal(bossLook(floorPalette(12)).rug, '#f5f6f2');
});

// ---- As the 3D office builds them -----------------------------------------------------------------

// The signs' words are painted on canvases, which is all the loft and the office need of a page.
(globalThis as { document?: unknown }).document ??= {
  createElement: () => ({ getContext: () => new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 300 }) : () => {}), set: () => true }) }),
};
// The plants are models, which Vite hands the page as files' addresses: under node there's no file to
// load, so each is an address to nothing (and the plants empty groups, as when a model doesn't load).
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function load(url, context, next) { return /\\.glb(\\?|$)/.test(url) ? { format: 'module', source: 'export default ""', shortCircuit: true } : next(url, context); }`,
  )}`,
);

async function built() {
  const { buildLoft, loft } = await import('../src/client/world/office/loft.js');
  const { bossOffice } = await import('../src/client/world/office/boss-office.js');
  const { roomOptions } = await import('../src/client/world/office/room-options.js');
  const looks = { wall: new THREE.MeshToonMaterial({ color: '#fff6ea' }), trim: new THREE.MeshToonMaterial({ color: '#e8a87c' }), planks: [] };
  const marks: { wall: string; u: number; y: number; w: number; h: number }[] = [];
  const room = roomOptions({} as never).handle!.room;
  const site = {
    group: new THREE.Group(),
    colliders: [],
    interactables: [],
    looks,
    wall: (wall: string, u: number, y: number, w: number, h: number) => {
      const mark = { wall, u, y, w, h, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 };
      marks.push(mark);
      return mark;
    },
    get: () => room,
  };
  const office = bossOffice(site as never);
  loft(site as never);
  return { looks, marks, office, room, loftParts: buildLoft(looks as never).group };
}

test('the loft is in the walls’ paint, with the trim a thin line round it', async () => {
  const { looks, loftParts } = await built();
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
  loftParts.updateMatrixWorld(true);
  loftParts.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>));
  const size = (m: THREE.Mesh) => new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
  // What holds the loft up, and its underside (the meeting room's ceiling): the walls' paint.
  const under = meshes.filter((m) => new THREE.Box3().setFromObject(m).max.y <= LOFT.y + 1e-6 && new THREE.Box3().setFromObject(m).min.y > 0.5);
  const slab = under.find((m) => size(m).x > 8 && size(m).z > 4)!;
  assert.equal(slab.material, looks.wall, 'the slab');
  const posts = meshes.filter((m) => m.geometry instanceof THREE.CylinderGeometry && size(m).y > 2);
  assert.equal(posts.length, 2);
  for (const p of posts) assert.equal(p.material, looks.wall, 'a post');
  // The trim is never more than a thin line, but for the skirting inside along its two walls.
  const trim = meshes.filter((m) => m.material === looks.trim);
  assert.ok(trim.length >= 4);
  for (const m of trim) {
    const s = size(m);
    const thin = Math.min(s.x, s.z) <= 0.04 + 1e-6;
    const low = s.y <= 0.06 + 1e-6;
    const skirting = near(s.y, 0.25) && new THREE.Box3().setFromObject(m).min.y >= LOFT.y - 1e-6;
    assert.ok(thin && (low || skirting), `a trim part ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}`);
  }
  // A line along the foot of the slab's open north edge, the whole way along it.
  const north = trim.find((m) => size(m).x >= LOFT.maxX - LOFT.minX && new THREE.Box3().setFromObject(m).max.y < LOFT.y);
  assert.ok(north, 'the line under the north edge');
});

test("the boss's office takes the floor's colors when the floor is painted, and marks its walls where its things are", async () => {
  const { looks, marks, office, room } = await built();
  const group = office.group as THREE.Group;
  const colors = () => {
    const seen = new Set<string>();
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (m?.color) seen.add(`#${m.color.getHexString()}`);
    });
    return seen;
  };
  // As the office comes (the first floor's paint, Maple).
  office.update!(0, 0);
  const maple = bossLook(floorPalette(0));
  for (const c of [maple.couch, maple.cushion, maple.rug, maple.shade]) assert.ok(colors().has(c), `maple ${c}`);
  // Painted Friday Labs (as Office.setLook does it): the next frame, it's in Friday's colors.
  const friday = floorPalette(10);
  looks.wall.color.set(friday.wall);
  looks.trim.color.set(friday.trim);
  office.update!(1, 0.016);
  for (const c of ['#0a0b12', '#087d3b', '#f5f6f2', '#09ca59']) assert.ok(colors().has(c), `friday ${c}`);
  for (const c of ['#ef476f', '#caffbf']) assert.ok(!colors().has(c), `no ${c}`);
  // The pictures people hang keep off the couch, the plants and the sign, while the office is there.
  room.set({ ...room.get() });
  const on = marks.filter((m) => !(m as { off?: boolean }).off);
  assert.equal(on.length, BOSS_THINGS.length);
  const sign = on.find((m) => m.wall === 'south' && m.y > LOFT.y + 2)!;
  assert.ok(near(sign.u, BOSS_SIGN.u) && near(sign.y, LOFT.y + BOSS_SIGN.y), JSON.stringify(sign));
  const couch = on.find((m) => m.wall === 'east' && m.w > 2)!;
  assert.ok(near(couch.u, BOSS_COUCH.z) && near(couch.y, LOFT.y + BOSS_COUCH.back / 2), JSON.stringify(couch));
  assert.equal(on.filter((m) => m.h > 1.2 && m.h < 1.7).length, 3, 'the plants: one on the east wall each, and one on the south');
  assert.equal(BOSS_PLANTS.length, 2);
  // On a floor whose loft is empty they're gone.
  room.set({ ...room.get(), boss: false });
  assert.equal(marks.filter((m) => !(m as { off?: boolean }).off).length, 0);
});
