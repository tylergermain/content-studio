import test from 'node:test';
import assert from 'node:assert/strict';
import type { Piece } from '../src/shared/furniture.js';
import type { ServerMsg } from '../src/shared/protocol.js';
import { CLINK, CLINK_MOST, SIPS, WHISKY_KIND, canPour, cheersLine, clinkWith, nameList, pourSpot } from '../src/shared/whisky.js';
import { Dram, NURSE_SECONDS, SIP_SECONDS } from '../src/client/features/whisky/dram.js';
import { whiskyHandlers, whiskyHooks, whiskyView } from '../src/server/ws/handlers/whisky.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Floor } from '../src/server/floor.js';

// The whisky cabinet (shared/whisky.ts, features/whisky, ws/handlers/whisky.ts): where you pour from, who
// you clink glasses with, how a dram goes down sip by sip, and the office's side of it all.

const cabinet = (extra: Partial<Piece> = {}): Piece => ({ id: 'whisky', kind: WHISKY_KIND, x: 5, z: 7.5, rotY: 0, ...extra });
const at = (id: string, x: number, z: number, y = 0) => ({ id, x, y, z });

test('you pour standing at the cabinet\'s front, wherever it is turned, on its own floor', () => {
  assert.deepEqual(pourSpot(cabinet()), { x: 5, y: 0, z: 8.35 });
  const turned = pourSpot(cabinet({ rotY: Math.PI / 2 }));
  assert.ok(Math.abs(turned.x - 5.85) < 1e-9 && Math.abs(turned.z - 7.5) < 1e-9, `turned a quarter, its front is toward +x: ${JSON.stringify(turned)}`);
  assert.equal(pourSpot(cabinet({ level: 1 })).y > 2, true, 'upstairs, it is the deck you stand on');
  assert.equal(canPour(cabinet(), { x: 5, y: 0, z: 8.4 }), true);
  assert.equal(canPour(cabinet(), { x: 5.4, y: 0, z: 9.5 }), true, 'a step back is still in reach');
  assert.equal(canPour(cabinet(), { x: 5, y: 0, z: 12 }), false, 'across the room is not');
  assert.equal(canPour(cabinet({ level: 1 }), { x: 5, y: 0, z: 8.4 }), false, 'nor is the floor under a cabinet upstairs');
});

test('you clink glasses with whoever has one within a couple of metres, nearest first', () => {
  const me = at('me', 0, 0);
  assert.deepEqual(clinkWith(me, [at('a', 1.5, 0), at('b', 0.5, 0.5), at('c', 3, 0)]).map((p) => p.id), ['b', 'a']);
  assert.deepEqual(clinkWith(me, [at('me', 0, 0)]), [], 'not with yourself');
  assert.deepEqual(clinkWith(me, [at('a', CLINK.reach + 0.01, 0)]), [], 'just out of reach');
  assert.deepEqual(clinkWith(me, [at('a', CLINK.reach, 0)]).length, 1, 'right at the edge of it');
  assert.deepEqual(clinkWith(me, [at('a', 0.5, 0, 3)]), [], 'not with someone on the deck over your head');
  assert.deepEqual(clinkWith(me, [at('a', 3, 0)], 3.2).length, 1, 'the office allows for a little lag');
  const crowd = Array.from({ length: 9 }, (_, i) => at(`p${i}`, 0.1 * (i + 1), 0));
  assert.equal(clinkWith(me, crowd).length, CLINK_MOST, 'one toast takes in a handful');
});

test('the floor hears who raised a glass', () => {
  assert.equal(nameList(['Tyler']), 'Tyler');
  assert.equal(nameList(['Tyler', 'Gavin']), 'Tyler and Gavin');
  assert.equal(nameList(['Tyler', 'Gavin', 'Sam']), 'Tyler, Gavin and Sam');
  assert.equal(cheersLine(['Tyler', 'Gavin']), '🥃 Tyler and Gavin raised a glass of The Macallan Litha');
});

test('a dram goes down a sip at a time, a sip takes its moment, and empty the glass goes back', () => {
  const d = new Dram(() => 0);
  assert.equal(d.holding, false);
  assert.equal(d.sip(0), false, 'nothing to sip without a glass');
  d.pour(10);
  assert.equal(d.holding, true);
  assert.equal(d.level, 1);
  assert.equal(d.sip(11), true);
  assert.equal(d.level, (SIPS - 1) / SIPS);
  assert.equal(d.sipping(11 + SIP_SECONDS / 2), true);
  assert.equal(d.sip(11 + SIP_SECONDS / 2), false, 'not while the glass is still up from the last');
  let now = 11;
  for (let i = 1; i < SIPS; i++) assert.equal(d.sip((now += SIP_SECONDS + 0.1)), true);
  assert.equal(d.level, 0);
  assert.equal(d.holding, false, 'the last sip empties it');
  assert.equal(d.due(now + 1000), false);
});

