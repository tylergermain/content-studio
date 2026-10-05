// The driving tees on the balcony (shared/tees.ts): where the two bays stand, what a floor with one
// or two tees has out, each bay's own line to the pin and its own flight, and the office keeping
// track of who's on which bay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stance, teeBall } from '../src/client/features/golf/tee.js';
import { AIM_MAX, LOFT_MAX, LOFT_MIN, fly } from '../src/client/features/golf/world.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';
import { presenceHandlers } from '../src/server/ws/handlers/presence.js';
import { rooftopHandlers } from '../src/server/ws/handlers/rooftop.js';
import { cleanRoom, roomOf, type RoomOptions } from '../src/shared/floorplan.js';
import { BALCONY, BALCONY_DOOR, GOLF_HOLE, GOLF_TEE, SEATING_BY_ID, STREET_Y, WINDOWS } from '../src/shared/layout.js';
import type { PeerInfo, ServerMsg } from '../src/shared/protocol.js';
import { ROOF } from '../src/shared/rooftop.js';
import { BISTRO_SEATS, TEES, cleanBay, pinFrom, teeBays } from '../src/shared/tees.js';

const DOOR = [BALCONY_DOOR.u - BALCONY_DOOR.width / 2, BALCONY_DOOR.u + BALCONY_DOOR.width / 2] as const;

test('two bays, either side of the balcony doors, with room to stand at each', () => {
  assert.equal(TEES.length, 2);
  assert.equal(TEES[0], GOLF_TEE, 'the first bay is the tee the office comes with');
  const [west, east] = TEES;
  assert.ok(west.x + west.size / 2 < DOOR[0], 'bay 0 is west of the doors');
  assert.ok(east.x - east.size / 2 > DOOR[1], 'bay 1 is east of them');
  assert.equal(east.z, west.z, 'as far out from the wall');
  assert.equal(east.size, west.size);
  assert.ok(Math.abs(east.ball.x - east.x - (west.ball.x - west.x)) < 1e-9 && east.ball.z === west.ball.z, 'the ball sits the same way off the middle of the mat');
  for (const [i, t] of TEES.entries()) {
    const half = t.size / 2;
    assert.ok(t.x - half > BALCONY.minX + 0.2 && t.x + half < BALCONY.maxX - 0.2 && t.z - half > BALCONY.minZ && t.z + half < BALCONY.maxZ - 0.2, `bay ${i}'s mat is on the deck, inside the railing`);
    assert.ok(Math.abs(t.ball.x - t.x) < half && Math.abs(t.ball.z - t.z) < half, `bay ${i}'s ball is on its mat`);
    // The bag leans on the wall: not in the doorway, not in front of a window, and off the mat.
    assert.ok(t.bag.z < BALCONY.minZ + 0.4, `bay ${i}'s bag is at the wall`);
    assert.ok(t.bag.x + 0.2 < DOOR[0] || t.bag.x - 0.2 > DOOR[1], `bay ${i}'s bag is clear of the doors`);
    for (const w of WINDOWS.filter((o) => o.wall === 'south' && o.y0 < 2)) assert.ok(t.bag.x + 0.2 < w.u - w.width / 2 || t.bag.x - 0.2 > w.u + w.width / 2, `bay ${i}'s bag is clear of the window at ${w.u}`);
    // Wherever they aim, the golfer has the deck under them, inside the railing.
    for (const yaw of [-AIM_MAX, pinFrom(i).yaw, 0, AIM_MAX]) {
      const s = stance(yaw, i);
      assert.ok(s.x > BALCONY.minX + 0.4 && s.x < BALCONY.maxX - 0.4 && s.z > BALCONY.minZ + 0.3 && s.z < BALCONY.maxZ - 0.4, `standing at bay ${i}, aiming ${yaw.toFixed(2)}`);
    }
  }
  // Far enough apart that two people swinging don't stand in each other.
  assert.ok(east.ball.x - west.ball.x > 3);
});

test('bay 1 is where the bistro table and its stools stand, which is why they go away', () => {
  const [, east] = TEES;
  assert.deepEqual([...BISTRO_SEATS], ['stool-1', 'stool-2']);
  for (const id of BISTRO_SEATS) {
    const seat = SEATING_BY_ID.get(id)!;
    assert.ok(seat, `${id} is a seat`);
    // Where the golfer stands (the ball's east side) and the mat.
    assert.ok(Math.abs(seat.x - east.x) < east.size / 2 + 0.5 && Math.abs(seat.z - east.z) < east.size / 2 + 0.5, `${id} stands on bay 1`);
  }
});

