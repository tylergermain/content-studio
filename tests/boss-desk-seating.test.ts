import test from 'node:test';
import assert from 'node:assert/strict';
import { SEATING_BY_ID, seatPlace, type SeatPlace } from '../src/shared/layout.js';

// The boss's desk where it meets the rest of the office: what sitting down (features/seating) makes of
// a seat the desk has a say in, and a share that's handed its picture instead of asking the browser
// for one (Voice.startShare, which the desk feeds the game on the boss's monitor through).

// The store keeps things in localStorage, and the hint bar's pieces are made on a page: stand both in.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});
class El {
  className = '';
  readonly kids: (El | string)[] = [];
  append(...kids: (El | string)[]) {
    this.kids.push(...kids);
  }
  setAttribute() {}
  addEventListener() {}
  get text(): string {
    return this.kids.map((k) => (typeof k === 'string' ? k : k.text)).join(' ');
  }
}
Object.assign(globalThis, { Node: El, document: { createElement: () => new El() } });

const { installSeating } = await import('../src/client/features/seating/index.js');
const { Voice } = await import('../src/client/voice.js');
const { deskSeat } = await import('../src/client/features/boss-desk/desk.js');

type Desk = { note: string; use?: { label: string; run(): void } } | null;
type Seat = { hint(it: object): { k: string; parts: (El | string)[] }; use(it: object, key: string): void };

/** Sitting down as the office has it, with a player who's wherever they're put and a desk that says `desk`. */
function seating(desk: (seatId: string) => Desk) {
  const sent: { t: string; seat?: string }[] = [];
  const player = {
    seat: null as SeatPlace | null,
    pos: { x: 14, y: 3, z: 12 },
    onStand: null as (() => void) | null,
    sit(place: SeatPlace) {
      this.seat = place;
    },
    stand() {
      this.seat = null;
    },
  };
  let seat!: Seat;
  const ctx = {
    player,
    me: { sit() {} },
    net: { send: (m: { t: string; seat?: string }) => void sent.push(m) },
    plan: () => ({ seatingById: SEATING_BY_ID }),
    messages: { on() {} },
    interactions: { define: (_kind: string, def: Seat) => void (seat = def) },
  };
  const deps = { shares: () => [], watchShare() {}, desk, showBar() {}, usable: () => [[]] };
  installSeating(ctx as never, deps as never);
  const it = (seatId: string) => ({ kind: 'seat', x: 0, z: 0, radius: 1, seatId });
  const words = (seatId: string) => seat.hint(it(seatId)).parts.map((p) => (typeof p === 'string' ? p : p.text)).join(' ');
  return { player, sent, it, words, hint: (seatId: string) => seat.hint(it(seatId)), use: (seatId: string) => seat.use(it(seatId), 'E') };
}

const place = (id: string) => seatPlace(SEATING_BY_ID.get(id)!, 0);

