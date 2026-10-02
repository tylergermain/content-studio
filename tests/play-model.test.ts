import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Quaternion, Vector3 } from 'three';
import { FURNITURE, type FurnitureKind } from '../src/shared/furniture.js';
import { DANCE, danceTile } from '../src/client/features/playthings/logic.js';
import { openModel } from './glb';

// play.glb (exported by blender/scripts/build_play.py) against what world/office/furniture-play.ts and
// features/playthings count on: its nine pieces by name, each a root standing on the floor at the origin
// and facing +z inside the footprint shared/furniture.ts gives its kind; the parts that move, each hung
// under its piece with its origin at its pivot; and the materials the code paints.

const FILE = new URL('../src/client/models/play.glb', import.meta.url);
const play = openModel('play');
const { gltf, nodes, byName } = play;

/** Each piece's root in the model, and the kind of furniture it is. */
const PIECES: Record<string, FurnitureKind> = {
  trampoline: 'trampoline',
  punching_bag: 'punching-bag',
  vending_machine: 'vending-machine',
  ping_pong: 'ping-pong',
  foosball: 'foosball',
  cushion: 'cushion',
  dance_mat: 'dance-mat',
  prize_wheel: 'prize-wheel',
  high_striker: 'high-striker',
};
/** PLAY_PARTS in world/office/furniture-play.ts: the parts the playthings move, and the piece each hangs under. */
const PARTS: Record<string, string> = {
  trampoline_mat: 'trampoline',
  punching_bag_bag: 'punching_bag',
  vending_machine_can: 'vending_machine',
  ping_pong_paddle: 'ping_pong',
  ping_pong_ball: 'ping_pong',
  foosball_ball: 'foosball',
  prize_wheel_wheel: 'prize_wheel',
  prize_wheel_flapper: 'prize_wheel',
  high_striker_puck: 'high_striker',
  high_striker_bell: 'high_striker',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`foosball_rod_${i}`, 'foosball'])),
};
/** PLAY_COLORS there, with Paint (each piece's own color), Glow (what's lit) and a dance mat's nine tiles. */
const MATERIALS = ['Paint', 'Glow', 'Frame', 'Chrome', 'Dark', 'White', 'Wood', 'Red', 'Blue', 'Yellow', 'Green', 'Felt', 'Net', 'Ball', 'Brass', ...Array.from({ length: 9 }, (_, i) => `Tile${i}`)];

type Primitive = { attributes: Record<string, number>; material?: number; indices?: number };
type Accessor = { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string };
const primitives = (name: string) => (gltf.meshes[nodes[byName(name)].mesh ?? -1]?.primitives ?? []) as Primitive[];
const materialOf = (p: Primitive) => gltf.materials?.[p.material ?? -1]?.name ?? '';
const accessor = (i: number) => gltf.accessors[i] as Accessor;

/** The .glb's binary chunk, where the vertices are: straight after the JSON chunk (whose length is padded to 4). */
const bin = (() => {
  const b = readFileSync(FILE);
  const json = 20 + b.readUInt32LE(12);
  assert.equal(b.toString('ascii', json + 4, json + 8), 'BIN\0', 'the second chunk is the binary one');
  return b.subarray(json + 8, json + 8 + b.readUInt32LE(json));
})();
const views = (gltf as unknown as { bufferViews: { byteOffset?: number; byteStride?: number }[] }).bufferViews;

/** A node's own vertices where they stand in the model, only those of `materials` if given. */
function verticesOf(name: string, materials?: string[]): Vector3[] {
  const m = play.worldMatrix(byName(name));
  const out: Vector3[] = [];
  for (const p of primitives(name)) {
    if (materials && !materials.includes(materialOf(p))) continue;
    const a = accessor(p.attributes.POSITION);
    assert.ok(a.componentType === 5126 && a.type === 'VEC3', 'positions are three floats');
    const view = views[a.bufferView ?? -1];
    const stride = view.byteStride ?? 12;
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let k = 0; k < a.count; k++) {
      const o = start + k * stride;
      out.push(new Vector3(bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)).applyMatrix4(m));
    }
  }
  return out;
}

/** A piece and the parts hung under it. */
const family = (piece: string) => [piece, ...Object.keys(PARTS).filter((part) => PARTS[part] === piece)];
const boundsOf = (names: string[], materials?: string[]) => new Box3().setFromPoints(names.flatMap((n) => verticesOf(n, materials)));
const originOf = (name: string) => play.placed(byName(name)).at;
const trianglesOf = (name: string) => primitives(name).reduce((n, p) => n + accessor(p.indices!).count / 3, 0);
const near = (a: number, b: number, tolerance = 0.006) => Math.abs(a - b) <= tolerance;
const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

