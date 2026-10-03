import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import type { FurnitureKind } from '../src/shared/furniture.js';
import { WALL_HEIGHT } from '../src/shared/layout.js';
import { assertInFootprint, fmt, kind, near, openPack } from './model-pack';

// studio.glb (exported by blender/scripts/build_studio.py) against what world/office/furniture-studio.ts
// and the catalog (shared/furniture.ts) count on: the studio's pieces by name, each a root at the origin
// facing +z and inside its kind's footprint, the materials the code paints, tops where the colliders'
// are, and room for what the code lays over the model: a screen's face, the ticker's, a neon sign's words.

const studio = openPack('studio');

/** Each piece, and the kind it's built for. */
const PIECES: Record<string, FurnitureKind> = {
  long_table: 'long-table',
  podcast_desk: 'podcast-desk',
  screen: 'screen',
  ticker: 'ticker',
  softbox: 'softbox',
  camera: 'camera',
  backdrop: 'backdrop',
  lounge_chair: 'lounge-chair',
  stool: 'stool',
  credenza: 'credenza',
  neon: 'neon',
};
const NAMES = Object.keys(PIECES);
/** What hangs from the ceiling, over a footprint nothing stands in the way under. */
const HUNG = ['ticker', 'neon'];
/** STUDIO_COLORS in furniture-studio.ts, Tally, and what it paints each piece's own color. */
const MATERIALS = ['Steel', 'Chrome', 'Oak', 'Shade', 'Camera', 'Lens', 'Panel', 'Tally', 'Top', 'Body', 'Glow', 'Paper', 'Cloth', 'Cabinet', 'Neon'];
const MADE_OF: Record<string, string[]> = {
  long_table: ['Steel', 'Top'],
  podcast_desk: ['Chrome', 'Steel', 'Top'],
  screen: ['Body', 'Oak', 'Steel'],
  ticker: ['Steel'],
  softbox: ['Chrome', 'Glow', 'Shade', 'Steel'],
  camera: ['Camera', 'Chrome', 'Lens', 'Steel', 'Tally'],
  backdrop: ['Chrome', 'Paper', 'Steel'],
  lounge_chair: ['Cloth', 'Oak'],
  stool: ['Cloth', 'Oak', 'Steel'],
  credenza: ['Cabinet', 'Steel'],
  neon: ['Chrome', 'Neon', 'Panel', 'Steel'],
};
/** FACE, TICKER and NEON in furniture-studio.ts: what the code lays over the model, and where. */
const FACE = { w: 1.98, h: 1.11, y: 1.22, z: 0.032 };
const TICKER = { w: 5.84, h: 0.3, y: 2.42, z: 0.072 };
const NEON = { w: 2.1, h: 0.42, y: 1.9, z: 0.083 };

const highest = (vs: Vector3[]) => Math.max(...vs.map((v) => v.y));

test('it is the studio\'s pieces, each a root node at the origin, facing +z as modelled', () => {
  assert.deepEqual(studio.nodes.map((n) => n.name ?? '').sort(), [...NAMES].sort(), 'only the pieces, each named once');
  for (const name of NAMES) assert.equal(studio.parentName(studio.byName(name)), undefined, `${name} hangs from nothing`);
  studio.assertPlaced(NAMES);
});

test('its materials are the ones furniture-studio.ts paints, and each piece is made of its own', () => {
  const names = studio.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const name of NAMES) assert.deepEqual(studio.madeOf(name), MADE_OF[name], `${name} is made of ${studio.madeOf(name)}`);
});

test('every piece is inside its kind\'s footprint, and stands on the floor unless it hangs', () => {
  for (const name of NAMES) {
    assertInFootprint(name, studio.vertices(name), kind(PIECES[name]));
    const box = studio.bounds(name);
    if (HUNG.includes(name)) {
      // Over your head, on wires up to the ceiling.
      assert.ok(box.min.y > 1.5, `${name} hangs clear of the floor (${box.min.y.toFixed(3)})`);
      assert.ok(box.max.y > WALL_HEIGHT - 0.05 && box.max.y <= WALL_HEIGHT + 1e-3, `${name} hangs from the ceiling (${box.max.y.toFixed(3)})`);
    } else assert.ok(near(box.min.y, 0, 0.003), `${name} stands on the floor (${box.min.y.toFixed(3)})`);
  }
  // What's the same either side is centred on its origin.
  for (const name of ['long_table', 'credenza', 'stool', 'ticker']) {
    const middle = studio.bounds(name).getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 0.01, `${name} is centred on its origin (${fmt(middle)})`);
  }
});

