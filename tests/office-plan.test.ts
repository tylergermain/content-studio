import test from 'node:test';
import assert from 'node:assert/strict';
import { BEANBAGS, DESK_BY_ID, MEETING_SEATS, SEATING, STATIONS, seatAt } from '../src/shared/layout.js';
import { BOARD_KEYS, OFFICE_PLAN, seatOn } from '../src/shared/maps/index.js';

// The office's plan (shared/maps): what workers, the queue, meetings and the boards find a seat by.

test('the plan has every seat the office has, by the same ids', () => {
  const plan = OFFICE_PLAN;
  assert.equal(plan.id, 'office');
  assert.deepEqual(new Set(plan.byId.keys()), new Set(DESK_BY_ID.keys()));
  for (const [id, d] of plan.byId) assert.equal(d, DESK_BY_ID.get(id), `${id} is the office's own`);
  // Each kind of seat is in its own list, and nowhere else.
  const lists = [plan.desks, plan.overflow, plan.stations, plan.meeting];
  assert.equal(lists.flat().length, plan.byId.size);
  assert.deepEqual(plan.overflow, BEANBAGS);
  assert.deepEqual(plan.stations, STATIONS);
  assert.deepEqual(plan.meeting, MEETING_SEATS);
  assert.ok(plan.desks.every((d) => !d.beanbag && !d.station && !d.room));
  assert.ok(plan.desks.some((d) => d.wing), 'the back office desks are on it too, for a floor built out that far');
});

test('the plan has the four boards, and where people come in and workers go out', () => {
  const plan = OFFICE_PLAN;
  assert.deepEqual(Object.keys(plan.boards).sort(), [...BOARD_KEYS].sort());
  for (const k of BOARD_KEYS) assert.ok(plan.boards[k].label && plan.boards[k].width > 0 && plan.boards[k].height > 0, `${k} has a sign and a size`);
  const b = plan.bounds;
  const inside = (p: { x: number; z: number }) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
  assert.ok(inside(plan.door), 'the way out is inside the room');
  assert.ok(plan.spawn.x > b.minX && plan.spawn.x < b.maxX, 'you arrive in the elevator, on the room’s north side');
});

test('a seat is found on the plan by the key a peer carries', () => {
  const plan = OFFICE_PLAN;
  assert.equal(plan.seating, SEATING);
  const couch = SEATING.find((s) => s.id === 'couch')!;
  assert.deepEqual(seatOn(plan, 'couch:0'), seatAt('couch:0'));
  assert.equal(seatOn(plan, 'couch:0')!.seatId, 'couch');
  assert.equal(seatOn(plan, `couch:${couch.places.length}`), undefined, 'past its last place');
  assert.equal(seatOn(plan, 'throne:0'), undefined, 'no such seat');
  assert.equal(seatOn(plan, 'couch'), undefined, 'not a key');
});
