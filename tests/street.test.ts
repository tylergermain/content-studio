import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parkedHeli } from '../src/shared/heli.js';
import { streetBelow } from '../src/shared/layout.js';
import { claimedBox, shellTop } from '../src/shared/mainstreet.js';
import { BUSINESS_ID, type BusinessCard, type HeliPose, type HeliState, type PlotLook, type ServerMsg, type StreetFile } from '../src/shared/protocol.js';
import { STEP_OFF, wallsOf, whyNotClear } from '../src/server/street/clear.js';
import { LOOK_ERRORS, businessId, cleanBusinessName, defFrom, lookFrom } from '../src/server/street/look.js';
import { changedHands, streetIn, streetOf } from '../src/server/street/registry.js';
import { heliOf } from '../src/server/heli/index.js';
import { streetHandlers, streetView } from '../src/server/ws/handlers/street.js';
import type { Client } from '../src/server/office/client.js';
import type { Ctx } from '../src/server/office/context.js';

// Main Street's plots on the office's side (server/street/, ws/handlers/street.ts): street.json and what
// it does with a file it can't read, the rules a claim is held to, a business's id, and the handler:
// street admins only, never walls round Friday One or anyone standing there, and everyone told.

const ACME: PlotLook = { name: 'Acme', accent: '#ff8800', skin: 'brick', stage: 'site', planned: 4 };
const BOLT: PlotLook = { name: 'Bolt Bikes', accent: '#2fbf71', skin: 'timber', stage: 'shell', planned: 3 };

/** An empty data folder of its own, gone after the test. */
function dataDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-street-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** What the office logs with console.error during the test, kept out of the test's output. */
function logged(t: { mock: { method: (o: object, m: string, f: (...a: unknown[]) => void) => unknown } }): string[] {
  const lines: string[] = [];
  t.mock.method(console, 'error', (...a: unknown[]) => void lines.push(a.join(' ')));
  return lines;
}

const card = (plot: 'P2' | 'P3' | 'P7', id: string, look: PlotLook): BusinessCard => ({
  id,
  name: look.name,
  plot,
  accent: look.accent,
  skin: look.skin,
  stage: look.stage,
  home: 'hosted',
  storeys: Array.from({ length: look.planned }, () => ({ name: look.name, accent: look.accent })),
});

test('with no street.json every plot is for lease, and the first claim writes it, whole and private', (t) => {
  const dir = dataDir(t);
  const street = streetIn(dir);
  assert.deepEqual(street.view(), { cards: [] });
  const r = street.claim('P3', ACME, 'Tyler', 1000);
  assert.ok('def' in r);
  assert.deepEqual(r.def, { id: 'acme', name: 'Acme', plot: 'P3', accent: '#ff8800', skin: 'brick', stage: 'site', planned: 4, home: 'hosted', maxFloors: 4, maxWorkers: 3, by: 'Tyler', at: 1000 });
  const file = path.join(dir, 'street.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')) as StreetFile, { version: 1, businesses: [r.def] });
  assert.equal(statSync(file).mode & 0o777, 0o600, 'only the office reads it');
  assert.deepEqual(readdirSync(dir), ['street.json'], 'no half-written file left beside it');
  // Everyone sees its card: a site's storeys are the ones planned, and no quotas, trust or addresses.
  assert.deepEqual(street.cards(), [card('P3', 'acme', ACME)]);
  // The office after a restart reads it back.
  assert.deepEqual(streetIn(dir).defs(), [r.def]);
});