test('a floor has one bay out, or two when its room says so', () => {
  assert.equal(teeBays(undefined), 1);
  assert.equal(teeBays(1), 1);
  assert.equal(teeBays(2), 2);
  assert.equal(teeBays(3), 1);
  assert.equal(teeBays(roomOf(undefined).tees), 1);
  assert.equal(teeBays(roomOf({ room: cleanRoom({ tees: 2 }) }).tees), 2);
  assert.equal(teeBays(roomOf({ room: cleanRoom({ tees: '2' }) }).tees), 1);
});

test('a bay number that can be trusted', () => {
  assert.equal(cleanBay(undefined), 0);
  assert.equal(cleanBay(0), 0);
  assert.equal(cleanBay(1), 1);
  assert.equal(cleanBay(2), 0);
  assert.equal(cleanBay(-1), 0);
  assert.equal(cleanBay(0.5), 0);
  assert.equal(cleanBay('1'), 0);
  assert.equal(cleanBay(true), 0);
  assert.equal(cleanBay(1, 1), 0, 'no second bay on a floor with one tee');
  assert.equal(cleanBay(1, 2), 1);
  assert.equal(cleanBay(1, 9), 1);
});

test('each bay has its own line to the one pin', () => {
  for (const [i, t] of TEES.entries()) {
    const { yaw, distance } = pinFrom(i);
    assert.ok(Math.abs(t.ball.x + Math.sin(yaw) * distance - GOLF_HOLE.x) < 1e-9 && Math.abs(t.ball.z + Math.cos(yaw) * distance - GOLF_HOLE.z) < 1e-9, `bay ${i}'s line ends at the pin`);
    assert.ok(Math.abs(yaw) < AIM_MAX / 2, `the pin is well within bay ${i}'s aim`);
  }
  assert.ok(pinFrom(0).yaw > 0, 'from the west bay the pin is a touch to the east');
  assert.ok(pinFrom(1).yaw < 0, 'from the east bay it is to the west');
  assert.deepEqual(pinFrom(7), pinFrom(0), 'no such bay: the first');
});

test('a shot flies from its own bay, and the same swing at the pin gets there from either', () => {
  const loft = (LOFT_MIN + LOFT_MAX) / 2;
  const flights = TEES.map((_, i) => fly({ yaw: pinFrom(i).yaw, loft, power: 0.74 }, STREET_Y, 0, i));
  for (const [i, f] of flights.entries()) {
    const ball = teeBall(i);
    assert.equal(f.bay, i);
    assert.deepEqual([f.path[0], f.path[1], f.path[2]], [ball.x, ball.y, ball.z].map(Math.fround), `bay ${i}'s ball starts on its tee`);
    assert.ok(Number.isFinite(f.fromPin), `bay ${i}'s ball clears the railing and comes down on the street (${f.lie})`);
    // Along its own line: never far off it on the way out.
    const { yaw } = pinFrom(i);
    const off = (f.rest.x - ball.x) * Math.cos(yaw) - (f.rest.z - ball.z) * Math.sin(yaw);
    assert.ok(Math.abs(off) < 1.5, `bay ${i}'s ball stays on its line (${off.toFixed(2)} m off)`);
  }
  // The east bay is a little further from the pin, so the same swing ends up a little shorter of it: both near it.
  assert.ok(Math.abs(flights[0].fromPin - flights[1].fromPin) < 4, `${flights[0].fromPin} and ${flights[1].fromPin}`);
  // The same shot off the two bays lands apart by about what the bays are.
  const [a, b] = TEES.map((_, i) => fly({ yaw: 0, loft, power: 0.6 }, STREET_Y, 0, i));
  assert.ok(Math.abs(b.rest.x - a.rest.x - (TEES[1].ball.x - TEES[0].ball.x)) < 0.5);
  // With no bay named, it's the office's own tee, as it always was.
  assert.deepEqual(fly({ yaw: 0.1, loft, power: 0.5 }, STREET_Y, 2).path, fly({ yaw: 0.1, loft, power: 0.5 }, STREET_Y, 2, 0).path);
});

// ---- The office: who's on which bay ---------------------------------------------------------------

