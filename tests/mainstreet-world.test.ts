import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Box } from '../src/shared/garage.js';
import { GOLF_HOLE, ROAD, STREET_Y, roofDrop, streetBelow } from '../src/shared/layout.js';
import { CLAIMABLE, CRANE, HOARDING, PARK, PLATE, PLOTS, PLOT_IDS, PUTT, businessBoxes, claimedBox, inPlots, plateBox, plotAt, shellTop, type Claimable } from '../src/shared/mainstreet.js';
import type { BusinessCard, ServerMsg } from '../src/shared/protocol.js';
import { FARM, LOOP, LOOP_PAVED } from '../src/shared/scenic.js';

// Main Street as it's drawn out on the street (world/mainstreet/, features/mainstreet/world.ts and
// roof.ts), and what moved to make room for it: the farm, the neighbours, the scenic loop's trees
// and billboard. The street's own parts are built here as the office builds them and measured.

// Signs and maps are painted on canvases, which is all they need of a page: a 2D context that measures
// every letter 10 px wide and draws nothing. Friday Tower's lockup is a picture, and the store keeps
// things in localStorage. All of them stood in before the modules that use them are loaded.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 0 }) : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
(globalThis as { Image?: unknown }).Image ??= class {
  onerror?: () => void;
  set src(_: string) {
    queueMicrotask(() => this.onerror?.());
  }
};
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) } });

const { BILLBOARD } = await import('../src/client/world/scenic/road.js');
const { buildScenic } = await import('../src/client/world/scenic/index.js');
const { BUNKERS, GREEN_TREES, buildGreen, fly } = await import('../src/client/features/golf/world.js');
const { buildStreet, neighbourBoxes, obstacleBoxes, setObstacleBoxes } = await import('../src/client/world/outside.js');
const { MAX_LAMPS } = await import('../src/client/world/sky.js');
const { forecourt } = await import('../src/client/world/forecourt.js');
const { exitDoor } = await import('../src/client/world/office/shell.js');
const { BENCH, GATE, PATH, WALL, craneMotion, floodLamp, golfBoxes, kerbSolids, parkSolids, plotSolids, signSpot } = await import('../src/client/world/mainstreet/layout.js');
const { lampless } = await import('../src/client/world/mainstreet/kit.js');
const { buildMainStreet } = await import('../src/client/world/mainstreet/street.js');
const { mainStreet } = await import('../src/client/features/mainstreet/world.js');
const { store } = await import('../src/client/state/index.js');
const { buildCity } = await import('../src/client/world/city.js');

type Night = Parameters<typeof buildStreet>[2];
const nightParts = (): Night => ({ bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: STREET_Y, clouds: new THREE.MeshToonMaterial(), wetGlass: new THREE.MeshBasicMaterial() }) as Night;

