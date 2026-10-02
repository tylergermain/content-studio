// The boss's desk (src/client/features/boss-desk): who counts as sitting at it, what its monitors show,
// and the two guest chairs across it, which are the loft's and go with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOSS_DESK,
  BOSS_PLACE,
  BOSS_SEAT,
  GUEST_SEATS,
  across,
  deskCard,
  deskPeople,
  deskRole,
  deskSeat,
  hasBossDesk,
  mirrorWanted,
  recall,
  remember,
  type DeskPerson,
} from '../src/client/features/boss-desk/desk.js';
import { ROOM_DEFAULTS } from '../src/shared/floorplan.js';
import { DEFAULT_FURNITURE, floorSeat } from '../src/shared/furniture.js';
import { LOFT, SEATING_BY_ID, seatAt } from '../src/shared/layout.js';
import { LOFT_SEATS } from '../src/shared/office-fixed.js';

const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps;

test('a seat is at the desk by its id, and a place by its key', () => {
  assert.equal(BOSS_PLACE, `${BOSS_SEAT}:0`);
  assert.equal(deskRole('boss-chair:0'), 'boss');
  assert.equal(deskRole('boss-guest-1:0'), 'guest');
  assert.equal(deskRole('boss-guest-2:0'), 'guest');
  assert.equal(deskRole('loft-couch:0'), null);
  assert.equal(deskRole(undefined), null);
  assert.equal(deskRole('boss-guest-1'), null, 'a seat with no place');
  assert.equal(deskRole('boss-guest-1:1'), null, 'a chair has the one place');
  assert.equal(deskRole('boss-guest-3:0'), null);
  assert.equal(deskRole(''), null);

  assert.equal(deskSeat('boss-chair'), 'boss');
  for (const id of GUEST_SEATS) assert.equal(deskSeat(id), 'guest');
  assert.equal(deskSeat('couch'), null);
  assert.equal(deskSeat(undefined), null);
  assert.equal(deskSeat('boss-chair:0'), null, 'a place is not a seat id');
});

const ty: DeskPerson = { id: 'ty', name: 'Tyler', seat: 'boss-chair:0' };
const gav: DeskPerson = { id: 'gav', name: 'Gavin', seat: 'boss-guest-2:0' };
const amy: DeskPerson = { id: 'amy', name: 'Amy', seat: 'boss-guest-1:0' };
const sofa: DeskPerson = { id: 'sofa', name: 'Sam', seat: 'loft-couch:0' };
const walker: DeskPerson = { id: 'walk', name: 'Wes' };

test('the desk has a boss and the guests across from them, of the people on the floor', () => {
  const at = deskPeople([walker, gav, sofa, ty, amy]);
  assert.equal(at.boss, ty);
  assert.deepEqual(at.guests, [amy, gav], 'by chair, west first, whatever order they came in');
  assert.deepEqual(deskPeople([walker, sofa]), { boss: null, guests: [] });
  assert.deepEqual(deskPeople([]), { boss: null, guests: [] });

  assert.deepEqual(across('boss', at, 'ty'), [amy, gav]);
  assert.deepEqual(across('guest', at, 'gav'), [ty]);
  assert.deepEqual(across('guest', at, 'amy'), [ty], 'the other guest is on your own side');
  assert.deepEqual(across('guest', { boss: null, guests: [gav] }, 'gav'), []);
  assert.deepEqual(across('boss', { boss: ty, guests: [] }, 'ty'), []);
  // Never yourself, even if the list has you on the other side.
  assert.deepEqual(across('boss', { boss: ty, guests: [gav, ty] }, 'ty'), [gav]);
  assert.deepEqual(across('guest', { boss: gav, guests: [gav] }, 'gav'), []);
});

test("the game goes out to the guests only when it wouldn't take down a screen the boss chose to share", () => {
  const playing = { role: 'boss', playing: true, guests: 1, sharing: false, kind: null } as const;
  assert.equal(mirrorWanted(playing), true);
  assert.equal(mirrorWanted({ ...playing, guests: 2 }), true);
  assert.equal(mirrorWanted({ ...playing, role: 'guest' }), false, 'not the boss');
  assert.equal(mirrorWanted({ ...playing, role: null }), false, 'not at the desk');
  assert.equal(mirrorWanted({ ...playing, playing: false }), false, 'no game open');
  assert.equal(mirrorWanted({ ...playing, guests: 0 }), false, 'nobody across');
  assert.equal(mirrorWanted({ ...playing, sharing: true, kind: null }), false, "a share that isn't the desk's");
  assert.equal(mirrorWanted({ ...playing, sharing: true, kind: 'screen' }), false, 'their real screen is up');
  assert.equal(mirrorWanted({ ...playing, sharing: true, kind: 'game' }), true, 'the game is what is up: keep it');
  assert.equal(mirrorWanted({ ...playing, sharing: true, kind: 'game', guests: 0 }), false, 'the guest got up');
  assert.equal(mirrorWanted({ ...playing, sharing: true, kind: 'game', playing: false }), false, 'the game was closed');
});