test('a plot is claimed once, changed without its id changing, and given back to be claimed again', (t) => {
  const street = streetIn(dataDir(t));
  assert.ok('def' in street.claim('P3', ACME, 'Tyler'));
  assert.deepEqual(street.claim('P3', BOLT, 'Gavin'), { error: "🏙 Plot 3 is Acme's already" });
  const e = street.edit('P3', { name: 'Acme Robotics', stage: 'shell', planned: 6 });
  assert.ok('def' in e);
  assert.equal(e.def.id, 'acme', 'its id stays what it was');
  assert.deepEqual(street.cards()[0], card('P3', 'acme', { ...ACME, name: 'Acme Robotics', stage: 'shell', planned: 6 }));
  assert.deepEqual(street.edit('P3', { planned: 2 }, 'bolt-bikes'), { error: changedHands('P3') }, 'not from a window showing someone else');
  assert.deepEqual(street.edit('P2', { planned: 2 }), { error: '🏙 Plot 2 is for lease: claim it first' });
  assert.deepEqual(street.release('P3', 'bolt-bikes'), { error: changedHands('P3') });
  const gone = street.release('P3', 'acme');
  assert.ok('def' in gone && gone.def.name === 'Acme Robotics');
  assert.deepEqual(street.cards(), []);
  assert.deepEqual(street.release('P3'), { error: '🏙 Plot 3 is for lease already' });
  assert.ok('def' in street.claim('P3', BOLT, 'Gavin'), 'for lease again');
  assert.deepEqual(street.cards(), [card('P3', 'bolt-bikes', BOLT)]);
});

test("a business's id is made from its name: short, unique, and never the host's", (t) => {
  const cases: [string, string, string[], string][] = [
    ['Acme Robotics', 'P3', [], 'acme-robotics'],
    ['Café Ünïcode', 'P2', [], 'cafe-unicode'],
    ['  --Acme!!  ', 'P2', [], 'acme'],
    ['Acme', 'P3', ['acme'], 'acme-2'],
    ['Acme', 'P3', ['acme', 'acme-2'], 'acme-3'],
    ['Friday Labs', 'P2', [], 'friday-labs-2'],
    ['X', 'P3', [], 'x-p3'],
    ['東京', 'P7', [], 'p7'],
    ['🚀', 'P7', [], 'p7'],
    ['The Extraordinarily Long Company Name', 'P2', [], 'the-extraordinarily'],
    ['abcdefghijklmnopqrst', 'P2', ['abcdefghijklmnopqrst'], 'abcdefghijklmnopqr-2'],
  ];
  for (const [name, plot, taken, id] of cases) {
    const got = businessId(name, plot as 'P2' | 'P3' | 'P7', taken);
    assert.equal(got, id, name);
    assert.match(got, BUSINESS_ID, `${name}: an id a business can have`);
  }
  // Two businesses called the same are two ids.
  const street = streetIn(dataDir(t));
  street.claim('P2', ACME, 'Tyler');
  const again = street.claim('P3', ACME, 'Tyler');
  assert.ok('def' in again && again.def.id === 'acme-2');
});

test('a claim says all of its look, an edit only what changes, and every field is held to its list', () => {
  assert.deepEqual(lookFrom(ACME, true), { look: ACME });
  assert.deepEqual(lookFrom({ ...ACME, name: '  Acme\u0000​  Robotics\n' }, true), { look: { ...ACME, name: 'Acme Robotics' } });
  assert.deepEqual(lookFrom({ ...ACME, accent: '#FF8800' }, true), { look: ACME }, 'colors in lower case');
  assert.equal(cleanBusinessName('🚀'.repeat(32)), '🚀'.repeat(32), 'an emoji is one character');
  assert.equal(cleanBusinessName('x'.repeat(33)), '', 'a name is never cut short');
  for (const name of ['', '   ', '\u0007', 'x'.repeat(33), 42, null]) assert.deepEqual(lookFrom({ ...ACME, name }, true), { error: LOOK_ERRORS.name }, JSON.stringify(name));
  for (const accent of ['orange', '#f80', '#ff880', '#ff880g', 'url(x)', 0xff8800]) assert.deepEqual(lookFrom({ ...ACME, accent }, true), { error: LOOK_ERRORS.accent }, String(accent));
  for (const skin of ['marble', '', undefined]) assert.deepEqual(lookFrom({ ...ACME, skin }, true), { error: LOOK_ERRORS.skin });
  for (const stage of ['tower', 'built', 1]) assert.deepEqual(lookFrom({ ...ACME, stage }, true), { error: LOOK_ERRORS.stage });
  for (const planned of [0, 9, 2.5, '4', Number.NaN, -1]) assert.deepEqual(lookFrom({ ...ACME, planned }, true), { error: LOOK_ERRORS.planned }, String(planned));
  assert.deepEqual(lookFrom({ planned: 3 }, false), { look: { planned: 3 } });
  assert.deepEqual(lookFrom({}, false), { look: {} });
  assert.deepEqual(lookFrom({ planned: 3 }, true), { error: LOOK_ERRORS.name }, 'a claim leaves nothing out');
  assert.deepEqual(lookFrom({ stage: 'tower' }, false), { error: LOOK_ERRORS.stage });
});