const overlaps = (a: Box, b: Box, margin = 0) => a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin;
const inside = (b: Box, x: number, z: number, margin = 0) => x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin;
/** How far (x, z) is from box `b` (0 inside it). */
const fromBox = (b: Box, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

const card = (plot: Claimable, stage: 'site' | 'shell', storeys = 4, name = 'Acme'): BusinessCard => ({ id: name.toLowerCase(), name, plot, accent: '#ff8800', skin: 'brick', stage, home: 'hosted', storeys: Array.from({ length: storeys }, () => ({ name, accent: '#ff8800' })) });

test('the plots keep clear of the scenic loop and of the farm, which moved east of them', () => {
  for (const id of PLOT_IDS) {
    const b = PLOTS[id].box;
    for (const p of LOOP) assert.ok(!inside(b, p.x, p.z, LOOP_PAVED), `${id} is clear of the loop at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
    for (const f of [...FARM.fields, FARM.pasture]) assert.ok(!overlaps(b, f, 4), `${id} is clear of the farm's field x ${f.minX}..${f.maxX}, z ${f.minZ}..${f.maxZ}`);
    for (const at of [FARM.barn, FARM.silo, FARM.windmill]) assert.ok(fromBox(b, at.x, at.z) > 10, `${id} is clear of the farm's buildings`);
  }
  assert.deepEqual(FARM.fields.map((f) => f.minX), [82, 82]);
  assert.deepEqual(FARM.pasture, { minX: 104, maxX: 134, minZ: 54, maxZ: 68 });
  // A meter clear of the barn (its collider, scenic/farm.ts) and of the silo, 3 m round.
  const barn = { minX: FARM.barn.x - 7, maxX: FARM.barn.x + 7, minZ: FARM.barn.z - 7, maxZ: FARM.barn.z + 7 };
  const P = FARM.pasture;
  assert.ok(P.minX - barn.maxX >= 1, 'the pasture is clear of the barn');
  assert.ok(fromBox(P, FARM.silo.x, FARM.silo.z) - 3 >= 1, 'the pasture is clear of the silo');
  for (const f of FARM.fields) assert.ok(!overlaps(f, barn) && fromBox(f, FARM.silo.x, FARM.silo.z) > 3, 'the fields are clear of the barn and the silo');
  // The gap in the pasture's fence is the north end of its west side (scenic/farm.ts): facing the barn.
  assert.ok(barn.maxX <= P.minX && barn.minZ <= P.minZ && barn.maxZ >= P.minZ + 5, 'the gate in the fence opens toward the barn');
});

test("Friday One's pad keeps clear of hole 1, and of the park's own windsock and benches", () => {
  const { x, z, clear } = PARK.pad;
  const pin = GOLF_HOLE;
  for (const [tx, tz, s] of GREEN_TREES) assert.ok(Math.hypot(tx - x, tz - z) > clear + 1.6 * s, `the tree at (${tx}, ${tz})`);
  for (const [bx, bz, r] of BUNKERS) assert.ok(Math.hypot(bx - x, bz - z) > clear + r, `the bunker at (${bx}, ${bz})`);
  assert.ok(Math.hypot(pin.x - x, pin.z - z) > clear + pin.green + 0.7, 'the green and its fringe');
  // Golf's lamp behind the green (features/golf/world.ts) and its flagstick.
  assert.ok(Math.hypot(pin.x + 1.5 - x, pin.z + 6.8 - z) > clear, "the green's lamp");
  const fairway = { minX: pin.fairway[0], maxX: pin.fairway[1], minZ: ROAD.maxZ + 2.5, maxZ: pin.z };
  assert.ok(fromBox(fairway, x, z) > clear, 'the fairway');
  assert.ok(Math.hypot(PARK.windsock.x - x, PARK.windsock.z - z) > clear, 'the windsock');
  for (const b of PARK.benches) assert.ok(Math.hypot(b.x - x, b.z - z) > clear + BENCH.length / 2, `the bench at (${b.x}, ${b.z})`);
  // The path runs in from the far sidewalk to under the deck, clear of the fairway, the trees and the
  // sidewalk's tree at (14, 32.5).
  assert.equal(PATH.minZ, ROAD.maxZ + 2);
  assert.ok(Math.hypot(PARK.path.x - x, PATH.maxZ - z) < PARK.pad.r, 'the path ends under the deck');
  assert.ok(!overlaps(PATH, fairway, 1) && fromBox(PATH, 14, 32.5) > 0.6, 'clear of the fairway and the sidewalk tree');
  for (const [tx, tz] of GREEN_TREES) assert.ok(fromBox(PATH, tx, tz) > 1, `clear of the tree at (${tx}, ${tz})`);
  // The floodlight leans in over the pad from off its edge; nothing the park adds is in hole 1's way.
  const lamp = floodLamp();
  assert.ok(Math.hypot(PARK.flood.x - x, PARK.flood.z - z) > PARK.pad.r && Math.hypot(lamp.x - x, lamp.z - z) < Math.hypot(PARK.flood.x - x, PARK.flood.z - z));
  for (const s of parkSolids()) {
    assert.equal(plotAt((s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2), 'P5', 'in the park');
    assert.ok(!overlaps(s, fairway) && fromBox(s, pin.x, pin.z) > pin.green + 0.7, "out of the hole's way");
  }
});

test('nothing of the scenic loop stands on a plot: its trees keep off them, and the billboard moved', () => {
  const group = new THREE.Group();
  const colliders: Box[] = [];
  buildScenic(group, colliders as never, nightParts());
  for (const c of colliders) for (const id of PLOT_IDS) assert.ok(!overlaps(c, PLOTS[id].box), `the scenic loop's x ${c.minX.toFixed(1)}..${c.maxX.toFixed(1)}, z ${c.minZ.toFixed(1)}..${c.maxZ.toFixed(1)} is on ${id}`);
  // Every tree, pine and bush as drawn, not only the ones with trunks you bump into.
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let checked = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const at = m.geometry.getAttribute('position');
    for (let i = 0; i < at.count; i += 3) {
      v.fromBufferAttribute(at, i).applyMatrix4(m.matrixWorld);
      // Paint on the ground (the road's verges) can run anywhere; what stands up can't be on a plot.
      if (v.y < STREET_Y + 0.2) continue;
      checked++;
      assert.ok(!inPlots(v.x, v.z), `something of the scenic loop at (${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}) is on ${plotAt(v.x, v.z)}`);
    }
  });
  assert.ok(checked > 10000, `looked at ${checked} points`);
  for (const sx of [-1, 1]) assert.ok(!inPlots(BILLBOARD.x + (sx * BILLBOARD.width) / 2, BILLBOARD.z), "the billboard's ends are on nobody's plot");
  assert.ok(BILLBOARD.z > ROAD.maxZ + 2, 'across the street from the garage');
});

test("from the roof bar, the city leaves Main Street's blocks to Main Street: no building of its own stands on them", () => {
  const night = nightParts();
  const city = buildCity(night);
  city.setFloors(15);
  city.group.updateMatrixWorld(true);
  const street = -roofDrop(15);
  const v = new THREE.Vector3();
  let checked = 0;
  city.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
    const at = m.geometry.getAttribute('position');
    for (let i = 0; i < at.count; i++) {
      v.fromBufferAttribute(at, i).applyMatrix4(m.matrixWorld);
      if (v.y < street + 0.2) continue;
      checked++;
      const on = plotAt(v.x, v.z);
      // Friday Tower is the city's own (its plaza and the tower); the rest are Main Street's to draw.
      assert.ok(on === null || on === 'P1', `the roof city has something on ${on} at (${v.x.toFixed(1)}, ${(v.y - street).toFixed(1)}, ${v.z.toFixed(1)})`);
    }
  });
  assert.ok(checked > 1000, `looked at ${checked} points`);
});

