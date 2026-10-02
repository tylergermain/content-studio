import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PROVIDERS, type AgentProvider } from '../src/shared/providers.js';
import { STUDIO_PROVIDERS } from '../src/shared/studio-policy.js';
import type { WorkerStatus } from '../src/shared/protocol.js';
import { DEFAULT_TOPPER, TOPPERS, topperFor, topperLife, turnTopper } from '../src/client/world/toppers.js';

// The table of what each provider's workers wear on their antennas (world/toppers.ts), and how an emblem
// moves. tests/toppers-model.test.ts holds toppers.glb to the same table.

const STATUSES: WorkerStatus[] = ['starting', 'idle', 'working', 'needs_input', 'done', 'exited', 'offline'];
const HEX = /^#[0-9a-f]{6}$/;

test('every provider has an emblem, and one with no row, or no provider at all, wears the plain one', () => {
  for (const provider of AGENT_PROVIDERS) {
    const t = topperFor(provider);
    assert.match(t.part, /^topper_[a-z_]+$/, `${provider} wears ${t.part}`);
    assert.equal(t, TOPPERS[provider] ?? DEFAULT_TOPPER);
  }
  assert.equal(topperFor(undefined), DEFAULT_TOPPER);
  // A provider this build has never heard of (a newer server's), and names an object has anyway.
  for (const stray of ['gemini', 'constructor', 'toString', '__proto__', '']) assert.equal(topperFor(stray as AgentProvider), DEFAULT_TOPPER, `"${stray}" wears the plain one`);
});

test('the three this office hires each have a row of their own', () => {
  for (const provider of STUDIO_PROVIDERS) {
    assert.ok(TOPPERS[provider], `${provider} has a row`);
    assert.notEqual(topperFor(provider), DEFAULT_TOPPER);
  }
});

test('you can tell them apart: no two rows share a part or a main color, and none is the plain one\'s', () => {
  const rows = [DEFAULT_TOPPER, ...Object.values(TOPPERS)];
  assert.equal(new Set(rows.map((t) => t.part)).size, rows.length, 'each wears its own part');
  assert.equal(new Set(rows.map((t) => t.colors.Main.toLowerCase())).size, rows.length, 'each has its own main color');
  for (const t of rows) {
    assert.match(t.colors.Main, HEX, `${t.part}'s main color`);
    assert.match(t.colors.Accent, HEX, `${t.part}'s accent`);
    assert.ok((t.spin ?? 1) >= 0 && (t.size ?? 1) > 0, `${t.part} turns forward and has a size`);
  }
});

test('an emblem spins and beats while its worker works, turns slowly while it is about, and is still once it is asleep', () => {
  const busy = topperLife('working');
  for (const status of STATUSES) {
    const life = topperLife(status);
    assert.ok(life.turn >= 0 && life.bob >= 0 && life.pulse >= 0, `${status} has a life`);
    if (status !== 'working') assert.ok(life.turn < busy.turn / 2 && life.pulse === 0, `${status} is calmer than working`);
  }
  assert.ok(busy.pulse > 0, 'it beats while it works');
  for (const status of ['starting', 'idle', 'needs_input', 'done'] as const) assert.ok(topperLife(status).turn > 0 && topperLife(status).bob > 0, `${status} turns and bobs`);
  for (const status of ['exited', 'offline'] as const) assert.deepEqual(topperLife(status), { turn: 0, bob: 0, pulse: 0 }, `${status} is still`);
});

test('it eases up to its speed, keeps its angle inside one turn, and turns as its row says', () => {
  const s = { angle: 0, speed: 0 };
  const busy = topperLife('working');
  turnTopper(s, busy, 1, 1 / 60);
  assert.ok(s.speed > 0 && s.speed < busy.turn / 2, `it doesn't start at full speed (${s.speed})`);
  for (let i = 0; i < 600; i++) {
    turnTopper(s, busy, 1, 1 / 60);
    assert.ok(s.angle >= 0 && s.angle < Math.PI * 2, `its angle stays inside one turn (${s.angle})`);
  }
  assert.ok(Math.abs(s.speed - busy.turn) < 0.01, `it gets up to speed (${s.speed})`);
  // A row's own spin: twice as fast, or not turning at all.
  const twice = { angle: 0, speed: 0 };
  const never = { angle: 0, speed: 0 };
  for (let i = 0; i < 600; i++) {
    turnTopper(twice, busy, 2, 1 / 60);
    turnTopper(never, busy, 0, 1 / 60);
  }
  assert.ok(Math.abs(twice.speed - busy.turn * 2) < 0.02);
  assert.deepEqual(never, { angle: 0, speed: 0 });
});

test('once its worker is asleep it comes round to face forward, the short way, and stops', () => {
  for (const from of [0.4, 2.9, 3.4, 6.0]) {
    const s = { angle: from, speed: topperLife('idle').turn };
    const still = topperLife('offline');
    let turned = 0;
    for (let i = 0; i < 900; i++) {
      const before = s.angle;
      turnTopper(s, still, 1, 1 / 60);
      // How far it went this frame, the short way round.
      turned += Math.abs(((s.angle - before + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    }
    const off = Math.min(s.angle, Math.PI * 2 - s.angle);
    assert.ok(off < 0.01, `from ${from} it ends facing forward (${s.angle})`);
    assert.ok(s.speed < 0.01, `from ${from} it stops (${s.speed})`);
    assert.ok(turned < Math.PI + 0.6, `from ${from} it goes the short way (${turned.toFixed(2)} rad)`);
  }
});