test("a street.json that won't read is logged, taken as no businesses, and moved aside before it's written over", (t) => {
  const errors = logged(t);
  const files: [string, string][] = [
    ['not JSON', '{"version": 1, "businesses": ['],
    ['another version', '{"version": 2, "businesses": []}'],
    ['no list of businesses', '{"version": 1, "businesses": {"acme": {}}}'],
    ['not an object', '[]'],
  ];
  for (const [what, text] of files) {
    const dir = dataDir(t);
    const file = path.join(dir, 'street.json');
    writeFileSync(file, text);
    errors.length = 0;
    const street = streetIn(dir);
    assert.deepEqual(street.cards(), [], `${what}: no businesses`);
    assert.ok(errors.length === 1 && errors[0].includes(file), `${what}: logged, with where: ${errors.join(' | ')}`);
    assert.equal(readFileSync(file, 'utf8'), text, `${what}: left as it is until something's saved`);
    assert.ok('def' in street.claim('P2', ACME, 'Tyler'));
    const aside = readdirSync(dir).filter((f) => /^street\.json\.corrupt-\d+$/.test(f));
    assert.equal(aside.length, 1, `${what}: moved aside`);
    assert.equal(readFileSync(path.join(dir, aside[0]), 'utf8'), text, `${what}: as it was`);
    assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as StreetFile).businesses.map((d) => d.id), ['acme']);
    // Only the once: the next write is over the office's own file.
    street.claim('P3', BOLT, 'Tyler');
    assert.equal(readdirSync(dir).filter((f) => f.startsWith('street.json.corrupt-')).length, 1, `${what}: moved aside once`);
  }
});

test('a business in street.json that will not do is left out, with a log line, and the rest stand', (t) => {
  const errors = logged(t);
  const dir = dataDir(t);
  const file = path.join(dir, 'street.json');
  const acme = { id: 'acme', name: 'Acme', plot: 'P3', accent: '#ff8800', skin: 'brick', stage: 'shell', planned: 3, home: 'hosted', maxFloors: 4, maxWorkers: 3, by: 'Tyler', at: 5 };
  const businesses = [
    acme,
    { ...acme, id: 'Bad Id!', plot: 'P2' },
    { ...acme, id: 'squatter' },
    { ...acme, id: 'acme', plot: 'P7' },
    { ...acme, id: 'friday-labs', plot: 'P7' },
    { ...acme, id: 'tall', plot: 'P7', planned: 30 },
    'junk',
    // Kept, but without what it can't use: an address that isn't https, and more floors than a business may have.
    { ...acme, id: 'linked', plot: 'P2', home: 'linked', url: 'http://insecure.example', maxFloors: 99 },
  ];
  writeFileSync(file, JSON.stringify({ version: 1, businesses }));
  const street = streetIn(dir);
  assert.deepEqual(
    street.defs().map((d) => [d.id, d.plot]),
    [
      ['acme', 'P3'],
      ['linked', 'P2'],
    ],
  );
  const linked = street.defs()[1];
  assert.equal(linked.url, undefined);
  assert.equal(linked.maxFloors, 4, 'the default');
  assert.equal(errors.filter((e) => e.includes('left business')).length, 6, errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('linked') && e.includes('url') && e.includes('maxFloors')));
  // What was left out isn't lost when the office next writes.
  street.release('P3');
  const aside = readdirSync(dir).filter((f) => f.startsWith('street.json.corrupt-'));
  assert.equal(aside.length, 1);
  assert.equal((JSON.parse(readFileSync(path.join(dir, aside[0]), 'utf8')) as StreetFile).businesses.length, businesses.length);
  // And defFrom, on its own: a linked business's card and trust come through as they are.
  const card = { storeys: [{ name: 'Ground', accent: '#112233' }] };
  const r = defFrom({ ...acme, home: 'linked', url: 'https://acme.example', card, trusted: { by: 'Tyler', at: 9 }, budget: 20 }, []);
  assert.ok('def' in r && r.fixed.length === 0);
  assert.deepEqual([r.def.url, r.def.card, r.def.trusted, r.def.budget], ['https://acme.example', card, { by: 'Tyler', at: 9 }, 20]);
});