test('with no picture the monitors say who is at the desk and what they are doing', () => {
  assert.deepEqual(deskCard(null), { icon: '👑', title: "Boss's desk", line: 'Nobody at the desk' });
  assert.deepEqual(deskCard(null, true), { icon: '👑', title: "Boss's desk", line: 'Nobody at the desk' });
  assert.deepEqual(deskCard(ty), { icon: '👑', title: 'Tyler', line: 'At the desk' });
  assert.deepEqual(deskCard({ ...ty, doing: '' }), { icon: '👑', title: 'Tyler', line: 'At the desk' });
  assert.deepEqual(deskCard({ ...ty, doing: '🐍 playing Snake' }), { icon: '👑', title: 'Tyler', line: '🐍 playing Snake' });
  assert.deepEqual(deskCard({ ...ty, sharing: true, doing: '🐍 playing Snake' }, true), { icon: '🖥️', title: 'Tyler', line: "Connecting to Tyler's screen…" });
});

test('what the boss did last is kept in the browser, and a browser that keeps nothing is no trouble', () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  assert.equal(recall(storage), null);
  remember('snake', storage);
  assert.equal(recall(storage), 'snake');
  remember('share', storage);
  assert.equal(recall(storage), 'share');
  assert.deepEqual([...kept.keys()], ['agent-office.bossdesk']);

  const broken = {
    getItem(): string | null {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('full');
    },
  };
  assert.equal(recall(broken), null);
  assert.doesNotThrow(() => remember('snake', broken));
  // With none handed in it's the browser's own, which this run may not have.
  assert.doesNotThrow(() => remember('snake'));
  assert.doesNotThrow(() => recall());
});

test('a floor has the desk when it has the mezzanine', () => {
  assert.equal(hasBossDesk(ROOM_DEFAULTS), true);
  assert.equal(hasBossDesk({}), true, "a room that doesn't say has it");
  assert.equal(hasBossDesk({ loft: true }), true);
  assert.equal(hasBossDesk({ loft: false }), false);
});

test('the guest chairs are up in the loft, across the desk, turned in toward it', () => {
  // The desk is where loft.ts builds it: if it moves there, this says so.
  assert.ok(near(BOSS_DESK.x, 14, 1e-9) && near(BOSS_DESK.y, 3, 1e-9) && near(BOSS_DESK.z, 10.2, 1e-9), JSON.stringify(BOSS_DESK));
  const boss = SEATING_BY_ID.get(BOSS_SEAT)!;
  assert.ok(near(boss.x, BOSS_DESK.x, 1e-9) && boss.z > BOSS_DESK.z, 'the boss sits south of it');

  for (const id of GUEST_SEATS) {
    const seat = SEATING_BY_ID.get(id)!;
    assert.equal(seat.y, LOFT.y);
    assert.equal(seat.places.length, 1);
    assert.ok(seat.z < BOSS_DESK.z - 0.6, 'north of the desk');
    assert.ok(seat.label.startsWith('🪑 '), 'an icon, a space, then its name (see ui/whereabouts.ts)');
    assert.ok(LOFT_SEATS.has(id), `${id} goes with the loft`);
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id, ROOM_DEFAULTS)?.y, LOFT.y);
    assert.equal(floorSeat(DEFAULT_FURNITURE, 0, id, { loft: false }), undefined);
    assert.equal(seatAt(`${id}:1`), undefined);
  }

  const west = seatAt('boss-guest-1:0')!;
  assert.ok(near(west.x, 13.076) && west.y === 3 && near(west.z, 8.956), JSON.stringify(west));
  assert.equal(west.rotY, 0.5);
  const east = seatAt('boss-guest-2:0')!;
  assert.ok(near(east.x, 14.924) && east.y === 3 && near(east.z, 8.956), JSON.stringify(east));
  assert.equal(east.rotY, -0.5);
  // Each faces the middle of the desk's far side, more or less: in toward the other chair, and south.
  assert.ok(Math.sin(west.rotY) > 0 && Math.sin(east.rotY) < 0 && Math.cos(west.rotY) > 0);
});
