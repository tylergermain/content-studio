import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOOP, SWEET, idealSpeed, lookAtRim, shotSpeed, throwPitch, underCeiling } from '../src/shared/hoop.js';
import { DEFAULT_FURNITURE } from '../src/shared/furniture.js';
import { roomOf } from '../src/shared/floorplan.js';
import type { ServerMsg } from '../src/shared/protocol.js';
import { Court } from '../src/server/court.js';
import { hoopServices } from '../src/server/hoop.js';
import { ballHandlers } from '../src/server/ws/handlers/ball.js';
import { hoopHandlers, hoopView } from '../src/server/ws/handlers/hoop.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import type { Floor } from '../src/server/floor.js';

// A throw at the hoop through the office's own message handlers: the court takes it, the office flies
// it, and a make goes on the longest shots as it drops through the net, from where the thrower stood.

const folder = (t: TestContext) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-hoop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function office(t: TestContext, furniture = DEFAULT_FURNITURE) {
  const floor = { id: 'f', court: new Court(), plan: { layoutNow: () => ({ furniture, room: roomOf(undefined) }), wing: 0 } } as unknown as Floor;
  const out: { to: string; msg: ServerMsg }[] = [];
  const clients = new Map<string, Client>();
  const ctx = {
    clients,
    floors: new Map([['f', floor]]),
    floorOf: (c: Client) => (c.peer.floor === 'f' ? floor : undefined),
    sendTo: (c: Client, msg: ServerMsg) => out.push({ to: c.id, msg }),
    toFloor: (_f: Floor, msg: ServerMsg) => out.push({ to: 'floor', msg }),
    toastFloor: (_f: Floor | undefined, text: string) => out.push({ to: 'floor', msg: { t: 'toast', text, level: 'info' } }),
    broadcast: (msg: ServerMsg) => out.push({ to: 'all', msg }),
    warn: (c: Client, text: string | undefined) => text && out.push({ to: c.id, msg: { t: 'toast', text, level: 'warn' } }),
  } as unknown as Ctx;
  Object.assign(ctx, hoopServices(ctx, folder(t)));
  t.after(() => ctx.pig.dispose());
  /** Someone on the floor, standing `d` m straight out from the rim. */
  const person = (id: string, name: string, d: number) => {
    const c = { id, accountId: undefined, throttles: new Map<string, number>(), peer: { id, name, color: '#ef476f', floor: 'f', x: HOOP.rim.x + d, y: 0, z: HOOP.z } } as unknown as Client;
    clients.set(id, c);
    return c;
  };
  return { ctx, floor, out, person };
}

/** The throw someone standing `d` m out makes, letting go at `power` (from 0.3 m in front of them, at their eyes). */
function throwFrom(d: number, power = SWEET.at) {
  const from = { x: HOOP.rim.x + d - 0.3, y: 1.4, z: HOOP.z };
  const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
  const v = shotSpeed(idealSpeed(from, pitch)!, power);
  return { t: 'ball.throw' as const, ...from, vx: -v * Math.cos(pitch), vy: v * Math.sin(pitch), vz: 0 };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a make goes on the longest shots once it drops in, measured from where they stood, and a new record tells the floor', async (t) => {
  const { ctx, floor, out, person } = office(t);
  const ada = person('a1', 'Ada', 7);
  ballHandlers['ball.take'](ctx, ada, { t: 'ball.take' });
  ballHandlers['ball.throw'](ctx, ada, throwFrom(7));
  assert.equal(floor.court.state().shot?.by, 'a1');
  assert.equal(ctx.longShots.board().shots.length, 0, 'not before it goes in');
  await settle(1800);
  assert.deepEqual(
    ctx.longShots.board().shots.map((s) => [s.name, s.dist]),
    [['Ada', 6.7]],
  );
  const board = out.find((o) => o.msg.t === 'hoop.board')!.msg as Extract<ServerMsg, { t: 'hoop.board' }>;
  assert.deepEqual(board.latest, { name: 'Ada', dist: 6.7, rank: 1, first: true });
  assert.ok(out.some((o) => o.to === 'floor' && o.msg.t === 'toast' && o.msg.text === '🏀 Ada sank one from 6.7 m — a new record!'));
  assert.deepEqual(hoopView(ctx, floor).board, ctx.longShots.board());
});

test("a miss, a throw from somewhere they aren't standing, or a floor without the hoop puts nothing on the table", async (t) => {
  const { ctx, person } = office(t);
  const bo = person('b1', 'Bo', 5);
  ballHandlers['ball.take'](ctx, bo, { t: 'ball.take' });
  ballHandlers['ball.throw'](ctx, bo, throwFrom(5, 1));
  await settle(400);
  // Claims a throw from 12 m out while standing at 5.
  ballHandlers['ball.take'](ctx, bo, { t: 'ball.take' });
  ballHandlers['ball.throw'](ctx, bo, throwFrom(12));
  const bare = office(t, DEFAULT_FURNITURE.filter((p) => p.kind !== 'hoop'));
  const cy = bare.person('c1', 'Cy', 4);
  ballHandlers['ball.take'](bare.ctx, cy, { t: 'ball.take' });
  ballHandlers['ball.throw'](bare.ctx, cy, throwFrom(4));
  await settle(2500);
  assert.deepEqual(ctx.longShots.board().shots, []);
  assert.deepEqual(bare.ctx.longShots.board().shots, []);
});

test('two people play PIG through the messages: out of turn is refused, and the ball goes to whoever is up', async (t) => {
  const { ctx, floor, out, person } = office(t);
  const tyler = person('t1', 'Tyler', 4);
  const gavin = person('g1', 'Gavin', 5);
  hoopHandlers['pig.invite'](ctx, tyler, { t: 'pig.invite', to: 'g1' });
  assert.ok(out.some((o) => o.to === 'g1' && o.msg.t === 'pig.invited' && o.msg.name === 'Tyler'));
  hoopHandlers['pig.answer'](ctx, gavin, { t: 'pig.answer', from: 't1', yes: true });
  assert.equal(ctx.pig.game('f')?.turn, 0);
  assert.deepEqual(floor.court.state(), { holder: 't1', for: 't1' });
  // Gavin can't pick it up, or throw it.
  ballHandlers['ball.take'](ctx, gavin, { t: 'ball.take' });
  assert.equal(floor.court.state().holder, 't1');
  // Tyler sinks one from 4 m.
  ballHandlers['ball.throw'](ctx, tyler, throwFrom(4));
  assert.equal(ctx.pig.game('f')?.inAir, true);
  await settle(1000 + 1400);
  const g = ctx.pig.game('f')!;
  assert.equal(g.turn, 1);
  assert.ok(g.spot && Math.abs(g.spot.dist - 4) < 0.15, `the spot is where Tyler stood (${g.spot?.dist})`);
  assert.deepEqual(floor.court.state(), { holder: 'g1', for: 'g1' });
  // From the wrong spot, Gavin's throw is refused and the ball stays in his hands.
  ballHandlers['ball.throw'](ctx, gavin, throwFrom(5));
  assert.ok(out.some((o) => o.to === 'g1' && o.msg.t === 'toast' && /from the ring/.test(o.msg.text)));
  assert.equal(floor.court.state().holder, 'g1');
  hoopHandlers['pig.quit'](ctx, gavin, { t: 'pig.quit' });
  assert.equal(ctx.pig.game('f')?.winner, 0);
  assert.deepEqual(ctx.longShots.board().wins.map((w) => [w.name, w.wins]), [['Tyler', 1]]);
});