test('it is nine pieces, each a root at the origin facing +z, with the parts that move hung under them', () => {
  const names = nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), [...Object.keys(PIECES), ...Object.keys(PARTS)].sort(), 'only the pieces and their parts, each named once');
  for (const name of Object.keys(PIECES)) {
    const i = byName(name);
    assert.equal(play.parentName(i), undefined, `${name} hangs from nothing`);
    const { at, turn } = play.placed(i);
    assert.ok(at.length() < 1e-4, `${name} is at ${fmt(at)}`);
    assert.ok(turn.angleTo(new Quaternion()) < 1e-4, `${name} isn't turned`);
  }
  for (const [part, piece] of Object.entries(PARTS)) {
    assert.equal(play.parentName(byName(part)), piece, `${part} hangs under ${piece}`);
    assert.ok(play.placed(byName(part)).turn.angleTo(new Quaternion()) < 1e-4, `${part} isn't turned`);
  }
});

test('its materials are the ones furniture-play.ts paints, and every piece has a part in its own color but the mat with its tiles', () => {
  const names = play.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const piece of Object.keys(PIECES)) {
    const used = new Set(family(piece).flatMap((n) => primitives(n).map(materialOf)));
    assert.ok(used.has('Paint'), `${piece} has something painted its own color`);
  }
  const tiles = primitives('dance_mat').map(materialOf).filter((m) => m.startsWith('Tile'));
  assert.deepEqual(tiles.sort(), Array.from({ length: 9 }, (_, i) => `Tile${i}`), 'the dance mat has each tile once, and nothing else has any');
  assert.equal(names.filter((m) => m.startsWith('Tile')).length, 9);
});

test('every piece stands on the floor inside the footprint the catalog gives its kind, and no higher than its top', () => {
  for (const [piece, kind] of Object.entries(PIECES)) {
    const k: { r?: number; w?: number; d?: number; top: number } = FURNITURE[kind];
    const box = boundsOf(family(piece));
    assert.ok(near(box.min.y, 0, 2e-3), `${piece} stands on the floor (${box.min.y.toFixed(3)})`);
    // What sticks up a little over a top you can stand on: the pad round the mat, the net, the rods' men, the cushion's button.
    assert.ok(box.max.y <= k.top + 0.17, `${piece} is ${box.max.y.toFixed(3)} tall, and its kind's top is ${k.top}`);
    if (k.r !== undefined) {
      const reach = Math.max(...family(piece).flatMap((n) => verticesOf(n)).map((v) => Math.hypot(v.x, v.z)));
      assert.ok(reach <= k.r + 1e-3, `${piece} reaches ${reach.toFixed(3)} from its middle, and its kind's r is ${k.r}`);
    } else {
      assert.ok(box.min.x >= -k.w! / 2 - 1e-3 && box.max.x <= k.w! / 2 + 1e-3, `${piece} runs ${box.min.x.toFixed(3)} to ${box.max.x.toFixed(3)} across, in ${k.w}`);
      assert.ok(box.min.z >= -k.d! / 2 - 1e-3 && box.max.z <= k.d! / 2 + 1e-3, `${piece} runs ${box.min.z.toFixed(3)} to ${box.max.z.toFixed(3)} front to back, in ${k.d}`);
    }
  }
});

test('what you stand, sit or play on is at its kind\'s top, where the collider is', () => {
  const mat = boundsOf(['trampoline_mat']);
  assert.ok(near(mat.max.y, FURNITURE.trampoline.top) && near(mat.min.y, FURNITURE.trampoline.top), `the mat is flat at ${mat.max.y.toFixed(3)}`);
  assert.ok(near(originOf('trampoline_mat').y, FURNITURE.trampoline.top) && Math.hypot(originOf('trampoline_mat').x, originOf('trampoline_mat').z) < 1e-4, 'its origin is its middle');
  // toys.ts's MAT_RADIUS: you bounce out to the mat's edge.
  assert.ok(near(Math.max(mat.max.x, mat.max.z), 0.96, 0.01), `the mat is ${mat.max.x.toFixed(3)} round`);
  assert.ok(near(boundsOf(['ping_pong'], ['Paint']).max.y, FURNITURE['ping-pong'].top), 'the ping-pong table\'s top');
  assert.ok(near(boundsOf(['foosball'], ['Dark']).max.y, FURNITURE.foosball.top), 'the foosball table\'s rim');
  assert.ok(near(boundsOf(['cushion']).max.y, FURNITURE.cushion.top, 0.012), 'the cushion\'s top');
  for (let i = 0; i < 9; i++) assert.ok(near(boundsOf(['dance_mat'], [`Tile${i}`]).max.y, FURNITURE['dance-mat'].top, 1e-3), `tile ${i}'s top`);
});

