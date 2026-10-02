import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorize, callback, configure, disconnect, load } from '../src/server/spotify/account.js';

test('Spotify PKCE uses short-lived single-use state and owner-only configuration', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spotify-test-'));
  try {
    assert.throws(() => configure(dir, 'a'.repeat(32), 'http://localhost:14600/api/spotify/callback'));
    configure(dir, 'a'.repeat(32), 'http://127.0.0.1:14600/api/spotify/callback');
    assert.equal(statSync(path.join(dir, 'spotify.json')).mode & 0o777, 0o600);
    const first = new URL(authorize(dir)), second = new URL(authorize(dir));
    assert.equal(first.searchParams.get('code_challenge_method'), 'S256');
    assert.notEqual(first.searchParams.get('state'), second.searchParams.get('state'));
    assert.equal(first.searchParams.has('code_verifier'), false);
    await assert.rejects(callback(dir, 'invalid', 'code'));
    const state = first.searchParams.get('state')!;
    await assert.rejects(callback(dir, state, ''));
    await assert.rejects(callback(dir, state, 'code'));
    disconnect(dir); assert.equal(load(dir).refresh, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