test('what stands on the floor is as high as its collider, or a little under', () => {
  // A table's top, a cabinet's and a stool's seat are where their colliders' tops are: what you'd stand on.
  for (const [name, material] of [
    ['long_table', 'Top'],
    ['podcast_desk', 'Top'],
    ['credenza', 'Cabinet'],
    ['stool', 'Cloth'],
  ] as const) {
    const top = highest(studio.vertices(name, [material]));
    assert.ok(near(top, kind(PIECES[name]).top, 0.005), `${name}'s ${material} is ${top.toFixed(3)} m up, its collider ${kind(PIECES[name]).top}`);
  }
  // The chair's seat cushion, in front of its back cushion and between its arms.
  const seat = highest(studio.vertices('lounge_chair', ['Cloth']).filter((v) => Math.abs(v.x) < 0.25 && v.z > 0.05));
  assert.ok(near(seat, kind('lounge-chair').top, 0.005), `the lounge chair's seat is ${seat.toFixed(3)} m up`);
  // The tall things come up to their colliders' tops, near enough.
  for (const name of ['screen', 'softbox', 'camera', 'backdrop']) {
    const top = studio.bounds(name).max.y;
    const most = kind(PIECES[name]).top;
    assert.ok(top <= most + 0.005 && top > most - 0.12, `${name} is ${top.toFixed(3)} m tall, its collider ${most}`);
  }
});

test('the long table and the podcast desk are oak tops on steel, the desk with a mic either side', () => {
  for (const name of ['long_table', 'podcast_desk']) {
    const k = kind(PIECES[name]);
    const top = studio.bounds(name, ['Top']);
    assert.ok(top.max.x - top.min.x > k.w! - 0.1 && top.max.z - top.min.z > k.d! - 0.1, `${name}'s top is nearly its whole footprint`);
    assert.ok(top.min.y > 0.68, `${name}'s top is thin (${top.min.y.toFixed(3)} to ${top.max.y.toFixed(3)})`);
    assert.ok(near(studio.bounds(name, ['Steel']).min.y, 0, 0.003), `${name} stands on its steel legs`);
  }
  // The mics: bright grilles over the desk, one either side of its middle, toward the front of their arms' clamps.
  const mics = studio.vertices('podcast_desk', ['Chrome']).filter((v) => v.y > 1.05 && v.y < 1.25 && v.z > -0.05);
  for (const side of [-1, 1]) assert.ok(mics.some((v) => v.x * side > 0.3), `a mic on the desk's ${side < 0 ? 'left' : 'right'}`);
  // Out toward the desk's ends, clear of the mixer in its middle: the posts the arms stand on.
  const clamps = studio.vertices('podcast_desk', ['Steel']).filter((v) => Math.abs(v.x) > 0.5 && v.y > 0.77 && v.y < 0.9);
  assert.ok(clamps.length && clamps.every((v) => v.z < -0.35), 'the arms are clamped to the back of the desk');
});

test('the screen\'s body is behind the face the code lays on it, and nothing is in front of that', () => {
  const body = studio.bounds('screen', ['Body']);
  assert.ok(near(body.max.z, FACE.z, 0.004) && body.max.z < FACE.z, `the body's front is at ${body.max.z.toFixed(3)}, the face at ${FACE.z}`);
  // The flat of its front covers the face: its vertices there are all outside the face's rectangle.
  const front = studio.vertices('screen', ['Body']).filter((v) => near(v.z, body.max.z, 1e-4));
  assert.ok(front.length && front.every((v) => Math.abs(v.x) >= FACE.w / 2 || Math.abs(v.y - FACE.y) >= FACE.h / 2), 'the face fits on the flat of the body');
  const over = studio.vertices('screen').filter((v) => Math.abs(v.x) < FACE.w / 2 && Math.abs(v.y - FACE.y) < FACE.h / 2 && v.z > FACE.z);
  assert.equal(over.length, 0, 'nothing of the model is in front of the face');
});

test('the ticker\'s bar is behind its two faces, as long as its footprint', () => {
  const bar = studio.vertices('ticker').filter((v) => v.y < TICKER.y + 0.21);
  const xs = bar.map((v) => v.x);
  assert.ok(near(Math.min(...xs), -kind('ticker').w! / 2, 1e-3) && near(Math.max(...xs), kind('ticker').w! / 2, 1e-3), 'the bar is as long as its footprint');
  assert.ok(bar.every((v) => Math.abs(v.z) < TICKER.z), `the bar is thinner than its faces are apart (${Math.max(...bar.map((v) => Math.abs(v.z))).toFixed(3)})`);
  assert.ok(bar.every((v) => v.y > TICKER.y - 0.21), 'the bar is 0.4 high round the faces');
  assert.ok(TICKER.w < kind('ticker').w! && TICKER.h < 0.4, 'the faces fit on it');
});