test('the punching bag hangs from its origin, between the uprights, clear of the floor', () => {
  const hook = originOf('punching_bag_bag');
  assert.ok(Math.hypot(hook.x, hook.z) < 1e-4 && hook.y > 1.9 && hook.y < 2.05, `its hook is at ${fmt(hook)}`);
  const bag = boundsOf(['punching_bag_bag']);
  assert.ok(bag.max.y <= hook.y + 0.03, 'nothing of it is over its hook');
  const body = boundsOf(['punching_bag_bag'], ['Paint']);
  assert.ok(body.min.y > 0.6 && body.max.x < 0.2 && body.min.x > -0.2, `the bag is ${fmt(body.min)} to ${fmt(body.max)}`);
  // logic.ts's BAG.length: from the hook to the bag's middle, which sets how slowly it swings.
  assert.ok(near(hook.y - body.getCenter(new Vector3()).y, 0.75, 0.03), `the bag's middle is ${(hook.y - body.getCenter(new Vector3()).y).toFixed(3)} under its hook`);
  // The frame's uprights are either side of it, so it swings front to back between them.
  const frame = verticesOf('punching_bag', ['Frame']).filter((v) => v.y > 0.3 && v.y < 1.5);
  assert.ok(frame.every((v) => Math.abs(v.x) > 0.3 && Math.abs(v.z) < 0.05), 'the uprights stand to its sides');
});

test('the vending machine faces forward, and its can lies in the tray at the front', () => {
  const glow = boundsOf(['vending_machine'], ['Glow']);
  assert.ok(glow.max.z > 0.3, 'its sign and display are on the front');
  const can = originOf('vending_machine_can');
  assert.ok(can.z > 0.3 && can.y > 0.15 && can.y < 0.45, `the can is at ${fmt(can)}`);
  assert.ok(boundsOf(['vending_machine_can']).getCenter(new Vector3()).distanceTo(can) < 0.01, 'its origin is its middle');
});

test('the ping-pong table is full size, end on, with your paddle and the ball on the near half', () => {
  const top = boundsOf(['ping_pong'], ['Paint']);
  assert.ok(near(top.max.x - top.min.x, 1.525) && near(top.max.z - top.min.z, 2.74), `the top is ${fmt(top.getSize(new Vector3()))}`);
  const net = boundsOf(['ping_pong'], ['Net']);
  assert.ok(Math.abs(net.getCenter(new Vector3()).z) < 0.01 && net.max.z - net.min.z < 0.02, 'the net is across the middle');
  const tape = boundsOf(['ping_pong'], ['White']).max.y;
  assert.ok(near(tape - FURNITURE['ping-pong'].top, 0.1525, 0.01), `the net is ${(tape - 0.76).toFixed(3)} high`);
  const grip = originOf('ping_pong_paddle');
  const paddle = boundsOf(['ping_pong_paddle']);
  assert.ok(grip.z > 0.5 && paddle.max.z - grip.z < 0.07 && grip.z - paddle.min.z > 0.2, 'the paddle\'s origin is its grip, its blade toward the net');
  const ball = boundsOf(['ping_pong_ball']);
  assert.ok(ball.getCenter(new Vector3()).distanceTo(originOf('ping_pong_ball')) < 0.005 && originOf('ping_pong_ball').z > 0.5, 'the ball\'s origin is its middle');
  assert.ok(near(ball.min.y, FURNITURE['ping-pong'].top, 0.004), 'it lies on the table');
});

test('the foosball table has eight rods across it, each on its own axis, red handles to the front and blue to the back', () => {
  let last = -Infinity;
  for (let i = 0; i < 8; i++) {
    const name = `foosball_rod_${i}`;
    const axis = originOf(name);
    assert.ok(axis.x > last + 0.1 && Math.abs(axis.z) < 1e-4 && near(axis.y, 0.86), `rod ${i}'s axis is at ${fmt(axis)}`);
    last = axis.x;
    const rod = boundsOf([name], ['Chrome']);
    assert.ok(near(rod.getCenter(new Vector3()).x, axis.x, 0.002) && near(rod.getCenter(new Vector3()).y, axis.y, 0.004), `rod ${i} runs along its axis`);
    const team = primitives(name).map(materialOf).filter((m) => m !== 'Chrome');
    assert.equal(team.length, 1, `rod ${i} is one team's`);
    const men = boundsOf([name], team);
    if (team[0] === 'Red') assert.ok(men.max.z > 0.38, `red rod ${i}'s handle is at the front`);
    else assert.ok(men.min.z < -0.38, `blue rod ${i}'s handle is at the back`);
    // Its men hang clear of the field, so the rod can spin.
    assert.ok(men.min.y > 0.805, `rod ${i}'s men clear the field (${men.min.y.toFixed(3)})`);
  }
  assert.ok(near(boundsOf(['foosball'], ['Felt']).max.y, 0.805, 0.002), 'the field');
  assert.ok(near(boundsOf(['foosball_ball']).min.y, 0.805, 0.003), 'the ball lies on it');
});

