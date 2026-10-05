// Friday One's flight, what it flies in and where it may land (shared/heli.ts, heli-world.ts and
// heli-terrain.ts), flown here as the pilot's page flies it: it never gets into the tower from any side
// or height, nor swings its tail into a wall, nor goes through the farm, the lighthouse, the rocks by
// the tunnel, the back offices, bar 2's overhang or a crane's jib; it sets down only slowly, on level
// ground, and never anywhere it mustn't; the ground it flies over is never under the mountains the
// page draws; and its downwash only pushes people on the ground under it while it's flying.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BODY, FLIGHT, HELI, LAND_HOLD, WASH, bodyHit, fly, groundUnder, homePose, rotorWash, type Flight, type FlyWorld, type Flown, type HeliInput } from '../src/shared/heli.js';
import { heliSolids, heliTerrain, heliTerrainOver, onPad, whyNotLand } from '../src/shared/heli-world.js';
import { GOLF_HOLE, STREET_Y, roofDrop } from '../src/shared/layout.js';
import { CRANE, GROUNDS, PARK, PLOTS, craneAt, inPlots, type Solid } from '../src/shared/mainstreet.js';
import { FARM, FOOTHILLS, LAKE, LIGHTHOUSE, MOUNTAINS, SPURS, shoreX } from '../src/shared/scenic.js';
import type { BusinessCard, HeliPose } from '../src/shared/protocol.js';
import { neighbourBoxes } from '../src/client/world/outside.js';
import { buildMountains } from '../src/client/world/scenic/mountains.js';
import { buildTunnel } from '../src/client/world/scenic/tunnel.js';

// The tunnel's signs are painted on canvases, which is all they need of a page.
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : () => {}), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const card = (plot: BusinessCard['plot'], stage: BusinessCard['stage'], storeys = 3): BusinessCard =>
  ({ id: `b-${plot}`, name: 'Acme', plot, accent: '#ff8800', skin: 'glass', stage, home: 'hosted', storeys: Array.from({ length: storeys }, () => ({ name: 'Acme', accent: '#ff8800' })) }) as unknown as BusinessCard;

/** The world the pilot's page flies in, with the tower 15 storeys tall, three of them real floors. */
function world(cards: BusinessCard[] = [], real = 3): FlyWorld {
  return { solids: heliSolids(15, cards, real), terrain: heliTerrain, terrainOver: heliTerrainOver, whyNotLand: (x, z, yaw) => whyNotLand(x, z, yaw, cards) };
}
const flying = (x: number, h: number, z: number, yaw = 0): Flight => ({ pose: { x, h, z, yaw, pitch: 0, roll: 0, spin: 1 }, vx: 0, vz: 0, vh: 0, landed: false });
const keys = (forward = 0, turn = 0, lift = 0): HeliInput => ({ forward, turn, lift, engine: true });

/** Flies `f` for `seconds` with `input`, a step at a time, calling `each` after every step. */
function run(f: Flight, input: HeliInput, seconds: number, w: FlyWorld, each?: (f: Flight, out: Flown) => void | boolean) {
  const out: Flown = { bump: 0, touchdown: false, liftoff: false, refused: null, edge: false };
  for (let t = 0; t < seconds; t += FLIGHT.step) {
    fly(f, input, FLIGHT.step, w, out);
    if (each?.(f, out) === false) return;
  }
}

/** The heading from (x, z) to (tx, tz). */
const toward = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

