import test from 'node:test';
import assert from 'node:assert/strict';
import { roomApp } from '../src/server/room-screens.js';
import { ROOM_MEDIA, cleanFurniture, type Piece } from '../src/shared/furniture.js';
import { softwareFactory } from '../src/shared/software-factory.js';

// A project room's TV (server/room-screens.ts): the app it shows is the newest web server of a worker in the room,
// else the room's own app address.

const room = (id: string, url?: string): Piece => ({ id, kind: 'project-room', x: 0, z: 0, rotY: 0, w: 6, d: 6, text: id, ...(url ? { project: { url } } : {}) });

function stubs(services: { port: number; workerId: string; since: number }[], workers: Record<string, string>, furniture: Piece[]) {
  const ctx = { services: { list: () => services } } as never;
  const floor = { workers: { get: (id: string) => (workers[id] ? { project: { room: workers[id] } } : undefined) }, plan: { state: () => ({ furniture }) } } as never;
  return { ctx, floor };
}

test("a room's TV shows the newest app a worker in the room runs, else the room's own address, else nothing", () => {
  const furniture = [room('spiel', 'http://localhost:3000/'), room('dojo')];
  const { ctx, floor } = stubs([{ port: 5173, workerId: 'w1', since: 1 }, { port: 5174, workerId: 'w1', since: 2 }, { port: 8080, workerId: 'w2', since: 3 }], { w1: 'spiel', w2: 'elsewhere' }, furniture);
  assert.equal(roomApp(ctx, floor, 'spiel'), 'http://127.0.0.1:5174/');
  const none = stubs([], {}, furniture);
  assert.equal(roomApp(none.ctx, none.floor, 'spiel'), 'http://localhost:3000/');
  assert.equal(roomApp(none.ctx, none.floor, 'dojo'), undefined);
});

test("the Software Factory's rooms each have a TV set to show their app, and a screen keeps that setting", () => {
  const tvs = softwareFactory().filter((p) => p.kind === 'wall-screen');
  assert.equal(tvs.length, 7);
  assert.ok(tvs.every((p) => p.media === ROOM_MEDIA));
  const kept = cleanFurniture([{ id: 'tv', kind: 'wall-screen', x: 0, z: 0, rotY: 0, media: ROOM_MEDIA }, { id: 'bad', kind: 'wall-screen', x: 3, z: 0, rotY: 0, media: '@nope' }]) as Piece[];
  assert.equal(kept[0].media, ROOM_MEDIA);
  assert.equal(kept[1].media, undefined);
});