test('the dance mat\'s tiles are where logic.ts looks for them', () => {
  for (let i = 0; i < 9; i++) {
    const tile = boundsOf(['dance_mat'], [`Tile${i}`]);
    const middle = tile.getCenter(new Vector3());
    assert.equal(danceTile(middle.x, middle.z), i, `tile ${i} is at ${fmt(middle)}`);
    assert.ok(near(middle.x, ((i % 3) - 1) * DANCE.pitch) && near(middle.z, (Math.floor(i / 3) - 1) * DANCE.pitch), `tile ${i} is on the grid`);
    // Just inside it, on every side, is still that tile.
    for (const [x, z] of [[tile.min.x + 0.01, middle.z], [tile.max.x - 0.01, middle.z], [middle.x, tile.min.z + 0.01], [middle.x, tile.max.z - 0.01]]) assert.equal(danceTile(x, z), i);
  }
  const mat = boundsOf(['dance_mat']);
  assert.ok(mat.max.x <= DANCE.half + 0.04 && mat.max.x >= DANCE.half, `the mat's edge (${mat.max.x.toFixed(3)}) is about where the tiles end`);
});

test('the prize wheel turns about its hub, its first wedge counter-clockwise from the top, under a flapper that reaches its pegs', () => {
  const hub = originOf('prize_wheel_wheel');
  const wheel = boundsOf(['prize_wheel_wheel']);
  const middle = wheel.getCenter(new Vector3());
  assert.ok(near(middle.x, hub.x, 0.002) && near(middle.y, hub.y, 0.002), `the wheel is round its hub (${fmt(hub)})`);
  // Wedge 0 is red, from the top round to the left as you face it (+x is to your right): wedgeAt() in logic.ts counts them that way.
  const red = verticesOf('prize_wheel_wheel', ['Red']).filter((v) => v.y > hub.y + 0.1);
  assert.ok(red.length && red.every((v) => v.x <= 0.001) && red.some((v) => v.x < -0.1), 'the top red wedge is left of the top');
  const blue = verticesOf('prize_wheel_wheel', ['Blue']).filter((v) => v.y > hub.y + 0.1);
  assert.ok(blue.length && blue.every((v) => v.x >= -0.001), 'the last wedge, blue, is right of the top');
  // Eight pegs, the first straight up from the hub.
  const pegs = boundsOf(['prize_wheel_wheel'], ['Chrome']);
  const pin = originOf('prize_wheel_flapper');
  const flapper = boundsOf(['prize_wheel_flapper']);
  assert.ok(Math.abs(pin.x) < 1e-4 && pin.y > wheel.max.y, `the flapper's pin (${fmt(pin)}) is over the wheel`);
  assert.ok(flapper.min.y < pegs.max.y && flapper.min.y > hub.y + 0.3, `its tip (${flapper.min.y.toFixed(3)}) comes down to the pegs (${pegs.max.y.toFixed(3)})`);
  assert.ok(flapper.min.z > boundsOf(['prize_wheel_wheel'], ['Red', 'Yellow', 'Green', 'Blue']).max.z, 'and hangs in front of the wedges');
});

test('the high striker\'s puck rides its rail up to the bell', () => {
  const puck = originOf('high_striker_puck');
  const box = boundsOf(['high_striker_puck']);
  assert.ok(box.getCenter(new Vector3()).distanceTo(puck) < 0.005, 'the puck\'s origin is its middle');
  const bell = boundsOf(['high_striker_bell'], ['Brass']);
  assert.ok(near(bell.getCenter(new Vector3()).x, puck.x, 0.002) && near(bell.getCenter(new Vector3()).z, puck.z, 0.002), 'the bell is over the rail');
  // toys.ts's RAIL: how far the puck slides before its top meets the bell's rim.
  const travel = bell.min.y - box.max.y;
  assert.ok(near(travel, 1.92, 0.02), `the puck has ${travel.toFixed(3)} m to go`);
  const hang = originOf('high_striker_bell');
  assert.ok(hang.y >= bell.max.y - 0.01, 'the bell hangs from its origin');
});

test('each piece keeps to its triangle budget', () => {
  const most: Record<string, number> = { trampoline: 2000, punching_bag: 2000, vending_machine: 3200, ping_pong: 1800, foosball: 4200, cushion: 1300, dance_mat: 2200, prize_wheel: 2000, high_striker: 3000 };
  for (const piece of Object.keys(PIECES)) {
    const n = family(piece).reduce((sum, name) => sum + trianglesOf(name), 0);
    assert.ok(n <= most[piece], `${piece}: ${n} triangles`);
  }
});