test("a change made to street.json while the office runs is read the next time it's asked", (t) => {
  const dir = dataDir(t);
  const file = path.join(dir, 'street.json');
  const street = streetIn(dir);
  street.claim('P3', ACME, 'Tyler');
  assert.equal(street.cards()[0].name, 'Acme');
  const f = JSON.parse(readFileSync(file, 'utf8')) as StreetFile;
  f.businesses[0] = { ...f.businesses[0], name: 'Acme Two', stage: 'shell' };
  writeFileSync(file, JSON.stringify(f));
  // However quick the edit, its time on disk is its own.
  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
  assert.equal(street.cards()[0].name, 'Acme Two');
  assert.equal(street.cards()[0].stage, 'shell');
  rmSync(file);
  assert.deepEqual(street.cards(), [], 'gone: no businesses');
});

// ---- The handler -------------------------------------------------------------------------------

/** An office with two floors (Friday's and the one above), Tyler an admin and Sam a member, and what it sent. */
function office(t: { after(fn: () => void): void }) {
  const dir = dataDir(t);
  const floors = new Map<string, unknown>([
    ['friday-labs', {}],
    ['ai-innovators', {}],
  ]);
  const clients = new Map<string, Client>();
  const sent: ServerMsg[] = [];
  const toasts: string[] = [];
  const warned: string[] = [];
  const roles: Record<string, { name: string; admin: boolean }> = { tyler: { name: 'Tyler', admin: true }, sam: { name: 'Sam', admin: false } };
  const ctx = {
    cfg: { dataDir: dir },
    clients,
    floors,
    meOf: (id: string | undefined) => {
      if (!id) return { admin: true };
      const a = roles[id];
      return a ? { account: { name: a.name, role: a.admin ? 'admin' : 'member' }, admin: a.admin } : { admin: false };
    },
    broadcast: (m: ServerMsg) => void sent.push(m),
    toastAll: (text: string) => void toasts.push(text),
    warn: (_c: Client, e: string | undefined) => void (e && warned.push(e)),
    sendTo: () => {},
    toFloor: () => {},
    floorOf: () => undefined,
  } as unknown as Ctx;
  /** Someone in the office: on Friday's floor at its floor level unless it's said, with an account or on the shared password. */
  const join = (id: string, o: { account?: string; name?: string; floor?: string; x?: number; y?: number; z?: number; lite?: boolean } = {}) => {
    const peer = { id, name: o.name ?? id, color: '#ffffff', x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, rotY: 0, floor: o.floor ?? 'friday-labs', ...(o.lite ? { lite: true } : {}) };
    const c = { id, accountId: o.account, admin: false, peer, throttles: new Map() } as unknown as Client;
    clients.set(id, c);
    return c;
  };
  return { ctx, sent, toasts, warned, join, roles };
}

const claim = (plot: 'P2' | 'P3' | 'P7', look: PlotLook) => ({ t: 'street.claim' as const, plot, ...look });

