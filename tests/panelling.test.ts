// Wood on the outside walls (shared/panels.ts): what of each wall it covers, which has to miss every
// window and door, the elevator's shaft and the back office's bit of wall, however the holes are stacked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_SIDES } from '../src/shared/floorplan.js';
import { BALCONY_DOOR, ELEVATOR, EXIT_DOOR, FLOOR, WALL_HEIGHT, WINDOWS, WING, type Opening, type Side } from '../src/shared/layout.js';
import { PANEL_BASE, cutOut, panelRegions, type PanelRegion } from '../src/shared/panels.js';

const hole = (o: Opening): PanelRegion => ({ u0: o.u - o.width / 2, u1: o.u + o.width / 2, y0: o.y0, y1: o.y1 });
const area = (r: PanelRegion) => (r.u1 - r.u0) * (r.y1 - r.y0);
const total = (list: readonly PanelRegion[]) => list.reduce((sum, r) => sum + area(r), 0);
/** How much of `a` is also `b`. */
const shared = (a: PanelRegion, b: PanelRegion) => Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
/** How much of `of` the rectangles in `list` cover between them (they don't overlap). */
const covered = (list: readonly PanelRegion[], of: PanelRegion) => list.reduce((sum, r) => sum + shared(r, of), 0);
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} is not ${b}`);
/** What the panelling has to leave of an opening: the part of it above the baseboard. */
const above = (o: Opening): PanelRegion => ({ ...hole(o), y0: Math.max(o.y0, PANEL_BASE) });

/** Proper rectangles inside `wall` that don't overlap each other. */
function tidy(list: readonly PanelRegion[], wall: PanelRegion, what: string) {
  for (const r of list) {
    assert.ok(r.u1 > r.u0 && r.y1 > r.y0, `${what}: a rectangle has no size`);
    assert.ok(r.u0 >= wall.u0 && r.u1 <= wall.u1 && r.y0 >= wall.y0 && r.y1 <= wall.y1, `${what}: a rectangle is off the wall`);
  }
  list.forEach((a, i) => list.slice(i + 1).forEach((b) => near(shared(a, b), 0, `${what}: two rectangles overlap`)));
}

const WALLS: Record<Side, PanelRegion> = {
  north: { u0: FLOOR.minX, u1: WING.minX, y0: PANEL_BASE, y1: WALL_HEIGHT },
  south: { u0: FLOOR.minX, u1: FLOOR.maxX, y0: PANEL_BASE, y1: WALL_HEIGHT },
  west: { u0: FLOOR.minZ, u1: FLOOR.maxZ, y0: PANEL_BASE, y1: WALL_HEIGHT },
  east: { u0: FLOOR.minZ, u1: FLOOR.maxZ, y0: PANEL_BASE, y1: WALL_HEIGHT },
};

test('the south wall is wood from the baseboard to the ceiling, less its windows and the balcony doors', () => {
  const regions = panelRegions('south', false);
  const holes = [...WINDOWS.filter((o) => o.wall === 'south'), BALCONY_DOOR];
  assert.equal(holes.length, 5, "three low windows, the loft's, and the doors");
  tidy(regions, WALLS.south, 'south');
  assert.equal(Math.min(...regions.map((r) => r.u0)), -18);
  assert.equal(Math.max(...regions.map((r) => r.u1)), 18);
  assert.equal(Math.min(...regions.map((r) => r.y0)), 0.25);
  assert.equal(Math.max(...regions.map((r) => r.y1)), 6.8);
  near(total(regions), area(WALLS.south) - total(holes.map(above)), 'the wall less its holes');
  // Wood under each window's sill and over its head, and over the doors, which reach the floor.
  for (const o of holes) {
    assert.ok(regions.some((r) => r.u0 <= hole(o).u0 && r.u1 >= hole(o).u1 && r.y0 === o.y1), `over the opening at ${o.u}`);
    assert.equal(regions.some((r) => r.u0 <= hole(o).u0 && r.u1 >= hole(o).u1 && r.y1 === o.y0), o.y0 > PANEL_BASE, `under the opening at ${o.u}`);
  }
});

test('no wood covers an opening, on any wall, plugged or not', () => {
  for (const side of PANEL_SIDES) {
    for (const plugged of [false, true]) {
      const regions = panelRegions(side, plugged);
      tidy(regions, WALLS[side], side);
      for (const o of [...WINDOWS, BALCONY_DOOR, EXIT_DOOR]) {
        if (o.wall !== side || (plugged && o === EXIT_DOOR)) continue;
        for (const r of regions) near(shared(r, hole(o)), 0, `${side} wall, the opening at ${o.u}`);
      }
    }
  }
  // The east wall has only the loft's window.
  near(total(panelRegions('east', false)), area(WALLS.east) - 2.8 * 1.6, 'east');
});

test('the north wall stops at the back office and leaves out the elevator', () => {
  const regions = panelRegions('north', false);
  assert.equal(Math.max(...regions.map((r) => r.u1)), WING.minX);
  assert.equal(WING.minX, 13.4);
  // The car has no back wall of its own: the room's north wall is what you see inside it.
  const shaft = { u0: ELEVATOR.x - ELEVATOR.width / 2, u1: ELEVATOR.x + ELEVATOR.width / 2, y0: 0, y1: WALL_HEIGHT };
  assert.deepEqual([shaft.u0, shaft.u1], [7.2, 9.8]);
  for (const r of regions) near(shared(r, shaft), 0, 'the shaft');
  near(total(regions), area(WALLS.north) - 2.6 * (WALL_HEIGHT - PANEL_BASE), 'the wall less the shaft');
  assert.deepEqual(panelRegions('north', true), regions, 'the same on every floor');
});

test('the west wall leaves the exit door open on the bottom floor and covers it where it is plugged', () => {
  const open = panelRegions('west', false);
  const plugged = panelRegions('west', true);
  const door = above(EXIT_DOOR);
  for (const r of open) near(shared(r, door), 0, 'the doorway');
  near(total(plugged) - total(open), 1.4 * (2.4 - 0.25), 'the doorway, above its baseboard');
  near(covered(plugged, door), area(door), 'wood all over the plugged doorway');
  // What the plug adds is exactly the doorway: the plugged wall less the open one.
  const patch = plugged.flatMap((r) => cutOut(r, open));
  near(total(patch), area(door), 'the patch');
  for (const r of patch) near(shared(r, door), area(r), 'the patch is inside the doorway');
  // Only the exit's wall has anything to plug.
  for (const side of ['north', 'east', 'south'] as const) assert.deepEqual(panelRegions(side, true), panelRegions(side, false));
});

test('two windows one over the other in the same column are both left out, with wood between them', () => {
  const low: Opening = { wall: 'south', u: 5, width: 3, y0: 1.1, y1: 3.3 };
  const high: Opening = { wall: 'south', u: 5, width: 3, y0: 4.2, y1: 6.2 };
  for (const holes of [
    [low, high],
    [high, low],
  ]) {
    const regions = panelRegions('south', false, holes);
    tidy(regions, WALLS.south, 'stacked');
    for (const o of holes) for (const r of regions) near(shared(r, hole(o)), 0, 'a stacked window');
    near(total(regions), area(WALLS.south) - area(hole(low)) - area(hole(high)), 'the wall less both');
    const between = { u0: 3.5, u1: 6.5, y0: 3.3, y1: 4.2 };
    near(covered(regions, between), area(between), 'wood between them');
  }
  // A narrow one over a wide one, off to one side: the column isn't shared edge for edge.
  const wide: Opening = { wall: 'east', u: 0, width: 6, y0: 1, y1: 3 };
  const narrow: Opening = { wall: 'east', u: 2, width: 3, y0: 3.9, y1: 5.5 };
  const regions = panelRegions('east', false, [wide, narrow]);
  tidy(regions, WALLS.east, 'offset');
  near(total(regions), area(WALLS.east) - 12 - 4.8, 'the wall less both');
  for (const o of [wide, narrow]) for (const r of regions) near(shared(r, hole(o)), 0, 'an offset window');
});

test('cutting holes out of a rectangle leaves the rest, whatever the holes do', () => {
  const wall = { u0: 0, u1: 10, y0: 0, y1: 5 };
  assert.deepEqual(cutOut(wall, []), [wall]);
  assert.deepEqual(cutOut(wall, [{ u0: 20, u1: 30, y0: 0, y1: 5 }]), [wall], 'a hole somewhere else');
  assert.deepEqual(cutOut(wall, [{ u0: -1, u1: 11, y0: -1, y1: 6 }]), [], 'a hole over all of it');
  // Two holes that cross each other, and one hanging off the edge.
  const holes = [
    { u0: 2, u1: 8, y0: 2, y1: 3 },
    { u0: 4, u1: 6, y0: 1, y1: 4 },
    { u0: 9, u1: 12, y0: 4, y1: 7 },
  ];
  const left = cutOut(wall, holes);
  tidy(left, wall, 'crossed');
  for (const h of holes) for (const r of left) near(shared(r, h), 0, 'a crossed hole');
  near(total(left), 50 - (6 + 6 - 2) - 1, 'the rest');
});
