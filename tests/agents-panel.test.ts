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