test('only street admins claim, change or release a plot, asked of the accounts each time', (t) => {
  const { ctx, sent, toasts, warned, join, roles } = office(t);
  const sam = join('sam', { account: 'sam', name: 'Sam' });
  const no = '🏙 Only street admins can claim, change or release a plot';
  streetHandlers['street.claim'](ctx, sam, claim('P3', ACME));
  streetHandlers['street.edit'](ctx, sam, { t: 'street.edit', plot: 'P3', planned: 2 });
  streetHandlers['street.release'](ctx, sam, { t: 'street.release', plot: 'P3' });
  assert.deepEqual(warned, [no, no, no]);
  assert.deepEqual([sent, toasts, streetOf(ctx).cards()], [[], [], []]);
  // Made an admin since: it counts at once.
  roles.sam.admin = true;
  streetHandlers['street.claim'](ctx, sam, claim('P3', ACME));
  assert.equal(streetOf(ctx).onPlot('P3')?.by, 'Sam');
  // And no longer one: nor does that wait.
  roles.sam.admin = false;
  sam.throttles.clear();
  streetHandlers['street.release'](ctx, sam, { t: 'street.release', plot: 'P3' });
  assert.equal(warned.at(-1), no);
  assert.ok(streetOf(ctx).onPlot('P3'));
  // Signed out while still connected: nothing they send counts.
  const tyler = join('tyler', { account: 'tyler' });
  tyler.out = true;
  streetHandlers['street.release'](ctx, tyler, { t: 'street.release', plot: 'P3' });
  assert.equal(warned.at(-1), no);
  // A plot that isn't one a business can have.
  tyler.out = false;
  streetHandlers['street.claim'](ctx, tyler, { ...claim('P2', ACME), plot: 'P1' as 'P2' });
  assert.equal(warned.at(-1), "🏙 That plot isn't one a business can have");
});

test('a claim is sent to everyone, on every floor, and the street is told', (t) => {
  const { ctx, sent, toasts, warned, join } = office(t);
  const tyler = join('tyler', { account: 'tyler', name: 'T-dog' });
  streetHandlers['street.claim'](ctx, tyler, claim('P3', ACME));
  assert.deepEqual(warned, []);
  assert.deepEqual(sent, [{ t: 'street', street: { cards: [card('P3', 'acme', ACME)] } }]);
  assert.deepEqual(toasts, ['🏗️ Acme is coming to Plot 3 on Main Street']);
  assert.equal(streetOf(ctx).onPlot('P3')?.by, 'Tyler', "the account's name, not the one on the name tag");
  assert.deepEqual(streetView(ctx, undefined), { cards: [card('P3', 'acme', ACME)] }, 'and whoever arrives, anywhere');
  // On the shared password, the name they gave.
  const guest = join('guest', { name: 'Gavin' });
  streetHandlers['street.claim'](ctx, guest, claim('P7', BOLT));
  assert.equal(toasts.at(-1), '🏢 Bolt Bikes is coming to Plot 7 on Main Street');
  assert.equal(streetOf(ctx).onPlot('P7')?.by, 'Gavin');
  // A plot that's taken, or a look that won't do, changes nothing.
  sent.length = 0;
  streetHandlers['street.claim'](ctx, guest, claim('P3', BOLT));
  streetHandlers['street.claim'](ctx, guest, claim('P2', { ...BOLT, planned: 12 }));
  assert.deepEqual(warned, ["🏙 Plot 3 is Acme's already", LOOK_ERRORS.planned]);
  assert.deepEqual(sent, []);
});

/** Friday One, down or in the air, at (x, h, z) facing `yaw`. */
function heliAt(x: number, h: number, z: number, landed: boolean, yaw = Math.PI): HeliState {
  const pose: HeliPose = { x, h, z, yaw, pitch: 0, roll: 0, spin: landed ? 0 : 1 };
  return { ...parkedHeli(), pose, landed, stage: landed ? 'parked' : 'flying', pad: null };
}

