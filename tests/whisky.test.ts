import test from 'node:test';
import assert from 'node:assert/strict';
import type { Piece } from '../src/shared/furniture.js';
import type { ServerMsg } from '../src/shared/protocol.js';
import { CLINK, CLINK_MOST, GLASSES, POUR_EVERY_MS, POUR_SECONDS, SIPS, TOLD, Toasts, WHISKY_KIND, canPour, cheersLine, clinkWith, nameList, pourSpot } from '../src/shared/whisky.js';
import { Dram, NURSE_SECONDS, SIP_SECONDS } from '../src/client/features/whisky/dram.js';
import { MOST_WAITING, PourQueue } from '../src/client/features/whisky/queue.js';
import { SIP_AFTER, Toast } from '../src/client/features/whisky/toast.js';
import { Partners } from '../src/client/features/whisky/partners.js';
import { whiskyHandlers, whiskyHooks, whiskyView } from '../src/server/ws/handlers/whisky.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Floor } from '../src/server/floor.js';

// The whisky cabinet (shared/whisky.ts, features/whisky, ws/handlers/whisky.ts): where you pour from, who
// you clink glasses with, how a dram goes down sip by sip, whose turn it is at the decanter, what a toast
// does to your dram, how often the floor hears of one, and the office's side of it all.

const cabinet = (extra: Partial<Piece> = {}): Piece => ({ id: 'whisky', kind: WHISKY_KIND, x: 5, z: 7.5, rotY: 0, ...extra });
const at = (id: string, x: number, z: number, y = 0) => ({ id, x, y, z });