/** A stand-in for the office with one floor whose room is `room`, a person on it, and what they'd be sent. */
function officeWith(room: RoomOptions | undefined, floor = 'f') {
  const sent: ServerMsg[] = [];
  const c = { id: 'me', peer: { id: 'me', name: 'Ann', floor } as PeerInfo, throttles: new Map<string, number>() } as Client;
  const ctx = {
    floorOf: (who: Client) => (who.peer.floor === ROOF ? undefined : { plan: { state: () => ({ wing: 0, labels: {}, room }) } }),
    broadcast: (msg: ServerMsg) => void sent.push(msg),
    toNeighbors: (_c: Client, msg: ServerMsg) => void sent.push(msg),
  } as unknown as Ctx;
  const act = (msg: { golf?: boolean; bay?: unknown }) => presenceHandlers.act(ctx, c, { t: 'act', ...msg } as Parameters<typeof presenceHandlers.act>[2]);
  const take = () => sent.splice(0);
  return { ctx, c, act, take };
}

test('on a floor with two tees the office says which bay someone took, and their shot comes off it', () => {
  const { ctx, c, act, take } = officeWith({ tees: 2 });
  act({ golf: true, bay: 1 });
  assert.deepEqual(take(), [{ t: 'peer.act', id: 'me', golf: true, bay: 1 }]);
  assert.equal(c.peer.golfing, true);
  assert.equal(c.peer.golfBay, 1);
  // Said again (after a reconnect, say): nothing new to tell.
  act({ golf: true, bay: 1 });
  assert.deepEqual(take(), []);
  rooftopHandlers.golf(ctx, c, { t: 'golf', yaw: -0.1, loft: 0.7, power: 0.5 });
  assert.deepEqual(take(), [{ t: 'golf', id: 'me', yaw: -0.1, loft: 0.7, power: 0.5, bay: 1 }]);
  // Over to the other bay without putting the club back: everyone hears.
  act({ golf: true, bay: 0 });
  assert.deepEqual(take(), [{ t: 'peer.act', id: 'me', golf: true }]);
  assert.equal(c.peer.golfBay, undefined);
  act({ golf: false, bay: 1 });
  assert.deepEqual(take(), [{ t: 'peer.act', id: 'me', golf: false }]);
  assert.equal(c.peer.golfing, undefined);
  assert.equal(c.peer.golfBay, undefined);
  // The first bay, as on any floor: no bay is said, in the club or the shot.
  c.throttles.clear();
  act({ golf: true });
  assert.deepEqual(take(), [{ t: 'peer.act', id: 'me', golf: true }]);
  rooftopHandlers.golf(ctx, c, { t: 'golf', yaw: 0, loft: 0.7, power: 0.5 });
  assert.deepEqual(take(), [{ t: 'golf', id: 'me', yaw: 0, loft: 0.7, power: 0.5 }]);
});

test('there is no second bay to take on a floor with one tee, or anything the office does not know', () => {
  for (const room of [undefined, { tees: 1 }, { loft: false }]) {
    const { c, act, take } = officeWith(room);
    act({ golf: true, bay: 1 });
    assert.deepEqual(take(), [{ t: 'peer.act', id: 'me', golf: true }], JSON.stringify(room));
    assert.equal(c.peer.golfBay, undefined);
  }
  const two = officeWith({ tees: 2 });
  for (const bay of [2, -1, 1.5, '1', null]) {
    two.act({ golf: true, bay });
    assert.equal(two.c.peer.golfBay, undefined, `bay ${String(bay)}`);
    two.act({ golf: false });
    two.take();
  }
  // No tees up on the roof at all.
  const roof = officeWith({ tees: 2 }, ROOF);
  roof.act({ golf: true, bay: 1 });
  assert.deepEqual(roof.take(), []);
  assert.equal(roof.c.peer.golfing, undefined);
});

test('a bay left over from a floor they were taken off does not come back with the next club', () => {
  const { c, act, take } = officeWith({ tees: 2 });
  act({ golf: true, bay: 1 });
  take();
  // Leaving a floor lets go of the club (see leave in server/office/navigation.ts), not of which bay it was.
  delete c.peer.golfing;
  act({ golf: true });
  assert.deepEqual(take(), [{ t: 'peer.act', id: 'me', golf: true }]);
  assert.equal(c.peer.golfBay, undefined);
});