test('nursing it, you sip of your own accord now and then, and a top-up fills it again', () => {
  const d = new Dram(() => 0.5);
  d.pour(0);
  assert.equal(d.due(NURSE_SECONDS * 1.5 - 0.1), false);
  assert.equal(d.due(NURSE_SECONDS * 1.5), true);
  d.sip(NURSE_SECONDS * 1.5);
  assert.equal(d.due(NURSE_SECONDS * 1.6), false, 'the next comes a while after');
  d.pour(40);
  assert.equal(d.level, 1, 'topped up');
  d.putDown();
  assert.equal(d.holding, false);
  assert.equal(d.due(1e6), false);
});

/** The office's side, with a floor that has the cabinet and a few people on it. */
function office() {
  const floor = { id: 'f1', plan: { layoutNow: () => ({ furniture: [cabinet()] }), wing: 0 } } as unknown as Floor;
  const clients = new Map<string, Client>();
  const sent: ServerMsg[] = [];
  const warned: string[] = [];
  const ctx = {
    clients,
    floorOf: (c: Client) => (c.peer.floor === 'f1' ? floor : undefined),
    toFloor: (_f: Floor, m: ServerMsg) => void sent.push(m),
    warn: (_c: Client, e: string | undefined) => void (e && warned.push(e)),
  } as unknown as Ctx;
  const person = (id: string, name: string, x: number, z: number) => {
    const c = { id, peer: { id, name, x, y: 0, z, floor: 'f1' }, throttles: new Map() } as unknown as Client;
    clients.set(id, c);
    return c;
  };
  return { ctx, floor, sent, warned, person };
}

test('the office pours for whoever is at the cabinet, and only them, and says so to the floor', () => {
  const { ctx, floor, sent, warned, person } = office();
  const far = person('far', 'Sam', 5, 1);
  whiskyHandlers['whisky.pour'](ctx, far, { t: 'whisky.pour', piece: 'whisky' });
  assert.deepEqual(warned, ['Walk up to the whisky cabinet first']);
  whiskyHandlers['whisky.pour'](ctx, person('x', 'X', 5, 8.4), { t: 'whisky.pour', piece: 'sofa' });
  assert.equal(warned[1], 'There is no whisky cabinet there');
  const tyler = person('t', 'Tyler', 5, 8.4);
  whiskyHandlers['whisky.pour'](ctx, tyler, { t: 'whisky.pour', piece: 'whisky' });
  assert.deepEqual(sent, [{ t: 'whisky.poured', id: 't', piece: 'whisky' }]);
  // Again at once is too soon; a while later it's a top-up of the glass in hand.
  whiskyHandlers['whisky.pour'](ctx, tyler, { t: 'whisky.pour', piece: 'whisky' });
  assert.equal(sent.length, 1);
  tyler.throttles.clear();
  whiskyHandlers['whisky.pour'](ctx, tyler, { t: 'whisky.pour', piece: 'whisky' });
  assert.deepEqual(sent[1], { t: 'whisky.poured', id: 't', piece: 'whisky', top: true });
  assert.deepEqual(whiskyView(ctx, floor), ['t']);
});

test('glasses clink between people near each other with one each, and go back on the tray', () => {
  const { ctx, floor, sent, warned, person } = office();
  const tyler = person('t', 'Tyler', 5, 8.4);
  const gavin = person('g', 'Gavin', 5.6, 8.6);
  const sam = person('s', 'Sam', 5.3, 8.2);
  whiskyHandlers['whisky.cheers'](ctx, tyler, { t: 'whisky.cheers' });
  assert.equal(sent.length, 0, 'no glass, no toast');
  for (const c of [tyler, gavin]) whiskyHandlers['whisky.pour'](ctx, c, { t: 'whisky.pour', piece: 'whisky' });
  sent.length = 0;
  // Sam, right there but with no glass, isn't in it.
  whiskyHandlers['whisky.cheers'](ctx, tyler, { t: 'whisky.cheers' });
  assert.deepEqual(sent, [{ t: 'whisky.cheers', ids: ['t', 'g'], names: ['Tyler', 'Gavin'], x: 5, y: 0, z: 8.4 }]);
  whiskyHandlers['whisky.cheers'](ctx, tyler, { t: 'whisky.cheers' });
  assert.equal(sent.length, 1, 'once in a while, not as fast as you can press C');
  // Gavin wanders off across the room: nobody near enough.
  Object.assign(gavin.peer, { x: 12, z: 0 });
  tyler.throttles.clear();
  whiskyHandlers['whisky.cheers'](ctx, tyler, { t: 'whisky.cheers' });
  assert.equal(warned.at(-1), 'Nobody with a glass is near enough to clink');
  // Tyler drinks up; Gavin takes the elevator, and his glass stays on the floor he left.
  whiskyHandlers['whisky.down'](ctx, tyler, { t: 'whisky.down' });
  whiskyHooks.leaving!(ctx, gavin, floor);
  assert.deepEqual(sent.slice(-2), [
    { t: 'whisky.down', id: 't' },
    { t: 'whisky.down', id: 'g' },
  ]);
  assert.deepEqual(whiskyView(ctx, floor), []);
  assert.ok(sam);
});
