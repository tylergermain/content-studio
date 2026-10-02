import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/client/state/index.js';
import { whereabouts } from '../src/client/ui/whereabouts.js';
import { EMPTY_PLAN } from '../src/shared/floorplan.js';
import { DANCE_FLOOR, ROOF_TABLES } from '../src/shared/layout.js';
import type { PeerInfo } from '../src/shared/protocol.js';
import { ROOF } from '../src/shared/rooftop.js';

function peer(x: number, z: number, floor?: string, y = 0): PeerInfo {
  return { id: 'p', name: 'P', color: '#fff', look: { skin: 0, hair: 0, style: 0 }, x, y, z, rotY: 0, moving: false, voice: false, muted: false, sharing: false, floor };
}

test("the roof's corner over the meeting room is a tall table, not the meeting room", () => {
  const t = ROOF_TABLES.find((t) => t.x > 9 && t.z > 8)!;
  assert.equal(whereabouts(peer(t.x + 0.7, t.z, 'agent-office')), '🤝 in the meeting room');
  assert.equal(whereabouts(peer(t.x + 0.7, t.z, ROOF)), '🕯️ at a tall table');
});

test('up on the roof, the dance floor and the bar have their own words, and the rest none', () => {
  assert.equal(whereabouts(peer((DANCE_FLOOR.minX + DANCE_FLOOR.maxX) / 2, (DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2, ROOF)), '🪩 on the dance floor');
  assert.equal(whereabouts(peer(11.5, 0, ROOF)), '🍸 at the bar');
  assert.equal(whereabouts(peer(0, 3, ROOF)), undefined);
  assert.equal(whereabouts({ ...peer(12, 0, ROOF), seat: 'roof-stool-3:0' }), '🪑 on the bar stool');
});

test('someone on the 2D view is on the 2D view, unless they have something open', () => {
  assert.equal(whereabouts({ ...peer(0, 0, 'agent-office'), lite: true }), '📱 on the 2D view');
  assert.equal(whereabouts({ ...peer(0, 0, 'agent-office'), lite: true, doing: "💻 in Pixel's terminal" }), "💻 in Pixel's terminal");
});

test("up in the corner loft is the boss's office only where the floor has one", () => {
  const up = peer(14, 10, 'agent-office', 3);
  // On a floor like the office comes, and one that only changed its tees.
  for (const room of [{}, { tees: 2 }, { mezzanine: 'corner' as const }]) assert.equal(whereabouts(up, undefined, room), "👔 in the boss's office");
  // The loft kept empty is just upstairs.
  assert.equal(whereabouts(up, undefined, { boss: false }), '⬆️ upstairs');
  // Under it, on any of them, is the meeting room.
  for (const room of [{}, { boss: false }, { mezzanine: 'big' as const }, { mezzanine: 'none' as const }]) assert.equal(whereabouts(peer(14, 10, 'agent-office'), undefined, room), '🤝 in the meeting room');
  // Beside the loft at its height (on the ladder, say) is nowhere.
  assert.equal(whereabouts(peer(0, 0, 'agent-office', 3), undefined, {}), undefined);
});

test('up on the big mezzanine is upstairs, wherever on it', () => {
  const big = { mezzanine: 'big' } as const;
  // Over the meeting room, where another floor has the boss's office: not that, and not the meeting room.
  assert.equal(whereabouts(peer(14, 10, 'agent-office', 3), undefined, big), '⬆️ upstairs');
  assert.equal(whereabouts(peer(-14, 11, 'agent-office', 3), undefined, big), '⬆️ upstairs');
  assert.equal(whereabouts(peer(4.8, 5.8, 'agent-office', 3), undefined, big), '⬆️ upstairs');
  // North of its rail there's no deck, and under it is the office floor.
  assert.equal(whereabouts(peer(0, 0, 'agent-office', 3), undefined, big), undefined);
  assert.equal(whereabouts(peer(-14, 9, 'agent-office'), undefined, big), undefined);
  // The west end of it is over nothing on a floor with the corner loft, and nobody's upstairs on one level.
  assert.equal(whereabouts(peer(-14, 11, 'agent-office', 3), undefined, {}), undefined);
  for (const room of [{ mezzanine: 'none' as const }, { loft: false }]) {
    assert.equal(whereabouts(peer(14, 10, 'agent-office', 3), undefined, room), undefined);
    assert.equal(whereabouts(peer(-14, 11, 'agent-office', 3), undefined, room), undefined);
  }
});

test("someone upstairs on another floor is upstairs: that floor's room isn't known here", () => {
  const was = { floor: store.floor, plan: store.floorPlan };
  try {
    store.floor = 'mine';
    store.floorPlan = { ...EMPTY_PLAN };
    // On your own floor the room is the floor's plan's: the office as it comes has the boss's office.
    assert.equal(whereabouts(peer(14, 10, 'mine', 3)), "👔 in the boss's office");
    assert.equal(whereabouts(peer(-14, 11, 'mine', 3)), undefined);
    // Someone else's floor may have the big mezzanine, or an empty loft, or the boss's office: upstairs is all there is to say.
    assert.equal(whereabouts(peer(14, 10, 'theirs', 3)), '⬆️ upstairs');
    assert.equal(whereabouts(peer(-14, 11, 'theirs', 3)), '⬆️ upstairs');
    // Where no floor has a deck they aren't upstairs, and down on its floor they're wherever they are.
    assert.equal(whereabouts(peer(0, 0, 'theirs', 3)), undefined);
    assert.equal(whereabouts(peer(14, 10, 'theirs')), '🤝 in the meeting room');
    assert.equal(whereabouts(peer(-4, 15, 'theirs')), '🌇 on the balcony');

    // Your floor with the big mezzanine: its plan says so.
    store.floorPlan = { ...EMPTY_PLAN, room: { mezzanine: 'big' } };
    assert.equal(whereabouts(peer(14, 10, 'mine', 3)), '⬆️ upstairs');
    assert.equal(whereabouts(peer(-14, 11, 'mine', 3)), '⬆️ upstairs');
    store.floorPlan = { ...EMPTY_PLAN, room: { boss: false } };
    assert.equal(whereabouts(peer(14, 10, 'mine', 3)), '⬆️ upstairs');
    store.floorPlan = { ...EMPTY_PLAN, room: { mezzanine: 'none' } };
    assert.equal(whereabouts(peer(14, 10, 'mine', 3)), undefined);
    // The roof has no rooms of the office's, whoever's floor it's over.
    assert.equal(whereabouts(peer(14, 10, ROOF, 3)), undefined);
  } finally {
    store.floor = was.floor;
    store.floorPlan = was.plan;
  }
});