test("it can't get into Friday Tower from any side or at any height", () => {
  const w = world();
  const tower = w.solids[0];
  assert.deepEqual([tower.minX, tower.maxX, tower.minZ, tower.maxZ, tower.top], [-18.3, 18.3, -13.3, 13.3, roofDrop(15)]);
  let tried = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (const h of [2, 12, 40, 60, 75, 100, 108]) {
      const f = flying(Math.sin(a) * 45, h, Math.cos(a) * 45);
      f.pose.yaw = toward(f.pose.x, f.pose.z, 0, 0);
      // From wherever's clear (the neighbours behind it stand in some of these at the bottom).
      if (bodyHit(f.pose, w.solids)) continue;
      tried++;
      let bumped = 0;
      run(f, keys(1), 8, w, (g, out) => {
        bumped = Math.max(bumped, out.bump);
        assert.equal(bodyHit(g.pose, w.solids), null, `in something at (${g.pose.x.toFixed(1)}, ${g.pose.h.toFixed(1)}, ${g.pose.z.toFixed(1)}) from ${k}/16 at ${h} m`);
      });
      assert.ok(bumped > 0, `it hit the tower from ${k}/16 at ${h} m`);
      assert.ok(Math.abs(f.pose.x) > 18.3 + HELI.rotor - 0.01 || Math.abs(f.pose.z) > 13.3 + HELI.rotor - 0.01 || f.pose.h + BODY.bottom >= roofDrop(15), 'and stopped outside it');
    }
  }
  assert.ok(tried > 100, `flew at it ${tried} ways`);
  // Nor down onto the roof through its clutter, nor up through it from the street.
  const down = flying(0, 140, 0);
  run(down, keys(0, 0, -1), 20, w, (g) => assert.equal(bodyHit(g.pose, w.solids), null));
  assert.ok(down.pose.h + BODY.bottom >= roofDrop(15) + 1.2, `held over the roof at ${down.pose.h.toFixed(2)}`);
  // In its walls, its roof's clutter, over its east end, and its mast.
  for (const [x, h, z] of [[0, 50, 0], [-10, roofDrop(15) + 0.5, 5], [20, 60, 0], [8.5, roofDrop(15) + 18, -12]]) assert.notEqual(bodyHit({ x, h, z, yaw: 0, pitch: 0, roll: 0, spin: 1 }, w.solids), null, `(${x}, ${h}, ${z}) is in it`);
});

test("turning beside a wall can't swing the tail into it", () => {
  const w = world();
  // Hovering off the tower's east end, nose to it and tail out, close enough that a full turn would sweep the tail through it.
  for (const h of [20, 90]) {
    const f = flying(18.3 + HELI.rotor + 0.4, h, 0, -Math.PI / 2);
    assert.equal(bodyHit(f.pose, w.solids), null);
    let turned = 0;
    let last = f.pose.yaw;
    run(f, keys(0, 1), 8, w, (g) => {
      assert.equal(bodyHit(g.pose, w.solids), null, `the tail's in the wall at yaw ${g.pose.yaw.toFixed(2)}`);
      turned += Math.abs(Math.atan2(Math.sin(g.pose.yaw - last), Math.cos(g.pose.yaw - last)));
      last = g.pose.yaw;
    });
    assert.ok(turned < Math.PI, `it stopped turning short of the wall (turned ${turned.toFixed(2)})`);
    // Turning the other way, the tail swings round toward it from the other side, and stops there too.
    const back = flying(18.3 + HELI.rotor + 0.4, h, 0, -Math.PI / 2);
    run(back, keys(0, -1), 3, w, (g) => assert.equal(bodyHit(g.pose, w.solids), null));
  }
  // Backing toward the tower, it's the tail that stops it.
  const f = flying(0, 30, 13.3 + HELI.tail + 3, 0);
  run(f, keys(-1), 6, w, (g) => assert.equal(bodyHit(g.pose, w.solids), null));
  assert.ok(f.pose.z - HELI.tail >= 13.3 - 0.3, `the tail's end at ${(f.pose.z - HELI.tail).toFixed(2)}`);
});

