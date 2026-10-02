// Walking over to someone you clicked (features/walking/walkto.ts): across the office floor, and up
// or down whichever stairs the floor has (deckOf in shared/mezzanine.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { flightBetween, wayTo, type Spot } from '../src/client/features/walking/walkto.js';
import type { RoomOptions } from '../src/shared/floorplan.js';
import { BALCONY_DOOR, FLOOR, WALL_T } from '../src/shared/layout.js';
import { deckOf, type Flight } from '../src/shared/mezzanine.js';
import { setOfficeRoom, walkable } from '../src/shared/nav.js';

const spot = (x: number, y: number, z: number): Spot => ({ x, y, z });
const at = (x: number, z: number) => ({ x, z });
/** Where in `way` the point (x, z) comes, or -1. */
const step = (way: { x: number; z: number }[], x: number, z: number) => way.findIndex((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.z - z) < 1e-9);

/**
 * The way across the office floor goes by the one floor a browser is on (setOfficeRoom), not by the
 * room it's passed: a test on another room sets it, and puts it back.
 */
function on<T>(room: RoomOptions, fn: () => T): T {
  setOfficeRoom(room);
  try {
    return fn();
  } finally {
    setOfficeRoom({});
  }
}

test('to the corner loft and back goes by its stairs along the south wall', () => {
  for (const room of [undefined, {}, { tees: 2 }, { mezzanine: 'corner' }, { boss: false }] as (RoomOptions | undefined)[]) {
    const down = wayTo(spot(14, 3, 10), spot(0, 0, 0), 0, room);
    assert.deepEqual(down.slice(0, 2), [at(9.6, 12.1), at(2.4, 12.1)], 'out through the door at the top, down to the foot');
    assert.deepEqual(down[down.length - 1], at(0, 0));
    const up = wayTo(spot(0, 0, 0), spot(14, 3, 10), 0, room);
    assert.deepEqual(up.slice(-3), [at(2.4, 12.1), at(9.6, 12.1), at(14, 10)]);
    // Part-way up the stairs: on to the top of them, or back down off the bottom step.
    assert.deepEqual(wayTo(spot(6, 1.5, 12.1), spot(14, 3, 10), 0, room), [at(9.6, 12.1), at(14, 10)]);
    assert.deepEqual(wayTo(spot(14, 3, 10), spot(6, 1.5, 12.1), 0, room), [at(9.6, 12.1), at(6, 12.1)]);
    assert.deepEqual(wayTo(spot(6, 1.5, 12.1), spot(0, 0, 0), 0, room)[0], at(2.4, 12.1));
    // Across the loft, or along the stairs: straight there.
    assert.deepEqual(wayTo(spot(11, 3, 9), spot(16, 3, 12), 0, room), [at(16, 12)]);
    assert.deepEqual(wayTo(spot(4, 0.4, 12.1), spot(8, 2.4, 12.1), 0, room), [at(8, 12.1)]);
  }
});

test('on a floor with the big mezzanine the way upstairs is its own stairs', () => {
  const big: RoomOptions = { mezzanine: 'big' };
  on(big, () => {
    const up = wayTo(spot(0, 0, 0), spot(-14, 3, 11), 0, big);
    const foot = step(up, 4.8, -1.4);
    assert.ok(foot >= 0, 'to the foot of the stairs');
    assert.equal(step(up, 4.8, 5.8), foot + 1, 'then straight up them to the deck');
    assert.deepEqual(up.slice(foot + 2), [at(-14, 11)], 'and across it');
    // Every corner on the way to the foot is somewhere to stand.
    for (const p of up.slice(0, foot + 1)) assert.ok(walkable(p.x, p.z), `(${p.x}, ${p.z}) is open floor`);
    assert.equal(step(up, 2.4, 12.1), -1, "not the loft's");

    const down = wayTo(spot(-14, 3, 11), spot(0, 0, 0), 0, big);
    assert.deepEqual(down.slice(0, 2), [at(4.8, 5.8), at(4.8, -1.4)]);
    assert.deepEqual(down[down.length - 1], at(0, 0));

    // Where the corner loft would be is one more part of the deck, and under it is just the floor.
    assert.deepEqual(wayTo(spot(-14, 3, 11), spot(14, 3, 10), 0, big), [at(14, 10)]);
    const under = wayTo(spot(0, 0, 0), spot(-3, 0, 9), 0, big);
    assert.equal(step(under, 4.8, -1.4), -1);
    assert.deepEqual(under[under.length - 1], at(-3, 9));

    // On its stairs: up to the top of them, or off the bottom step.
    assert.deepEqual(wayTo(spot(4.8, 1.4, 2), spot(-14, 3, 11), 0, big), [at(4.8, 5.8), at(-14, 11)]);
    assert.deepEqual(wayTo(spot(-14, 3, 11), spot(4.8, 1.4, 2), 0, big), [at(4.8, 5.8), at(4.8, 2)]);
    assert.deepEqual(wayTo(spot(4.8, 1.4, 2), spot(0, 0, 0), 0, big)[0], at(4.8, -1.4));
    // Where the loft's stairs would stand there are none: nobody's part-way up anything there.
    assert.equal(step(wayTo(spot(6, 1.5, 12.1), spot(0, 0, 0), 0, big), 2.4, 12.1), -1);
  });
});

