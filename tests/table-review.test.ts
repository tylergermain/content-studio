import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tableReviewRoute } from '../src/server/http/routes/table-review.js';
import { cleanFurniture, type Piece } from '../src/shared/furniture.js';
import { FACTORY_ROOM, softwareFactory } from '../src/shared/software-factory.js';
import { seatingOf } from '../src/shared/table-seats.js';

// A project table's Software review (http/routes/table-review.ts): comments sent from it go to a new agent hired at
// the table's first free chair, in a worktree of its repository, and "Start the app" hires one to run it.

function office(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-table-review-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const furniture = cleanFurniture(softwareFactory(['Spiel'])) as Piece[];
  const spiel = furniture.find((p) => p.kind === 'project-room' && p.text === 'Spiel')!;
  spiel.project = { dir: '/Users/a/spiel', repo: 'acme/spiel', git: true };
  const hires: { seat: string; by: string; task: string; worktree: boolean; owner?: string }[] = [];
  const toasts: string[] = [];
  let policy: string | undefined;
  const floor = {
    id: 'f1',
    dir,
    plan: { state: () => ({ furniture, room: FACTORY_ROOM }), seating: () => seatingOf({ furniture, room: FACTORY_ROOM }) },
    workers: {
      list: () => hires.map((h, i) => ({ id: `w${i}`, name: `Agent ${i}`, status: 'working', deskId: h.seat })),
      hiringPolicy: () => policy,
      fetchRoom: async () => {},
      spawn: (seat: string, by: string, task: string, worktree: boolean, _kind: string, _p: unknown, _m: unknown, _e: unknown, _meeting: unknown, owner?: string) => {
        hires.push({ seat, by, task, worktree, owner });
        return { id: `w${hires.length - 1}`, name: `Agent ${hires.length - 1}` };
      },
    },
  };
  const ctx = { cfg: { trustProxy: false }, floors: new Map([['f1', floor]]), toastFloor: (_f: unknown, text: string) => toasts.push(text) } as never;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://office');
    void tableReviewRoute.handle(ctx, { req, res, url, path: url.pathname, session: { account: { id: 'acct', name: 'Tyler' } } } as never);
  });
  return { spiel, hires, toasts, server, deny: (why?: string) => (policy = why) };
}

async function call(server: http.Server, action: string, room: string, body?: unknown) {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/table-review/${action}?floor=f1&room=${room}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

const note = { text: 'Make the button bigger', page: '/', what: 'the Start button', selector: 'button.start' };

test("comments sent from a table's review go to a new agent at the table, in a worktree of its repository", async (t) => {
  const o = office(t);
  const sent = await call(o.server, 'notes', o.spiel.id, { requestId: 'r1', app: 'http://localhost:3011', size: { w: 1440, h: 900, label: 'Desktop' }, notes: [note] });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(o.hires.length, 1);
  assert.equal(o.hires[0].worktree, true);
  assert.equal(o.hires[0].owner, 'acct');
  assert.match(o.hires[0].seat, /^seat-\d+$/);
  assert.ok(o.hires[0].task.includes('Make the button bigger') && o.hires[0].task.includes('You are new at this table'), o.hires[0].task);
  const state = sent.body.state as { rounds: { to?: string }[]; comments: unknown[] };
  assert.equal(state.rounds[0].to, 'Agent 0');
  assert.equal(state.comments.length, 1);
  assert.match(o.toasts[0], /put Agent 0 to work at Spiel/);
  // It's kept, and read back for anyone signed in.
  const read = await call(o.server, 'state', o.spiel.id);
  assert.equal((read.body.state as { comments: unknown[] }).comments.length, 1);
});

test("a table with no app hires an agent to start it, a retried send hires nobody twice, and the floor's hiring rules apply", async (t) => {
  const o = office(t);
  const start = await call(o.server, 'start', o.spiel.id, { requestId: 'start-1' });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.match(o.hires[0].task, /Get Spiel's app running/);
  const again = await call(o.server, 'start', o.spiel.id, { requestId: 'start-1' });
  assert.equal(again.status, 409);
  assert.equal(o.hires.length, 1);
  o.deny('Employees may hire only specialists below them');
  const denied = await call(o.server, 'notes', o.spiel.id, { requestId: 'r2', app: 'http://localhost:3011', size: { w: 390, h: 844 }, notes: [note] });
  assert.equal(denied.status, 409);
  assert.match(String(denied.body.error), /Employees/);
  assert.equal((await call(o.server, 'state', 'nope')).status, 404);
});