test("it can't fly through a crane's jib, the farm, the lighthouse, the rocks by the tunnel, the back offices or bar 2's overhang", () => {
  const site = [card('P3', 'site')];
  const w = world(site);
  const jib = craneAt('P3');
  // [what, x, h, z, how far out it starts from there, how near it may get].
  const targets: [string, number, number, number, number, number][] = [
    ["P3's jib sweep", jib.x, CRANE.jibY - 1.5, jib.z, CRANE.jib + 20, CRANE.jib],
    ['the silo', FARM.silo.x, 8, FARM.silo.z, 30, 2],
    ['the barn', FARM.barn.x, 4, FARM.barn.z, 30, 2],
    ['the windmill', FARM.windmill.x, 8, FARM.windmill.z, 30, 2],
    ["the windmill's sails", FARM.windmill.x + 6, 16, FARM.windmill.z + 3.35, 30, 2],
    ['the lighthouse', LIGHTHOUSE.x, 15, LIGHTHOUSE.z, 30, 2],
    ...SPURS.map(([x, z, , hgt], i) => [`spur rock ${i}`, x, hgt * 0.5, z, 40, 2] as [string, number, number, number, number, number]),
    ['the back offices', 15.7, 10, -20, 30, 2],
  ];
  for (const [what, x, h, z, from, near] of targets) {
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = flying(x + Math.sin(a) * from, h, z + Math.cos(a) * from);
      f.pose.yaw = toward(f.pose.x, f.pose.z, x, z);
      // Over the ground there, whatever it is.
      f.pose.h = Math.max(h, groundUnder(f.pose, w) + 0.5);
      if (bodyHit(f.pose, w.solids)) continue;
      let closest = Infinity;
      run(f, keys(1), 6, w, (g) => {
        assert.equal(bodyHit(g.pose, w.solids), null, `into ${what} at (${g.pose.x.toFixed(1)}, ${g.pose.h.toFixed(1)}, ${g.pose.z.toFixed(1)})`);
        assert.ok(g.pose.h >= groundUnder(g.pose, w) - 1e-6, `under the ground by ${what}`);
        // A rock it may fly over: only getting to its middle lower than its top counts.
        if (!what.startsWith('spur') || g.pose.h + BODY.bottom < heliTerrain(x, z)) closest = Math.min(closest, Math.hypot(g.pose.x - x, g.pose.z - z));
      });
      assert.ok(closest > near, `it got to ${what} (${closest.toFixed(2)} m from it)`);
    }
  }
  // Climbing straight up under bar 2's overhang (x -20.7..-18.3, from 53 m), it stops under it.
  const under = flying(-18.3 - HELI.rotor - 0.1, 40, 0);
  run(under, keys(0, 0, 1), 6, w, (g) => assert.equal(bodyHit(g.pose, w.solids), null));
  assert.ok(under.pose.h + BODY.top <= 53.01 && under.pose.h > 45, `held under the overhang at ${under.pose.h.toFixed(2)}`);
  // With eight real floors, storey 7 is a real floor's, the building's width: bar 2 overhangs from storey 8.
  const eight = world([], 8);
  assert.equal(bodyHit({ ...under.pose, h: 55 }, eight.solids), null, 'storey 7 is a real floor');
  assert.notEqual(bodyHit({ ...under.pose, h: 62 }, eight.solids), null, 'storey 8 is bar 2');
});

test('the two neighbours behind the tower are as solid as the page has them', () => {
  const solids = heliSolids(15, [], 3);
  const plot = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => inPlots(b.minX, b.minZ) || inPlots(b.maxX, b.maxZ) || inPlots(b.minX, b.maxZ) || inPlots(b.maxX, b.minZ);
  const behind = neighbourBoxes().filter((b) => !plot(b));
  assert.equal(behind.length, 2, 'two of them are off Main Street');
  for (const b of behind) assert.ok(solids.some((s) => s.minX === b.minX && s.maxX === b.maxX && s.minZ === b.minZ && s.maxZ === b.maxZ && s.top === b.top), `the neighbour at (${b.minX}, ${b.minZ})`);
});

