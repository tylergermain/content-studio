import test from 'node:test';
import assert from 'node:assert/strict';
import { ROAD, STREET_Y, streetBelow } from '../src/shared/layout.js';
import {
  CLAIMABLE,
  CRANE,
  GROUNDS,
  HOARDING,
  PARK,
  PLATE,
  PLOTS,
  PLOT_IDS,
  PUTT,
  PUTT_CELLS,
  SHELL,
  boxFromStreet,
  boxToStreet,
  businessBoxes,
  claimedBox,
  craneAt,
  frameOf,
  fridayFrame,
  fromStreet,
  headingFromStreet,
  headingToStreet,
  inPlots,
  isClaimable,
  onMain,
  plateBox,
  plotAt,
  puttCell,
  shellTop,
  toStreet,
} from '../src/shared/mainstreet.js';
import type { BusinessCard } from '../src/shared/protocol.js';

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);
const inside = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

test("the plots are the roof city's blocks either side of Main Street, each plate 27 m from its middle", () => {
  const middle = (ROAD.minZ + ROAD.maxZ) / 2;
  for (const id of PLOT_IDS) {
    const p = PLOTS[id];
    const [i, j] = p.block;
    assert.deepEqual(p.box, { minX: 56 * i - 22, maxX: 56 * i + 22, minZ: 56 * j - 23, maxZ: 56 * j + 21 }, id);
    assert.ok(onMain(i, j), `${id}'s block is Main Street's`);
    // Clear of the road and its sidewalks.
    assert.ok(p.box.maxZ <= ROAD.minZ - 2 || p.box.minZ >= ROAD.maxZ + 2, `${id} keeps off the sidewalks`);
    if (!p.plate) continue;
    near(Math.abs(p.plate.z - middle), 27, `${id}'s plate from Main Street`);
    const plate = plateBox(id);
    assert.ok(plate.minX >= p.box.minX && plate.maxX <= p.box.maxX && plate.minZ >= p.box.minZ && plate.maxZ <= p.box.maxZ, `${id}'s plate is on its plot`);
  }
  assert.deepEqual(plateBox('P1'), { minX: -PLATE.halfX, maxX: PLATE.halfX, minZ: -PLATE.halfZ, maxZ: PLATE.halfZ });
  assert.deepEqual(plateBox('P7'), { minX: 37.7, maxX: 74.3, minZ: 40.7, maxZ: 67.3 });
  assert.ok(!onMain(2, 0) && !onMain(-2, 1) && !onMain(0, -1) && !onMain(0, 2), 'the rest of the roof city is its own');
});

test('three plots are for lease, each with its board by the sidewalk, facing the street', () => {
  assert.deepEqual(CLAIMABLE, ['P2', 'P3', 'P7']);
  for (const id of PLOT_IDS) assert.equal(isClaimable(id), CLAIMABLE.includes(id as never), id);
  assert.ok(!isClaimable('P4') && !isClaimable(7) && !isClaimable(undefined));
  for (const id of CLAIMABLE) {
    const { board, box, plate } = PLOTS[id];
    assert.ok(board && plate, id);
    assert.ok(inside(box, board.x, board.z), `${id}'s board is on it`);
    // North of the street it faces south (+z), and south of it, north.
    near(board.rotY, plate.turn ? Math.PI : 0, `${id}'s board`);
    assert.ok(Math.min(Math.abs(board.z - ROAD.minZ), Math.abs(board.z - ROAD.maxZ)) < 4, `${id}'s board is by the street`);
  }
});