test('a seat at the desk says what the desk says of it, standing and sitting', () => {
  let label = 'Call with Tyler';
  const s = seating((id) => (id === 'boss-chair' ? { note: '👑 share your screen or play a game', use: { label: 'Desk menu', run() {} } } : deskSeat(id) ? { note: 'across from Tyler', use: { label, run() {} } } : null));
  assert.match(s.words('boss-chair'), /share your screen or play a game/);
  assert.match(s.words('boss-chair'), /Sit down/);
  assert.match(s.words('boss-guest-1'), /across from Tyler/);
  // Any other seat is as it was.
  assert.doesNotMatch(s.words('loft-couch'), /across from|share your screen/);

  s.use('boss-guest-1');
  assert.equal(s.player.seat?.key, 'boss-guest-1:0');
  assert.deepEqual(s.sent, [{ t: 'sit', seat: 'boss-guest-1:0' }]);
  assert.match(s.words('boss-guest-1'), /sitting.*E.*Call with Tyler.*Get up/);
  // The hint is drawn again when what E does there changes (the boss's screen went live).
  const before = s.hint('boss-guest-1').k;
  label = "Watch Tyler's screen";
  assert.notEqual(s.hint('boss-guest-1').k, before);
  assert.match(s.words('boss-guest-1'), /Watch Tyler's screen/);
});

test("sitting at the desk, E does what the desk says; with nothing to do there, it gets you up", () => {
  let ran = 0;
  let bossIn = true;
  const s = seating((id) => (id === 'boss-chair' ? { note: 'n', use: { label: 'Desk menu', run: () => void ran++ } } : deskSeat(id) ? { note: 'n', use: bossIn ? { label: 'Call', run: () => void ran++ } : undefined } : null));
  s.use('boss-chair');
  assert.equal(s.player.seat?.key, 'boss-chair:0');
  s.use('boss-chair');
  assert.equal(ran, 1);
  assert.equal(s.player.seat?.key, 'boss-chair:0', 'still sitting: E opened the menu');

  s.player.sit(place('boss-guest-2'));
  s.use('boss-guest-2');
  assert.equal(ran, 2);
  // Nobody in the boss's chair: a guest's chair is a chair.
  bossIn = false;
  assert.match(s.words('boss-guest-2'), /E Get up/);
  s.use('boss-guest-2');
  assert.equal(ran, 2);
  assert.equal(s.player.seat, null);
  assert.deepEqual(s.sent.at(-1), { t: 'sit' });
});

test('sitting at the desk and looking at another chair there, E stays about your own', () => {
  let ran = 0;
  const s = seating((id) => (deskSeat(id) ? { note: 'n', use: { label: id === 'boss-chair' ? 'Desk menu' : 'Call with Tyler', run: () => void ran++ } } : null));
  // A guest, looking across at the boss (whose chair is the nearest thing under the crosshair).
  s.player.sit(place('boss-guest-1'));
  assert.match(s.words('boss-chair'), /Guest chair.*sitting.*Call with Tyler/);
  s.use('boss-chair');
  assert.equal(ran, 1);
  assert.equal(s.player.seat?.key, 'boss-guest-1:0', 'not moved to the chair they were looking at');
  // Any seat that isn't the desk's is still somewhere to move to.
  assert.match(s.words('loft-couch'), /Sit down/);
  // And from a seat that isn't the desk's, a desk chair is one too.
  s.player.sit(place('loft-couch'));
  assert.match(s.words('boss-guest-2'), /Guest chair.*Sit down/);
});

test('a share handed its picture is up at once, goes to everyone connected, and stops like any other', async () => {
  const sent: { t: string; sharing?: boolean }[] = [];
  // Voice samples its levels on a timer of its own, which would keep the test from ending.
  const every = globalThis.setInterval;
  globalThis.setInterval = (() => 0) as never;
  const voice = new Voice({ send: (m: { t: string }) => void sent.push(m) } as never);
  globalThis.setInterval = every;

  const stream = (name: string) => {
    const heard = new Map<string, () => void>();
    const track = { name, contentHint: '', stopped: false, addEventListener: (type: string, fn: () => void) => void heard.set(type, fn), stop: () => void (track.stopped = true) };
    return { track, end: () => heard.get('ended')?.(), getVideoTracks: () => [track], getTracks: () => [track] };
  };
  const added: unknown[] = [];
  const removed: unknown[] = [];
  voice.conns.set('peer', { pc: { addTrack: (t: unknown) => (added.push(t), { sender: t }), removeTrack: (s: unknown) => void removed.push(s) } } as never);

  const game = stream('game');
  const asked = voice.startShare(game as never);
  // Nothing was awaited: it's up by the time the call returns (the desk goes by that).
  assert.equal(voice.sharing, true);
  assert.equal(voice.localScreen, game);
  assert.deepEqual(added, [game.track]);
  assert.equal(game.track.contentHint, 'detail');
  assert.deepEqual(sent.at(-1), { t: 'voice', voice: false, muted: false, sharing: true });
  assert.equal(await asked, null);

  // One share at a time: a second one is turned away, and its picture isn't taken.
  const other = stream('other');
  assert.equal(await voice.startShare(other as never), null);
  assert.equal(voice.localScreen, game);
  assert.equal(other.track.stopped, false);

  voice.stopShare();
  assert.equal(voice.sharing, false);
  assert.equal(game.track.stopped, true);
  assert.deepEqual(removed, [{ sender: game.track }]);
  assert.deepEqual(sent.at(-1), { t: 'voice', voice: false, muted: false, sharing: false });

  // The picture ending by itself takes the share down too.
  void voice.startShare(other as never);
  assert.equal(voice.sharing, true);
  other.end();
  assert.equal(voice.sharing, false);
});