test('it lifts off only once the rotor is up to speed, and sets down only slowly and level', () => {
  const w = world();
  const f: Flight = { pose: homePose(), vx: 0, vz: 0, vh: 0, landed: true };
  let liftoff = -1;
  let t = 0;
  run(f, keys(0, 0, 1), 4, w, (g, out) => {
    t += FLIGHT.step;
    if (out.liftoff) liftoff = t;
    if (g.pose.spin < FLIGHT.lift) assert.ok(g.landed && g.pose.h === PARK.pad.deck, `still down at spin ${g.pose.spin.toFixed(2)}`);
  });
  assert.ok(Math.abs(liftoff - FLIGHT.lift * FLIGHT.spoolUp) < 0.05, `off the pad at ${liftoff.toFixed(2)} s`);
  assert.ok(f.pose.h > PARK.pad.deck + 1, 'and climbing');
  // Straight down over the street (its tail over the park, not the lot), it slows near the ground and sets down.
  const g = flying(0, 20, 27, Math.PI);
  let down: number | null = null;
  run(g, keys(0, 0, -1), 20, w, (q, out) => {
    if (q.pose.h - groundUnder(q.pose, w) < FLIGHT.near - 0.1) assert.ok(q.vh >= -FLIGHT.sinkNear - 1e-9, 'gently near the ground');
    if (out.touchdown) down = q.pose.h;
    return !out.touchdown;
  });
  assert.equal(down, 0, 'down on the street');
  assert.ok(g.landed && g.vx === 0 && g.vz === 0);
  // Too fast across the ground, it skims along until it's slowed.
  const fast = flying(-60, 0.05, 27, Math.PI / 2);
  fast.vx = 10;
  let landedAt = Infinity;
  run(fast, keys(0, 0, -1), 4, w, (q, out) => {
    if (out.touchdown) {
      landedAt = Math.hypot(q.vx, q.vz);
      return false;
    }
    if (q.landed === false) assert.ok(Math.hypot(q.vx, q.vz) > 0 || q.pose.h > 0);
  });
  assert.ok(fast.landed, 'it sets down once it has slowed');
  assert.ok(landedAt === 0);
  // On a slope it won't, and holds a hover.
  const [fx, fz, fr] = FOOTHILLS[0];
  const slope = flying(fx - fr * 0.6, 60, fz);
  run(slope, keys(0, 0, -1), 30, w);
  assert.ok(!slope.landed, 'not on a hillside');
});

test("it never sets down where it mustn't, its tail included, and always may on its pad", () => {
  const taken = [card('P2', 'site')];
  const no: [string, number, number, number][] = [
    ['the lot, where the parachutes come down', -2.8, 19.3, 0],
    ["the garage's mouth", 0, 15, 0],
    ['the lot down the east side', 24, 0, 0],
    ['the green', GOLF_HOLE.x, GOLF_HOLE.z, 0],
    ['the flagstick, straddled', GOLF_HOLE.x + 1.15, GOLF_HOLE.z, Math.PI / 2],
    ['the sea', shoreX(120) - 10, 120, 0],
    ['the edge of the sea', shoreX(120) + 2, 120, 0],
    ['the lake', LAKE.x, LAKE.z, 0],
    ['the edge of the lake', LAKE.x + LAKE.rx + 3, LAKE.z, 0],
    ['Putt Street', -56, 56, 0],
    ['a claimed plot', PLOTS.P2.plate!.x, PLOTS.P2.plate!.z, 0],
    ['the edge of a claimed plot', PLOTS.P2.plate!.x + 18.3 + 1 + HELI.rotor - 0.5, 0, 0],
    ['a hillside', FOOTHILLS[0][0], FOOTHILLS[0][1], 0],
    ['past the edge of town', GROUNDS + 5, 0, 0],
    ['the windsock', PARK.windsock.x, PARK.windsock.z + 2, 0],
    ['a bench', PARK.benches[0].x, PARK.benches[0].z, 0],
  ];
  for (const [what, x, z, yaw] of no) assert.ok(whyNotLand(x, z, yaw, taken), `may not land on ${what}`);
  // Its tail counts: nose to the street with the lot behind it, no; turned round, yes.
  assert.ok(whyNotLand(0, 26.5, 0, []), 'not with its tail over the lot');
  assert.equal(whyNotLand(0, 26.5, Math.PI, []), null, 'on the street, its tail over the park');
  // Its pad, Main Street's lawns for lease, the street, the beach, the meadow.
  for (const [x, z] of [[PARK.pad.x, PARK.pad.z], [PARK.pad.x + 3, PARK.pad.z], [-56, 0], [56, 54], [60, 27], [-235, 120], [150, -60]]) assert.equal(whyNotLand(x, z, 0, []), null, `(${x}, ${z})`);
  assert.ok(onPad(PARK.pad.x, PARK.pad.z) && !onPad(PARK.pad.x + 6, PARK.pad.z));
  // Coming down over one of them, it holds its hover and says why.
  const w = world(taken);
  for (const [what, x, z, yaw] of no.slice(0, 10)) {
    const f = flying(x, 12, z, yaw);
    let why: string | null = null;
    run(f, keys(0, 0, -1), 15, w, (_, out) => {
      why = out.refused ?? why;
    });
    assert.ok(!f.landed && f.pose.h >= LAND_HOLD - 0.05 + groundUnder(f.pose, w) - 0.1, `held over ${what} at ${f.pose.h.toFixed(2)}`);
    assert.ok(why, `and said why over ${what}`);
  }
  // And on its pad it comes down on the deck.
  const pad = flying(PARK.pad.x, 8, PARK.pad.z, PARK.pad.yaw);
  run(pad, keys(0, 0, -1), 15, w, (_, out) => !out.touchdown);
  assert.ok(pad.landed && Math.abs(pad.pose.h - PARK.pad.deck) < 1e-9, `on the deck at ${pad.pose.h}`);
});