test('the neon sign hangs at the front of its footprint, its words\' room clear inside the tube', () => {
  const panel = studio.bounds('neon', ['Panel']);
  assert.ok(panel.max.z < NEON.z && panel.max.z > NEON.z - 0.01, `the board's face is at ${panel.max.z.toFixed(3)}, just behind the words at ${NEON.z}`);
  // Stood where a wall stands (the thickest is 0.14), its back is clear of the wall's face.
  assert.ok(panel.min.z >= 0.055, `its back is at ${panel.min.z.toFixed(3)}`);
  assert.ok(panel.min.x < -NEON.w / 2 && panel.max.x > NEON.w / 2 && panel.min.y < NEON.y - NEON.h / 2 && panel.max.y > NEON.y + NEON.h / 2, 'the board is bigger than the words');
  const tube = studio.vertices('neon', ['Neon']);
  assert.ok(tube.every((v) => Math.abs(v.x) > NEON.w / 2 || Math.abs(v.y - NEON.y) > NEON.h / 2), 'the tube runs round the words, not through them');
  assert.ok(tube.every((v) => v.x > panel.min.x && v.x < panel.max.x && v.y > panel.min.y && v.y < panel.max.y), 'the tube is on the board');
});

test('the softbox lights the front, the camera looks that way, and the backdrop sweeps onto the floor', () => {
  const glow = studio.bounds('softbox', ['Glow']);
  const shade = studio.bounds('softbox', ['Shade']);
  assert.ok(glow.getCenter(new Vector3()).z > shade.getCenter(new Vector3()).z + 0.1, 'the softbox\'s face is at its front');
  assert.ok(glow.max.x - glow.min.x > 0.6 && glow.max.y - glow.min.y > 0.6, 'its face is a good 0.6 across');

  const lens = studio.bounds('camera', ['Lens']);
  const body = studio.bounds('camera', ['Camera']);
  assert.ok(lens.max.z > body.max.z + 0.1, `the camera's lens is ${lens.max.z.toFixed(3)} out front of its body (${body.max.z.toFixed(3)})`);
  assert.ok(body.min.y > 1.2 && body.max.y < 1.5, `its body is at eye level (${body.min.y.toFixed(3)} to ${body.max.y.toFixed(3)})`);

  const paper = studio.bounds('backdrop', ['Paper']);
  assert.ok(paper.max.y > 2.4 && paper.min.y < 0.01, `the paper runs from ${paper.max.y.toFixed(3)} to the floor`);
  assert.ok(paper.max.z > 0.2, `it sweeps ${paper.max.z.toFixed(3)} out along the floor`);
  assert.ok(paper.max.x - paper.min.x > 2.2, `it's ${(paper.max.x - paper.min.x).toFixed(3)} m wide`);
  // Its back is behind the paper: what stands above the floor is behind the sweep.
  const hanging = studio.vertices('backdrop', ['Paper']).filter((v) => v.y > 1);
  assert.ok(hanging.every((v) => v.z < 0.05), 'the paper hangs at the back of its footprint');
});

test('the lounge chair\'s back and arms wrap round where a sitter goes', () => {
  const cloth = studio.vertices('lounge_chair', ['Cloth']);
  // Everything above the arms is the back, behind the seat.
  const high = cloth.filter((v) => v.y > 0.62);
  assert.ok(high.length && high.every((v) => v.z < -0.05), 'what stands above the arms is behind the seat');
  const back = highest(cloth);
  assert.ok(back > 0.7 && back < 0.8, `its back is ${back.toFixed(3)} m high`);
  // An arm either side, lower than the back and higher than the seat.
  for (const side of [-1, 1]) {
    const arm = highest(cloth.filter((v) => v.x * side > 0.33 && v.z > 0.05));
    assert.ok(arm > 0.5 && arm < 0.62, `its ${side < 0 ? 'left' : 'right'} arm is ${arm.toFixed(3)} m high`);
  }
  // A sitter's hips go 0.46 up, a little behind the middle: the seat is open there, the back cushion just behind them.
  const s = kind('lounge-chair').seat!;
  const behind = Math.max(...cloth.filter((v) => Math.abs(v.x) < 0.2 && v.y > 0.5).map((v) => v.z));
  assert.ok(behind < s.depth - 0.08 && behind > s.depth - 0.25, `the back cushion comes forward to ${behind.toFixed(3)}`);
  assert.ok(near(studio.bounds('lounge_chair', ['Oak']).min.y, 0, 0.003), 'it stands on its oak legs');
});

test('each piece keeps to its triangle budget', () => {
  const most: Record<string, number> = {
    long_table: 1200,
    podcast_desk: 3000,
    screen: 1500,
    ticker: 800,
    softbox: 1200,
    camera: 2000,
    backdrop: 1800,
    lounge_chair: 2500,
    stool: 1200,
    credenza: 1800,
    neon: 1200,
  };
  for (const name of NAMES) assert.ok(studio.trianglesOf(name) <= most[name], `${name}: ${studio.trianglesOf(name)} triangles`);
});
