import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFilter, agentMatches, agentOrder, type AgentRow } from '../src/shared/agents.js';

// The Agents panel (shared/agents.ts): which agents each filter shows, the order they're listed in, and the search.

const agent = (o: Partial<AgentRow>): AgentRow => ({ id: 'w', kind: 'agent', name: 'Pixel', status: 'idle', deskId: 'd1', color: 0, acked: true, createdBy: 'Tyler', createdAt: 1, viewers: 0, viewerIds: [], floor: 'studio', floorName: 'Studio', canControl: true, apps: [], ...o }) as AgentRow;

test('each filter shows its agents: needs you is a question or a finished task, asleep is offline or exited', () => {
  assert.ok(agentFilter(agent({ status: 'needs_input' }), 'needs'));
  assert.ok(agentFilter(agent({ status: 'done' }), 'needs'));
  assert.ok(agentFilter(agent({ status: 'starting' }), 'working'));
  assert.ok(agentFilter(agent({ status: 'idle' }), 'ready'));
  assert.ok(agentFilter(agent({ status: 'offline' }), 'asleep') && agentFilter(agent({ status: 'exited' }), 'asleep'));
  assert.ok(!agentFilter(agent({ status: 'working' }), 'needs'));
  assert.ok(agentFilter(agent({ status: 'working' }), 'all'));
});

test('the ones that need you come first, the longest waiting first, then working, ready and asleep', () => {
  const list = [
    agent({ name: 'Asleep', status: 'offline' }),
    agent({ name: 'Ready', status: 'idle' }),
    agent({ name: 'Newer ask', status: 'needs_input', waitingSince: 200 }),
    agent({ name: 'Busy', status: 'working' }),
    agent({ name: 'Older ask', status: 'needs_input', waitingSince: 100 }),
    agent({ name: 'Finished', status: 'done' }),
  ].sort(agentOrder);
  assert.deepEqual(list.map((a) => a.name), ['Older ask', 'Newer ask', 'Finished', 'Busy', 'Ready', 'Asleep']);
});

test('a search matches every word in the name, floor, task, model or branch', () => {
  const a = agent({ name: 'Ada', floorName: 'Kenna Platform', task: { name: 'Landing page', summary: 'Build the hero' }, provider: 'codex', worktree: { path: '/x', branch: 'feat/hero', base: 'main' } });
  assert.ok(agentMatches(a, 'kenna landing'));
  assert.ok(agentMatches(a, 'HERO codex'));
  assert.ok(!agentMatches(a, 'kenna pricing'));
});

test('the assistant reads Codex plan usage from a token_count event, and names what it ran', async () => {
  const { codexPlan } = await import('../src/server/assistant/codex-limits.js');
  const { stepOf } = await import('../src/server/assistant/runner.js');
  const plan = codexPlan({ primary: { used_percent: 18, window_minutes: 10080, resets_at: 1_791_592_389 }, secondary: { used_percent: 40.5, window_minutes: 300 }, credits: { has_credits: true, unlimited: false, balance: '53288.67' }, plan_type: 'pro' }, 5);
  assert.deepEqual(plan, { provider: 'codex', plan: 'pro', windows: [{ label: '5 hours', pct: 40.5 }, { label: 'week', pct: 18, resetsAt: 1_791_592_389_000 }], credits: '53289', at: 5 });
  assert.equal(codexPlan({ primary: null, secondary: null }, 1), undefined);
  assert.equal(stepOf("/bin/zsh -lc 'office home Byte --force --why \"done\"'"), 'office home Byte');
  assert.equal(stepOf('bash -lc "office agents"'), 'office agents');
  assert.equal(stepOf('office agent "Pixel"'), 'office agent Pixel');
});