test('the ground is never under the mountains, hills and tunnel spur the page draws', () => {
  // The two the critique measured: well over the plain cones.
  const [fx, fz, , fh] = FOOTHILLS[0];
  assert.ok(heliTerrain(fx + 15, fz) >= fh * 0.5 + 7, 'foothill [60, 412]');
  const [mx, mz, , mh] = MOUNTAINS[3];
  assert.ok(heliTerrain(mx + 45, mz) >= mh * 0.5 + 10.5, 'mountain [5, 480]');
  // Every bit of every triangle of them, as the page builds them.
  const root = new THREE.Group();
  buildMountains({ root, colliders: [], taken: [] } as never);
  const g = () => new THREE.Group();
  const night = { bulbs: [], halos: [], lamps: [], windows: [], glows: [], street: STREET_Y };
  const parts = { road: g(), farm: g(), forest: g(), mountains: g(), beach: g(), meadow: g(), coast: g() };
  const tunnel = new THREE.Group();
  buildTunnel({ root: tunnel, labels: g(), parts, colliders: [], night, cullable: () => {}, around: () => {}, taken: [] } as never, { asphalt: null, roadU: () => 0 } as never);
  tunnel.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'ExtrudeGeometry') root.add(o.clone());
  });
  root.updateMatrixWorld(true);
  let worst = -Infinity;
  let at = '';
  let checked = 0;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    const index = m.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
      const N = 6;
      for (let a = 0; a <= N; a++) {
        for (let b = 0; a + b <= N; b++) {
          const c = N - a - b;
          const x = (v[0].x * a + v[1].x * b + v[2].x * c) / N;
          const y = (v[0].y * a + v[1].y * b + v[2].y * c) / N - STREET_Y;
          const z = (v[0].z * a + v[1].z * b + v[2].z * c) / N;
          const over = y - heliTerrain(x, z);
          checked++;
          if (over > worst) [worst, at] = [over, `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`];
        }
      }
    }
  });
  assert.ok(checked > 50000, `looked at ${checked} points`);
  assert.ok(worst <= 0, `the rock is ${worst.toFixed(2)} m over the ground at ${at}`);
  // The rocks' cores the office counts as solid are inside the rock the page draws.
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (const [x, z, r, h] of SPURS) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const d = (r * 0.45 * (k % 3)) / 2;
      ray.set(new THREE.Vector3(x + Math.sin(a) * d, STREET_Y + 300, z + Math.cos(a) * d), down);
      const hit = ray.intersectObject(root, true)[0];
      assert.ok(hit && hit.point.y - STREET_Y >= h * 0.28, `the rock's core at (${x}, ${z}) is in it`);
    }
  }
  // A box's ground is the most of any point's in it.
  for (const [x, z] of [[60, 412], [5, 470], [-20, 380], [276, 262]]) {
    const over = heliTerrainOver(x - 4, x + 4, z - 4, z + 4);
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) assert.ok(over >= heliTerrain(x - 4 + i, z - 4 + j) - 1e-9);
  }
  assert.equal(heliTerrain(0, 100), 0, 'flat in town');
  assert.equal(heliTerrain(PARK.pad.x, PARK.pad.z), PARK.pad.deck, 'the deck on the pad');
});