test('no plot is claimed with Friday One parked on it', (t) => {
  const { ctx, warned, join } = office(t);
  const tyler = join('tyler', { account: 'tyler' });
  t.mock.method(heliOf(ctx), 'state', () => heliAt(56, 0, 0, true));
  streetHandlers['street.claim'](ctx, tyler, claim('P3', ACME));
  assert.deepEqual(warned, ['🚁 Friday One is parked on Plot 3: it has to fly off first']);
  assert.equal(streetOf(ctx).onPlot('P3'), undefined);
  streetHandlers['street.claim'](ctx, tyler, claim('P2', ACME));
  assert.ok(streetOf(ctx).onPlot('P2'), 'one it isn\'t on is fine');
});

test('no plot is claimed while anyone, on any floor, stands where its walls would go', (t) => {
  const { ctx, warned, join } = office(t);
  const tyler = join('tyler', { account: 'tyler' });
  // Down on the street from the floor above Friday's: the same street.
  const ada = join('ada', { account: 'ada', floor: 'ai-innovators', x: 56, y: streetBelow(1) + 0.02, z: 54 });
  streetHandlers['street.claim'](ctx, tyler, claim('P7', ACME));
  assert.deepEqual(warned, ["🏙 Someone's standing on Plot 7: they have to step off first"]);
  // A step from where the hoarding would go still counts; a step more doesn't.
  const edge = claimedBox('P7').maxX;
  ada.peer.x = edge + STEP_OFF - 0.1;
  streetHandlers['street.claim'](ctx, tyler, claim('P7', ACME));
  assert.equal(warned.length, 2);
  ada.peer.x = edge + STEP_OFF + 0.1;
  streetHandlers['street.claim'](ctx, tyler, claim('P7', ACME));
  assert.equal(warned.length, 2);
  assert.ok(streetOf(ctx).onPlot('P7'));
  // Over the plot but not on the street (up on the roof, or on the 2D view) isn't standing on it.
  join('roof', { floor: '@roof', x: 56, y: 0, z: 0 });
  join('phone', { floor: 'friday-labs', x: 56, y: streetBelow(0), z: 0, lite: true });
  tyler.throttles.clear();
  streetHandlers['street.claim'](ctx, tyler, claim('P3', BOLT));
  assert.ok(streetOf(ctx).onPlot('P3'));
});

test('an edit that moves walls looks first, one that only repaints them does not', (t) => {
  const { ctx, sent, warned, join } = office(t);
  const tyler = join('tyler', { account: 'tyler' });
  streetHandlers['street.claim'](ctx, tyler, claim('P3', ACME));
  // Ada wandered in through the site's gate.
  const ada = join('ada', { floor: 'ai-innovators', x: 56, y: streetBelow(1), z: 2 });
  const edit = (look: Partial<PlotLook>, id = 'acme') => {
    tyler.throttles.clear();
    sent.length = 0;
    streetHandlers['street.edit'](ctx, tyler, { t: 'street.edit', plot: 'P3', id, ...look });
  };
  edit({ name: 'Acme Robotics', accent: '#3366ff', planned: 6 });
  assert.deepEqual(warned, []);
  assert.equal((sent[0] as { street: { cards: BusinessCard[] } }).street.cards[0].name, 'Acme Robotics');
  edit({ stage: 'shell' });
  assert.deepEqual(warned, ["🏙 Someone's standing on Plot 3: they have to step off first"]);
  assert.deepEqual(sent, []);
  ada.peer.z = 30;
  edit({ stage: 'shell' });
  assert.equal(streetOf(ctx).onPlot('P3')?.stage, 'shell');
  // Friday One hovering over the roof of a six-storey shell: it can't grow up round it, but it can grow under it.
  const hover = heliAt(56, 50, 0, false);
  t.mock.method(heliOf(ctx), 'state', () => hover);
  edit({ planned: 8 });
  assert.equal(warned.at(-1), "🚁 Friday One is in the way over Plot 3: wait till it's flown clear");
  hover.pose.h = shellTop(8) + 1;
  edit({ planned: 8 });
  assert.equal(streetOf(ctx).onPlot('P3')?.planned, 8);
  // From a window showing a business that's gone, nothing; nor anything said for an edit that changes nothing.
  edit({ planned: 2 }, 'someone-else');
  assert.equal(warned.at(-1), changedHands('P3'));
  const before = warned.length;
  edit({ planned: 8 });
  assert.deepEqual([sent, warned.length], [[], before]);
  edit({ planned: 0 });
  assert.equal(warned.at(-1), LOOK_ERRORS.planned);
});