test('plotAt and inPlots find the plots, and nothing past them', () => {
  assert.equal(plotAt(0, 0), 'P1');
  assert.equal(plotAt(-56, 0), 'P2');
  assert.equal(plotAt(56, 0), 'P3');
  assert.equal(plotAt(-5, 58), 'P5');
  assert.equal(plotAt(-56, 43), 'P6');
  assert.equal(plotAt(56, 54), 'P7');
  assert.equal(plotAt(0, 27), null, 'Main Street itself');
  assert.equal(plotAt(28, 0), null, 'between the blocks');
  assert.equal(plotAt(110, 50), null, 'the farm');
  assert.ok(!inPlots(28, 0) && inPlots(28, 0, 6));
  assert.ok(!inPlots(-96, 20.2), "the Scenic Loop signpost's spot is no plot's");
});

test('a frame turns and shifts points, headings and boxes, and back', () => {
  const pts = [
    { x: 0, y: 0, z: 0 },
    { x: 3.5, y: -3.6, z: 12 },
    { x: -18, y: 2.5, z: -13 },
  ];
  for (const id of ['P1', 'P2', 'P3', 'P7'] as const) {
    for (const street of [STREET_Y, streetBelow(4)]) {
      const f = frameOf(id, street);
      for (const p of pts) {
        const s = toStreet(f, p);
        const back = fromStreet(f, s);
        near(back.x, p.x, `${id} x`);
        near(back.y, p.y, `${id} y`);
        near(back.z, p.z, `${id} z`);
        near(s.h, p.y - street, `${id} h`);
      }
      for (const rotY of [0, 1, -2.5]) near(headingFromStreet(f, headingToStreet(f, rotY)), rotY, `${id} heading`);
      const b = { minX: -2, maxX: 5, minZ: 1, maxZ: 9 };
      assert.deepEqual(boxFromStreet(f, boxToStreet(f, b)), b, `${id} box`);
      const s = boxToStreet(f, b);
      assert.ok(s.minX < s.maxX && s.minZ < s.maxZ, `${id}: a box stays a box`);
    }
  }
  // Friday's own frame is the street's, but for how high.
  assert.deepEqual(toStreet(fridayFrame(), { x: 4, y: 0, z: 6 }), { x: 4, h: -STREET_Y, z: 6 });
  // P7 is turned to face the street: its street side (+z in its own frame) is the street frame's north.
  const p7 = frameOf('P7');
  assert.deepEqual(toStreet(p7, { x: 0, y: STREET_Y, z: 27 }), { x: 56, h: 0, z: 27 });
  assert.deepEqual(toStreet(p7, { x: 10, y: STREET_Y, z: 0 }), { x: 46, h: 0, z: 54 });
  near(headingToStreet(p7, 0), Math.PI, 'facing its street');
  // Into a point of your own, a frame's work makes nothing new.
  const out = { x: 0, h: 0, z: 0 };
  assert.equal(toStreet(p7, { x: 1, y: 0, z: 1 }, out), out);
  assert.throws(() => frameOf('P5'), /no building/);
});

test("what stands on a claimed plot: a site's hoarding and crane, or a shell its storeys tall", () => {
  const card = (plot: 'P2' | 'P3' | 'P7', stage: 'site' | 'shell', storeys = 4): BusinessCard => ({ id: 'acme', name: 'Acme', plot, accent: '#ff8800', skin: 'brick', stage, home: 'hosted', storeys: Array.from({ length: storeys }, () => ({ name: 'Acme', accent: '#ff8800' })) });
  near(shellTop(8), SHELL.garage + 8 * SHELL.storey + SHELL.parapet, 'eight storeys');
  near(shellTop(8), 61.6, 'the tallest shell');
  near(shellTop(20), shellTop(8), 'no more than eight');
  near(shellTop(0), shellTop(1), 'no fewer than one');
  const [shell] = businessBoxes([card('P3', 'shell', 3)]);
  assert.deepEqual({ ...shell }, { ...plateBox('P3'), bottom: 0, top: shellTop(3) });
  for (const plot of CLAIMABLE) {
    const solids = businessBoxes([card(plot, 'site')]);
    assert.equal(solids.length, 3, plot);
    const [hoarding, mast, jib] = solids;
    assert.deepEqual({ ...hoarding }, { ...claimedBox(plot), bottom: 0, top: HOARDING.height });
    const at = craneAt(plot);
    assert.ok(inside(PLOTS[plot].box, at.x, at.z), `${plot}'s crane is on its plot`);
    assert.ok(inside(mast, at.x, at.z) && mast.top > CRANE.mast, `${plot}'s mast`);
    assert.ok(jib.round && jib.round.r >= CRANE.jib && jib.bottom < CRANE.jibY && jib.top > CRANE.jibY, `${plot}'s jib sweeps a circle`);
    // Its jib keeps clear of Friday Tower, whichever way it's slewed.
    assert.ok(Math.abs(at.x) - jib.round.r > PLATE.halfX + 2, `${plot}'s jib clears the tower`);
    // At the back of the plot, away from the street.
    assert.ok(Math.abs(at.z - 27) > Math.abs(PLOTS[plot].plate!.z - 27), `${plot}'s crane is behind its plate`);
  }
  assert.deepEqual(businessBoxes([{ ...card('P2', 'site'), plot: 'P5' as never }]), [], 'only a claimable plot has anything standing on it');
});