test('it stays under the ceiling and inside the edge of town', () => {
  const w = world();
  const up = flying(0, 150, 200);
  run(up, keys(0, 0, 1), 20, w, (g) => assert.ok(g.pose.h <= FLIGHT.ceiling + 1e-9));
  assert.ok(Math.abs(up.pose.h - FLIGHT.ceiling) < 1e-6, 'right up to it');
  const out = flying(0, 150, -300, -Math.PI / 2);
  let edge = false;
  let furthest = 0;
  run(out, keys(1), 40, w, (g, o) => {
    edge ||= !!o.edge;
    furthest = Math.max(furthest, Math.hypot(g.pose.x, g.pose.z));
  });
  assert.ok(edge, "it said it's the edge of town");
  assert.ok(furthest < GROUNDS + 5, `no further than ${furthest.toFixed(1)} m out`);
});

test('its downwash pushes only people on the ground under it, and only while it flies', () => {
  const pose: HeliPose = { x: 0, h: 4, z: 27, yaw: 0, pitch: 0, roll: 0, spin: 1 };
  const out = { x: 0, z: 0 };
  const push = (p: HeliPose, landed: boolean, at: { x: number; h: number; z: number }, ground = 0) => Math.hypot(...Object.values(rotorWash(p, landed, at, out, ground)));
  const near = { x: 3, h: 0, z: 27 };
  assert.ok(push(pose, false, near) > 0.5 && out.x > 0 && Math.abs(out.z) < 1e-9, 'out, away from the hub');
  assert.ok(push(pose, false, near) <= WASH.push);
  assert.ok(push(pose, false, { x: 1, h: 0, z: 27 }) > push(pose, false, { x: 5, h: 0, z: 27 }), 'harder near the hub');
  assert.equal(push(pose, false, { x: WASH.reach + 0.1, h: 0, z: 27 }), 0, 'nothing past its reach');
  assert.equal(push(pose, true, near), 0, 'nothing while it is down');
  assert.equal(push({ ...pose, spin: 0.45 }, false, near), 0, 'nothing while it spins down');
  assert.equal(push({ ...pose, h: WASH.below + 0.5 }, false, near), 0, 'nothing from high up');
  assert.equal(push(pose, false, { x: 3, h: 3.6, z: 27 }), 0, 'nothing for someone up on a balcony');
  assert.ok(push({ ...pose, h: 4.25 }, false, { x: 3, h: 0.25, z: 27 }, 0.25) > 0, 'someone on a deck, over its ground');
  assert.ok(push(pose, false, { x: 0, h: 0, z: 27 }) > 0, 'right under it, out to the side');
});

test('what it bumps into, its body and tail, against round solids and boxes', () => {
  const round: Solid[] = [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2, bottom: 0, top: 10, round: { x: 0, z: 0, r: 2 } }];
  const at = (x: number, z: number, yaw = 0, h = 1): HeliPose => ({ x, h, z, yaw, pitch: 0, roll: 0, spin: 1 });
  assert.notEqual(bodyHit(at(5.5, 0), round), null, "the rotor's square reaches 3.9 m");
  assert.equal(bodyHit(at(6.1, 0), round), null);
  // The tail, behind it: 7.3 m back, whichever way it's turned.
  assert.notEqual(bodyHit(at(0, 8, 0), round), null, 'its tail, nose south');
  assert.equal(bodyHit(at(0, 8, Math.PI), round), null, 'nose north, the tail the other way');
  assert.notEqual(bodyHit(at(8, 0, Math.PI / 2), round), null, 'nose east, the tail west');
  // Under or over it, nothing.
  assert.equal(bodyHit(at(0, 0, 0, 10.5), round), null);
});