test('a release gives the plot back, for everyone, and only the business the window showed', (t) => {
  const { ctx, sent, toasts, warned, join } = office(t);
  const tyler = join('tyler', { account: 'tyler' });
  streetHandlers['street.claim'](ctx, tyler, claim('P3', ACME));
  tyler.throttles.clear();
  streetHandlers['street.release'](ctx, tyler, { t: 'street.release', plot: 'P3', id: 'bolt' });
  assert.deepEqual(warned, [changedHands('P3')]);
  streetHandlers['street.release'](ctx, tyler, { t: 'street.release', plot: 'P3', id: 'acme' });
  assert.deepEqual(sent.at(-1), { t: 'street', street: { cards: [] } });
  assert.equal(toasts.at(-1), "🪧 Acme has left Plot 3: it's for lease again on Main Street");
  tyler.throttles.clear();
  streetHandlers['street.release'](ctx, tyler, { t: 'street.release', plot: 'P3' });
  assert.equal(warned.at(-1), '🏙 Plot 3 is for lease already');
});

test('an admin changes the street at most once every 300 ms', (t) => {
  const { ctx, sent, warned, join } = office(t);
  const tyler = join('tyler', { account: 'tyler' });
  streetHandlers['street.claim'](ctx, tyler, claim('P2', ACME));
  streetHandlers['street.claim'](ctx, tyler, claim('P3', BOLT));
  assert.deepEqual([sent.length, warned, streetOf(ctx).onPlot('P3')], [1, [], undefined]);
  tyler.throttles.set('street', Date.now() - 301);
  streetHandlers['street.claim'](ctx, tyler, claim('P3', BOLT));
  assert.ok(streetOf(ctx).onPlot('P3'));
});

test("walls wait for Friday One's whole footprint, its tail too, and for its body in the air", () => {
  const nobody = (heli: HeliState) => ({ heli, people: [] });
  const site = wallsOf('P3', 'site', 4);
  const front = claimedBox('P3').maxZ;
  assert.equal(whyNotClear('P3', site, nobody(parkedHeli())), undefined, 'on its pad in the park');
  // Parked on the sidewalk, nose to the street: its rotor reaches over the hoarding's line, or doesn't.
  assert.match(whyNotClear('P3', site, nobody(heliAt(56, 0, front + 3.8, true)))!, /parked on Plot 3/);
  assert.equal(whyNotClear('P3', site, nobody(heliAt(56, 0, front + 4.0, true))), undefined);
  // Nose out to the street (yaw 0), its tail swings back over the plot where the rotor doesn't reach.
  assert.match(whyNotClear('P3', site, nobody(heliAt(56, 0, front + 7.5, true, 0)))!, /parked on Plot 3/);
  // In the air: in the crane's jib, as it would sweep round, or low over the hoarding; clear above them.
  assert.match(whyNotClear('P3', site, nobody(heliAt(56, 32, 0, false)))!, /in the way over Plot 3/);
  assert.match(whyNotClear('P3', site, nobody(heliAt(56, 1, 0, false)))!, /in the way over Plot 3/);
  assert.equal(whyNotClear('P3', site, nobody(heliAt(56, 40, 0, false))), undefined);
  assert.equal(whyNotClear('P3', wallsOf('P3', 'shell', 1), nobody(heliAt(56, 20, 0, false))), undefined, 'over a one-storey shell');
});