test('of the neighbours only the two out behind the tower are left, and golf bounces off the plots too', () => {
  const left = neighbourBoxes();
  assert.equal(left.length, 2);
  for (const b of left) {
    assert.ok(b.maxZ < -30, 'out behind the tower');
    assert.ok(!PLOT_IDS.some((id) => overlaps(b, PLOTS[id].box)), 'on no plot');
  }
  // A shot over toward Plot 7 lands on it while it's empty, and comes back off a shell standing there.
  const shot = { yaw: 1, loft: THREE.MathUtils.degToRad(35), power: 0.9 };
  setObstacleBoxes('mainstreet', []);
  const open = fly(shot, STREET_Y, 0);
  assert.equal(plotAt(open.rest.x, open.rest.z), 'P7', `an open plot: (${open.rest.x.toFixed(1)}, ${open.rest.z.toFixed(1)})`);
  assert.ok(inside(plateBox('P7'), open.rest.x, open.rest.z), 'right where its plate is');
  setObstacleBoxes('mainstreet', golfBoxes([card('P7', 'shell', 3)]));
  assert.ok(obstacleBoxes().some((b) => b.top === shellTop(3) && overlaps(b, PLOTS.P7.box)), "the shell is in golf's way");
  const built = fly(shot, STREET_Y, 0);
  assert.ok(!inside(plateBox('P7'), built.rest.x, built.rest.z), `not inside the shell: (${built.rest.x.toFixed(1)}, ${built.rest.z.toFixed(1)})`);
  assert.ok(built.hits.some((h) => h.kind === 'wall'), 'off its wall');
  setObstacleBoxes('mainstreet', []);
});