test('you pour standing at the cabinet\'s front, wherever it is turned, on its own floor', () => {
  assert.deepEqual(pourSpot(cabinet()), { x: 5, y: 0, z: 8.35 });
  const into = { x: 0, y: 0, z: 0, kind: 'whisky' };
  assert.equal(pourSpot(cabinet(), into), into, 'or into what you hand it, making nothing new');
  assert.deepEqual(into, { x: 5, y: 0, z: 8.35, kind: 'whisky' });
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
  assert.deepEqual(sent, [{ t: 'whisky.cheers', ids: ['t', 'g'], names: ['Tyler', 'Gavin'], x: 5, y: 0, z: 8.4, told: true }]);
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

test('two pouring at once take turns at the decanter, and only a couple may wait', () => {
  const q = new PourQueue();
  assert.equal(q.add(0, 10), 10, 'nobody at it: it starts now');
  assert.equal(q.add(1, 10.5), 10 + POUR_SECONDS, 'the next waits for the first to be done');
  assert.equal(q.add(2, 11), 10 + POUR_SECONDS + POUR_SECONDS, 'and the one after that for both');
  assert.equal(MOST_WAITING, 2);
  assert.equal(q.add(3, 11.2), null, 'any more and the pour is dropped: the glass is just in their hand');
  assert.equal(q.pours.length, 1 + MOST_WAITING);
  assert.equal(q.current(10.2)?.glass, 0, 'the first is under way');
  assert.equal(q.waiting(1, 10.2, 1.85), true, 'the second\'s glass is still on the tray');
  assert.equal(q.current(10 + POUR_SECONDS + 0.1)?.glass, 1, 'then the second, once the first is done');
  assert.equal(q.pours.length, 2, 'and the first is gone');
  // Once they're all done there's room again, and the next starts at once.
  const later = 10 + 3 * POUR_SECONDS + 1;
  assert.equal(q.current(later), undefined);
  assert.equal(q.add(1, later), later);
  assert.equal(q.add(GLASSES + 3, later + 0.1), later + POUR_SECONDS, 'a glass past the tray\'s is its last');
  assert.equal(q.pours[1].glass, GLASSES - 1);
});

test('only your own toast sips your dram: one raised to you puts your glass up, no more', () => {
  const d = new Dram(() => 0.9);
  const t = new Toast(d);
  d.pour(0);
  const theirs = t.heard({ ids: ['gavin', 'me'], told: true }, 'me', 5);
  assert.deepEqual(theirs, { raise: true, yours: false, told: true });
  for (let now = 5; now < 12; now += 0.25) assert.equal(t.due(now), false, 'no sip to someone else\'s toast');
  assert.equal(d.level, 1, 'the dram is as it was');
  // Not in it at all: nothing goes up.
  assert.deepEqual(t.heard({ ids: ['gavin', 'sam'] }, 'me', 6), { raise: false, yours: false, told: false });
  // Your own: a sip to it, once the glasses have clinked.
  assert.deepEqual(t.heard({ ids: ['me', 'gavin'] }, 'me', 20), { raise: true, yours: true, told: false });
  assert.equal(t.due(20 + SIP_AFTER - 0.01), false);
  assert.equal(t.due(20 + SIP_AFTER), true);
  assert.equal(t.due(20 + SIP_AFTER + 1), false, 'one sip, not one a frame');
  // With no glass by then (it went back), no sip.
  t.heard({ ids: ['me', 'gavin'] }, 'me', 30);
  d.putDown();
  assert.equal(t.due(40), false);
});

test('the office pours for you no faster than a pour takes, so nobody can stack them up', () => {
  assert.ok(POUR_EVERY_MS >= POUR_SECONDS * 1000, `${POUR_EVERY_MS} ms between pours, a pour ${POUR_SECONDS} s`);
  const { ctx, sent, person } = office();
  const tyler = person('t', 'Tyler', 5, 8.4);
  whiskyHandlers['whisky.pour'](ctx, tyler, { t: 'whisky.pour', piece: 'whisky' });
  assert.equal(sent.length, 1);
  // Just before the pour would be done: refused.
  tyler.throttles.set('whisky.pour', Date.now() - POUR_SECONDS * 1000 + 100);
  whiskyHandlers['whisky.pour'](ctx, tyler, { t: 'whisky.pour', piece: 'whisky' });
  assert.equal(sent.length, 1, 'not while the last pour is still going');
  tyler.throttles.set('whisky.pour', Date.now() - POUR_EVERY_MS - 1);
  whiskyHandlers['whisky.pour'](ctx, tyler, { t: 'whisky.pour', piece: 'whisky' });
  assert.equal(sent.length, 2, 'once it\'s done, a top-up');
});

test('the floor hears of a toast now and then, not every one: once a pair a while, once a floor every few seconds', () => {
  const t = new Toasts();
  assert.equal(t.tell(['t', 'g'], 0), true, 'the first is told');
  assert.equal(t.tell(['g', 't'], TOLD.floor), false, 'the same two again soon (either way round) are not');
  assert.equal(t.tell(['s', 'a'], TOLD.floor - 1), false, 'nor anyone else, so soon after on the same floor');
  assert.equal(t.tell(['s', 'a'], TOLD.floor), true, 'two others, a little later, are');
  assert.equal(t.tell(['t', 'g', 's'], TOLD.floor * 2), true, 'a toast with someone new in it is');
  assert.equal(t.tell(['t', 'g'], TOLD.pair - 1), false);
  assert.equal(t.tell(['t', 'g'], TOLD.floor * 2 + TOLD.pair), true, 'and the same two once a while has gone by');
});

test('the office clinks every toast but tells the floor only some of them', () => {
  const { ctx, sent, person } = office();
  const tyler = person('t', 'Tyler', 5, 8.4);
  const gavin = person('g', 'Gavin', 5.6, 8.6);
  for (const c of [tyler, gavin]) whiskyHandlers['whisky.pour'](ctx, c, { t: 'whisky.pour', piece: 'whisky' });
  sent.length = 0;
  for (let i = 0; i < 4; i++) {
    tyler.throttles.clear();
    gavin.throttles.clear();
    whiskyHandlers['whisky.cheers'](ctx, i % 2 ? gavin : tyler, { t: 'whisky.cheers' });
  }
  assert.equal(sent.length, 4, 'the glasses clink every time');
  assert.deepEqual(
    sent.map((m) => m.t === 'whisky.cheers' && !!m.told),
    [true, false, false, false],
    'the floor is told once',
  );
});

test('who you\'d clink with is found each frame, nearest first, and only changes when they do', () => {
  const p = new Partners();
  const people = new Map([
    ['me', { id: 'me', name: 'Me', x: 0, y: 0, z: 0 }],
    ['a', { id: 'a', name: 'Ann', x: 1.5, y: 0, z: 0 }],
    ['b', { id: 'b', name: 'Bo', x: 0.5, y: 0, z: 0.5 }],
    ['c', { id: 'c', name: 'Cy', x: 3, y: 0, z: 0 }],
  ]);
  const at = (id: string) => (id === 'me' ? undefined : people.get(id));
  const me = people.get('me')!;
  p.find(me, people.keys(), at);
  assert.deepEqual(p.names, ['Bo', 'Ann']);
  const { names, key } = p;
  p.find(me, people.keys(), at);
  assert.equal(p.names, names, 'the same people: the same list, nothing new made');
  assert.equal(p.key, key);
  people.get('c')!.x = 0.2;
  p.find(me, people.keys(), at);
  assert.deepEqual(p.names, ['Cy', 'Bo', 'Ann']);
  assert.notEqual(p.key, key);
  const crowd = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, x: 0.1 * (9 - i), y: 0, z: 0 }));
  p.find(me, crowd.map((o) => o.id), (id) => crowd.find((o) => o.id === id));
  assert.equal(p.names.length, CLINK_MOST, 'a handful at most');
  assert.deepEqual(p.names, ['P8', 'P7', 'P6', 'P5', 'P4'], 'the nearest of them');
  p.clear();
  assert.deepEqual(p.names, []);
});
