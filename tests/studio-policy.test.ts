import test from 'node:test';
import assert from 'node:assert/strict';
import { agentProviders } from '../src/server/agents.js';
import { localPiModel, studioChoiceError } from '../src/shared/studio-policy.js';
import { studioPermissionArgs } from '../src/server/providers/studio-launch.js';
import { piArgs } from '../src/server/pi.js';

test('only the three studio engines can be selected', () => {
  for (const configured of ['claude', 'custom', 'opencode'] as const) assert.deepEqual(agentProviders(configured), ['claude', 'codex', 'pi']);
  assert.ok(studioChoiceError('opencode'));
  assert.ok(studioChoiceError('custom'));
  assert.equal(studioChoiceError('codex'), undefined);
});
test('Pi always resolves to local models and rejects cloud choices', () => {
  assert.equal(localPiModel(), 'studio-local/qwen3.8-flash-next');
  assert.equal(localPiModel('glm-5.3-flash'), 'studio-local/glm-5.3-flash');
  assert.equal(localPiModel('studio-local/deepseek-v4.1-flash'), 'studio-local/deepseek-v4.1-flash');
  assert.throws(() => localPiModel('anthropic/claude-sonnet-4'), /only supports/);
  const args = piArgs(studioPermissionArgs('pi', ['--provider', 'anthropic', '--model', 'sonnet', '--no-approve']), { extension: '/ext', sessionDir: '/sessions', model: localPiModel(), sessionId: 'resumed' });
  assert.ok(args.includes('--approve'));
  assert.ok(!args.includes('anthropic'));
  assert.ok(!args.includes('--no-approve'));
  assert.ok(args.includes('studio-local/qwen3.8-flash-next'));
});
test('permission defaults replace conflicting modes while preserving unrelated options', () => {
  assert.deepEqual(studioPermissionArgs('claude', ['--permission-mode', 'plan', '--verbose']), ['--verbose', '--dangerously-skip-permissions']);
  assert.deepEqual(studioPermissionArgs('codex', ['--yolo', '--sandbox=read-only', '-a', 'always', '--no-alt-screen']), ['--no-alt-screen', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust']);
  assert.deepEqual(studioPermissionArgs('pi', ['-na', '--thinking', 'high']), ['--thinking', 'high', '--approve']);
});