test("what stands on a claimed plot: walls nobody climbs, a sign at its gate or door, and golf's boxes", () => {
  for (const plot of CLAIMABLE) {
    const box = PLOTS[plot].box;
    const plate = PLOTS[plot].plate!;
    // Which way the street is from the plot.
    const toStreet = Math.sign(27 - plate.z);
    for (const stage of [null, 'site', 'shell'] as const) {
      const solids = plotSolids(plot, stage);
      for (const s of solids) assert.ok(s.minX >= box.minX && s.maxX <= box.maxX && s.minZ >= box.minZ && s.maxZ <= box.maxZ, `${plot} ${stage}: on the plot`);
      const spot = signSpot(plot, stage);
      assert.equal(plotAt(spot.x, spot.z), plot, `${plot} ${stage}: its sign is on it`);
      assert.ok(!solids.some((s) => inside(s, spot.x, spot.z, 0.35)), `${plot} ${stage}: you can stand at its sign`);
      assert.ok(Math.sign(spot.z - plate.z) === toStreet, `${plot} ${stage}: its sign is on the street side`);
      if (stage) assert.ok(!inside(claimedBox(plot), spot.x, spot.z), `${plot} ${stage}: outside what it takes up`);
    }
    // A site's hoarding all the way round what it takes up, and its crane's yard; a shell's plate.
    const site = plotSolids(plot, 'site').filter((s) => s.top === WALL);
    const ring = claimedBox(plot);
    for (const [x, z] of [
      [ring.minX + 0.05, (ring.minZ + ring.maxZ) / 2],
      [ring.maxX - 0.05, (ring.minZ + ring.maxZ) / 2],
      [(ring.minX + ring.maxX) / 2, ring.minZ + 0.05],
      [(ring.minX + ring.maxX) / 2, ring.maxZ - 0.05],
    ])
      assert.ok(site.some((s) => inside(s, x, z)), `${plot}: the hoarding at (${x}, ${z})`);
    assert.deepEqual(plotSolids(plot, 'shell'), [{ ...plateBox(plot), bottom: 0, top: WALL }]);
    // Golf's boxes are within what Friday One keeps clear of, and no taller.
    for (const stage of ['site', 'shell'] as const) {
      const solids = businessBoxes([card(plot, stage, 6)]);
      for (const g of golfBoxes([card(plot, stage, 6)])) assert.ok(solids.some((s) => g.minX >= s.minX - 1e-9 && g.maxX <= s.maxX + 1e-9 && g.minZ >= s.minZ - 1e-9 && g.maxZ <= s.maxZ + 1e-9 && g.top <= s.top), `${plot} ${stage}`);
    }
    assert.equal(golfBoxes([card(plot, 'site')]).length, 5, 'four walls of hoarding and the mast');
    assert.deepEqual(golfBoxes([card(plot, 'shell', 2)]), [{ ...plateBox(plot), top: shellTop(2) }]);
  }
  // Plot 7 is turned to face the street: its gate's on its north side.
  assert.ok(signSpot('P7', 'site').z < PLOTS.P7.plate!.z - PLATE.halfZ - HOARDING.out);
  assert.ok(Math.abs(signSpot('P2', 'site').z - (GATE.front + 1.4)) < 1e-9);
  for (const plot of CLAIMABLE) for (const k of kerbSolids(plot)) assert.ok(k.top < 0.3, 'a kerb is stepped over');
});

test('a crane goes round once a period on the office clock, the same on every page, its load over the site', () => {
  const base = 1_700_000_000_000;
  for (const plot of CLAIMABLE) {
    let last = craneMotion(plot, base).slew;
    let turned = 0;
    for (let ms = 250; ms <= CRANE.period * 1000; ms += 250) {
      const m = craneMotion(plot, base + ms);
      const step = Math.atan2(Math.sin(m.slew - last), Math.cos(m.slew - last));
      assert.ok(step >= -1e-9 && step < 0.2, `${plot} slews smoothly one way`);
      turned += step;
      last = m.slew;
      assert.ok(m.trolley > 1 && m.trolley < CRANE.jib, 'the trolley stays on the jib');
      // The hook block and the load under it stay up over the hoarding and the site's offices.
      assert.ok(CRANE.jibY - m.hook - 2.5 > 6, `the load's ${(CRANE.jibY - m.hook - 2.5).toFixed(1)} m up`);
    }
    assert.ok(Math.abs(turned - Math.PI * 2) < 0.05, `${plot} turned ${turned.toFixed(2)}`);
    assert.deepEqual(craneMotion(plot, 123_456_789), craneMotion(plot, 123_456_789));
  }
});

test('Main Street lights two lamps on a floor, the roof bar copy none, and a floor stays within the sky’s lamps', () => {
  // What a floor lights today, built as the office builds it: the street lamps, golf's, the
  // forecourt's two and the one over the exit; and the balcony's two string-light lamps (world/office/
  // balcony.ts, which can't be built here: its plants are Blender models).
  const night = nightParts();
  buildStreet(new THREE.Group(), [], night, new THREE.Group());
  buildGreen(new THREE.Group(), [], night);
  forecourt({ group: new THREE.Group(), colliders: [], interactables: [], ground: new THREE.Group(), groundColliders: [], get: () => night } as never);
  exitDoor(night);
  const BALCONY_LAMPS = 2;
  const today = night.lamps.length + BALCONY_LAMPS;
  assert.equal(today, 20);
  buildMainStreet({ night, lamps: { base: STREET_Y } });
  const ours = night.lamps.slice(today - BALCONY_LAMPS);
  assert.equal(ours.length, 2, 'the floodlight and the map board');
  for (const l of ours) {
    assert.equal(l.ground, true, 'down by the street, so it goes down with it');
    assert.equal(plotAt(l.x, l.z), 'P5');
    assert.ok(l.y > STREET_Y && l.y < STREET_Y + 8);
  }
  assert.ok(ours.some((l) => Math.hypot(l.x - PARK.flood.x, l.z - PARK.flood.z) < 1 && l.reach === PARK.flood.reach), 'the floodlight over the pad');
  assert.ok(today + ours.length + PUTT.lamps.length <= MAX_LAMPS, `${today} + ${ours.length} + Putt Street's ${PUTT.lamps.length} of ${MAX_LAMPS}`);
  // The roof's copy, and golf's hole 1 built for it, light nothing of the floor's and push no halos,
  // but its bulbs and windows still glow at night.
  const before = { lamps: night.lamps.length, halos: night.halos.length, bulbs: night.bulbs.length, windows: night.windows.length };
  const roof = lampless(night);
  buildMainStreet({ night: roof, lamps: null });
  buildGreen(new THREE.Group(), [], roof);
  assert.equal(night.lamps.length, before.lamps);
  assert.equal(night.halos.length, before.halos);
  assert.ok(night.bulbs.length > before.bulbs && night.windows.length > before.windows, 'the same bulbs and windows the sky lights');
});