test('Friday Park has room for the heliport, and Putt Street its nine cells inside the fence', () => {
  const pad = PARK.pad;
  assert.equal(plotAt(pad.x, pad.z), 'P5');
  const park = PLOTS.P5.box;
  assert.ok(pad.x - pad.clear >= park.minX && pad.x + pad.clear <= park.maxX && pad.z - pad.clear >= park.minZ && pad.z + pad.clear <= park.maxZ, "the pad's keep-clear is in the park");
  // Clear of golf's hole 1: its trees, and the bunker past the green.
  for (const [x, z] of [[3.5, 66], [6, 55], [0.6, 61.2]]) assert.ok(Math.hypot(pad.x - x, pad.z - z) > pad.clear + 2, `clear of (${x}, ${z})`);
  assert.ok(pad.deck < 0.3, 'people step up onto it');
  assert.equal(plotAt(PARK.board.x, PARK.board.z), 'P5');
  assert.equal(plotAt(PARK.windsock.x, PARK.windsock.z), 'P5');
  const fence = PUTT.fence;
  const course = PLOTS.P6.box;
  assert.ok(fence.minX >= course.minX && fence.maxX <= course.maxX && fence.minZ >= course.minZ && fence.maxZ <= course.maxZ, 'the fence is round the plot');
  assert.deepEqual(PUTT_CELLS.map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const c of PUTT_CELLS) {
    const cell = puttCell(c.n);
    assert.ok(cell.minX >= fence.minX + 3 && cell.maxX <= fence.maxX - 3 && cell.minZ >= fence.minZ + 3 && cell.maxZ <= fence.maxZ - 2, `hole ${c.n}'s cell is inside the fence, with a path round it`);
    for (const o of PUTT_CELLS) if (o.n !== c.n) assert.ok(Math.abs(o.x - c.x) >= PUTT.cell + 3 || Math.abs(o.z - c.z) >= PUTT.cell + 3, `holes ${c.n} and ${o.n} have a path between`);
  }
  // The windmill's hole is front and centre, 10 m back from the sidewalk.
  near(PUTT_CELLS[1].z - (ROAD.maxZ + 2), 10, "the windmill's distance from the sidewalk");
  near(PUTT_CELLS[1].x, (course.minX + course.maxX) / 2, "the windmill's middle");
  const kiosk = PUTT.kiosk;
  assert.ok(kiosk.minZ > fence.minZ && kiosk.maxZ < puttCell(1).minZ, 'the kiosk is between the fence and the first hole');
  assert.ok(PUTT.gate.minX > fence.minX && PUTT.gate.maxX < fence.maxX && PUTT.gate.maxX < kiosk.minX, 'the gate is in the fence, beside the kiosk');
  assert.ok(GROUNDS > Math.hypot(course.minX, course.maxZ) * 4, 'the grounds go far beyond the street');
});