test('a floor that is all one level is one floor to cross', () => {
  const none: RoomOptions = { mezzanine: 'none' };
  on(none, () => {
    for (const room of [none, { loft: false }] as RoomOptions[]) {
      // Nobody is upstairs where there isn't one, whatever height they're at.
      for (const y of [0, 3]) {
        const way = wayTo(spot(0, 0, 0), spot(6, y, 12.1), 0, room);
        assert.equal(step(way, 2.4, 12.1), -1);
        assert.equal(step(way, 9.6, 12.1), -1);
        assert.equal(step(way, 4.8, -1.4), -1);
        assert.deepEqual(way[way.length - 1], at(6, 12.1), 'the floor where the stairs stood is floor');
      }
    }
  });
});

test('the balcony is through its doors, whatever the room', () => {
  for (const room of [{}, { mezzanine: 'none' }] as RoomOptions[]) {
    on(room, () => {
      const out = wayTo(spot(0, 0, 0), spot(-8, 0, 15), 0, room);
      assert.deepEqual(out.slice(-3), [at(BALCONY_DOOR.u, FLOOR.maxZ - 0.7), at(BALCONY_DOOR.u, FLOOR.maxZ + WALL_T + 0.6), at(-8, 15)]);
      assert.deepEqual(wayTo(spot(-8, 0, 15), spot(-6, 0, 15), 0, room), [at(-6, 15)]);
    });
  }
  // From the loft to the balcony: down the stairs first.
  const way = wayTo(spot(14, 3, 10), spot(-8, 0, 15));
  assert.deepEqual(way.slice(0, 2), [at(9.6, 12.1), at(2.4, 12.1)]);
  assert.deepEqual(way[way.length - 1], at(-8, 15));
  // Somewhere the office has no map of: straight there.
  assert.deepEqual(wayTo(spot(0, 0, 0), spot(-30, -8, 0)), [at(-30, 0)]);
});

test('with more than one flight, the walk takes the nearest', () => {
  const [east] = deckOf({ mezzanine: 'big' })!.flights;
  // A second one like it, by the west wall.
  const west: Flight = {
    rect: { ...east.rect, minX: -15.5, maxX: -13.3 },
    foot: { ...east.foot, minX: -15.4, maxX: -13.4 },
    top: { ...east.top, minX: -15.4, maxX: -13.4 },
    footAt: { x: -14.4, z: east.footAt.z },
    topAt: { x: -14.4, z: east.topAt.z },
  };
  for (const flights of [
    [east, west],
    [west, east],
  ]) {
    assert.equal(flightBetween(flights, at(-14, 11), at(-16, 0)), west);
    assert.equal(flightBetween(flights, at(12, 9), at(8, -6)), east);
    // Upstairs at one end, heading for the far side downstairs: whichever makes the shorter walk of both ends.
    assert.equal(flightBetween(flights, at(-14, 11), at(17, -10)), east);
    assert.equal(flightBetween(flights, at(-14, 11), at(-2, -1.4)), west);
  }
  assert.equal(flightBetween([east], at(-14, 11), at(-16, 0)), east);
});