test('a plot rebuilds only when its card changes, and frees what it built', () => {
  const night = nightParts();
  const street = buildMainStreet({ night, lamps: null });
  const windows = night.windows.length;
  const bulbs = night.bulbs.length;
  const free = street.solids().length;
  assert.equal(street.spots().length, 4, 'the map board and three FOR LEASE boards');
  assert.equal(street.show([]), false);
  assert.equal(street.show([card('P3', 'site'), card('P7', 'shell', 8, 'Zed')]), true);
  assert.ok(street.solids().length > free);
  const spots = street.spots();
  assert.equal(spots.filter((s) => s.kind === 'plotsign').length, 3);
  const p7 = spots.find((s) => s.plot === 'P7')!;
  assert.deepEqual({ x: p7.x, z: p7.z }, signSpot('P7', 'shell'));
  assert.equal(street.show([card('P3', 'site'), card('P7', 'shell', 8, 'Zed')]), false, 'the same cards: nothing to do');
  street.show([]);
  assert.equal(street.solids().length, free, 'back to for lease');
  // Building and pulling down shells and sites gives the sky nothing more to light each time.
  assert.equal(night.windows.length, windows);
  assert.equal(night.bulbs.length, bulbs);
  street.update(42_000, 1);
});

test("on a floor, the plots' colliders and signs come and go with the street, and go down with it", () => {
  const night = nightParts();
  const site = { group: new THREE.Group(), colliders: [] as { minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom?: number }[], interactables: [] as { kind: string; x: number; z: number; y?: number; plot?: string }[], ground: new THREE.Group(), groundColliders: [], get: () => night };
  store.apply({ t: 'street', street: { cards: [] } } as ServerMsg);
  const built = mainStreet(site as never);
  assert.equal(night.lamps.length, 2);
  const down = (index: number) => built.setLevel!(index, 4, []);
  down(2);
  const street = streetBelow(2);
  // The pad's deck, a step up from the street wherever the street is.
  const pad = site.colliders.find((c) => inside(c, PARK.pad.x, PARK.pad.z + 0.5));
  assert.ok(pad && Math.abs(pad.bottom! - street) < 1e-9 && Math.abs(pad.top - (street + PARK.pad.deck)) < 1e-9, 'the deck goes down with the street');
  for (const it of site.interactables) assert.equal(it.y, street, `${it.kind} is down on the street`);
  // Claimed while you're up on floor 2: the site's walls stand on the street down there, into the sky.
  store.apply({ t: 'street', street: { cards: [card('P2', 'site')] } } as ServerMsg);
  const gate = site.interactables.find((it) => it.plot === 'P2')!;
  assert.deepEqual({ x: gate.x, z: gate.z, y: gate.y }, { ...signSpot('P2', 'site'), y: street });
  const walls = site.colliders.filter((c) => c.top === WALL && overlaps(c, PLOTS.P2.box));
  assert.ok(walls.length >= 5, 'the hoarding and the crane yard');
  for (const w of walls) assert.equal(w.bottom, street);
  // Back down to the bottom floor, and the plot released: its walls go, the FOR LEASE board's back.
  down(0);
  assert.ok(walls.every((w) => w.bottom === STREET_Y));
  assert.equal(gate.y, STREET_Y);
  store.apply({ t: 'street', street: { cards: [] } } as ServerMsg);
  assert.ok(!site.colliders.some((c) => walls.includes(c)), 'the walls are gone');
  const board = site.interactables.find((it) => it.plot === 'P2')!;
  assert.deepEqual({ x: board.x, z: board.z, y: board.y }, { ...signSpot('P2', null), y: STREET_Y });
  assert.ok(!obstacleBoxes().some((b) => overlaps(b, PLOTS.P2.box)), "nothing of it left in golf's way");
});
