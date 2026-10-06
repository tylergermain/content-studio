import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jevPick, typesafeKey } from '../src/server/review-queue/jev.js';
import { candidateApps, fallbackApp, turnOf } from '../src/server/review-queue/service.js';
import { ReviewStore } from '../src/server/review-queue/store.js';
import type { ReviewItem } from '../src/shared/review-queue.js';
import type { ChatArtifact, ChatMessage } from '../src/shared/worker-chat.js';
import { WORKSPACE_TABS } from '../src/shared/workspace.js';

// The review queue (server/review-queue/): each agent's finished task, the app it's shown in, and what became of it.

function tmp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-review-queue-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const item = (over: Partial<ReviewItem> = {}): Omit<ReviewItem, 'id' | 'state' | 'at' | 'updatedAt'> => ({
  floor: 'f1', floorName: 'Content Factory', workerId: 'w1', workerName: 'Pixel', task: 'Cut the teaser', files: [], app: 'files', by: 'files', ...over,
});

test('a worker finishing again while its item waits brings that one up to date; once decided, the next is a new one', (t) => {
  const dir = tmp(t);
  const store = new ReviewStore(dir);
  const a = store.add(item({ said: 'First cut' }), 1000);
  const b = store.add(item({ said: 'Second cut', app: 'watch' }), 2000);
  assert.equal(a.id, b.id);
  assert.equal(store.list().length, 1);
  assert.equal(b.said, 'Second cut');
  assert.equal(b.at, 1000);
  assert.equal(b.updatedAt, 2000);
  store.decide(a.id, 'approved', 'Tyler', 3000);
  const c = store.add(item({ said: 'Third' }), 4000);
  assert.notEqual(c.id, a.id);
  // It's kept on disk, and comes back as it was.
  const again = new ReviewStore(dir);
  assert.deepEqual(again.list().map((i) => [i.state, i.said]).sort(), [['approved', 'Second cut'], ['waiting', 'Third']]);
  assert.equal(again.get(a.id)?.decidedBy, 'Tyler');
  // Put back, it's waiting again, with nothing said about who decided.
  again.decide(a.id, 'waiting', 'Tyler');
  assert.equal(again.get(a.id)?.decidedAt, undefined);
});

test("a worker that goes home takes its waiting item off the queue, and a broken file is an empty queue", (t) => {
  const dir = tmp(t);
  const store = new ReviewStore(dir);
  const a = store.add(item());
  store.add(item({ workerId: 'w2', workerName: 'Cody' }));
  store.workerGone('f1', 'w1');
  assert.equal(store.get(a.id)?.state, 'dismissed');
  assert.equal(store.get(a.id)?.decidedBy, 'Went home');
  assert.equal(store.list().filter((i) => i.state === 'waiting').length, 1);
  writeFileSync(path.join(dir, 'review-queue.json'), '{ not json');
  assert.deepEqual(new ReviewStore(dir).list(), []);
  // Nor is an item that isn't one kept.
  writeFileSync(path.join(dir, 'review-queue.json'), JSON.stringify({ items: [{ id: 'x', workerId: 'w', floor: 'f', state: 'waiting', app: 'nope', files: [] }, { ...item(), id: 'ok', state: 'waiting', at: 1, updatedAt: 1 }] }));
  assert.deepEqual(new ReviewStore(dir).list().map((i) => i.id), ['ok']);
});

test("an item's app: the newest file's when Jev isn't asked, a running app's, else Files; and only apps with something to show are asked about", () => {
  const all = [...WORKSPACE_TABS];
  const video = { path: 'renders/teaser.mp4', type: 'video/mp4' };
  const image = { path: 'thumbs/a.png', type: 'image/png' };
  const doc = { path: 'notes.md', type: 'text/plain' };
  assert.equal(fallbackApp([video, image], false, all), 'watch');
  assert.equal(fallbackApp([image, video], false, all), 'board');
  // The floor has the screening room off: the next file's app.
  assert.equal(fallbackApp([video, image], false, all.filter((t) => t !== 'watch')), 'board');
  assert.equal(fallbackApp([], true, all), 'review');
  assert.equal(fallbackApp([], false, all), 'files');
  assert.deepEqual(candidateApps([video, doc], false, all), ['watch', 'read', 'files']);
  assert.deepEqual(candidateApps([video], true, all), ['review', 'watch', 'files']);
  assert.deepEqual(candidateApps([video], true, ['files']), ['files']);
});

test('what a worker made this turn: what it named or made since it was last asked, newest first', () => {
  const art = (p: string, modified: number): ChatArtifact => ({ path: p, name: path.basename(p), type: p.endsWith('.mp4') ? 'video/mp4' : 'text/plain', size: 1, modified });
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', text: 'Make the first cut', at: 100 },
    { id: '2', role: 'assistant', text: 'Here is cut-v1.mp4', at: 200 },
    { id: '3', role: 'user', text: 'Tighten the intro', at: 1000 },
    { id: '4', role: 'assistant', text: 'Working on it', at: 1100 },
    { id: '5', role: 'assistant', text: 'Done: renders/cut-v2.mp4, and I kept old/cut-v1.mp4 for comparison.', at: 2000 },
  ];
  const linked = [art('renders/cut-v2.mp4', 1900), art('old/cut-v1.mp4', 150), art('other/elsewhere.mp4', 50)];
  const artifacts = [art('renders/cut-v2.mp4', 1900), art('renders/cut-v2.srt', 1950), art('old/notes.txt', 10)];
  const turn = turnOf(messages, linked, artifacts, 0);
  assert.equal(turn.said, 'Done: renders/cut-v2.mp4, and I kept old/cut-v1.mp4 for comparison.');
  assert.equal(turn.asked, 'Tighten the intro');
  assert.deepEqual(turn.files.map((f) => f.path), ['renders/cut-v2.mp4', 'old/cut-v1.mp4', 'renders/cut-v2.srt']);
});

test('Jev is asked one choice over the apps with the task, and its answer is taken only when it is one of them', async (t) => {
  let sent: { url: string; init: RequestInit } | undefined;
  const answer = (choice: string, status = 200) => (async (url: string | URL | Request, init?: RequestInit) => {
    sent = { url: String(url), init: init! };
    return new Response(JSON.stringify({ model: 'jev-1', answers: { app: { type: 'choice', choice, confidence: 0.93 } } }), { status });
  }) as typeof fetch;
  const ask = { task: 'Cut the teaser', said: 'Done', files: [{ path: 'teaser.mp4', type: 'video/mp4' }], serving: false };
  assert.deepEqual(await jevPick('k-123', ask, ['watch', 'read', 'files'], answer('watch')), { app: 'watch', confidence: 0.93 });
  assert.equal(sent!.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal((sent!.init.headers as Record<string, string>).Authorization, 'Bearer k-123');
  const body = JSON.parse(String(sent!.init.body));
  assert.equal(body.questions.app.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.app.criteria), ['watch', 'read', 'files']);
  assert.equal(body.state.task, 'Cut the teaser');
  assert.deepEqual(body.state.files, ['teaser.mp4 (video/mp4)']);
  // An app it wasn't asked about, an error, or no answer at all: no pick.
  assert.equal(await jevPick('k', ask, ['watch', 'files'], answer('board')), undefined);
  assert.equal(await jevPick('k', ask, ['watch', 'files'], answer('watch', 500)), undefined);
  assert.equal(await jevPick('k', ask, ['watch', 'files'], (async () => { throw new Error('offline'); }) as typeof fetch), undefined);

  // The key: TYPESAFE_API_KEY, else typesafe.json in the office's data.
  const dir = tmp(t);
  const saved = process.env.TYPESAFE_API_KEY;
  t.after(() => (saved === undefined ? delete process.env.TYPESAFE_API_KEY : (process.env.TYPESAFE_API_KEY = saved)));
  delete process.env.TYPESAFE_API_KEY;
  assert.equal(typesafeKey(dir), undefined);
  writeFileSync(path.join(dir, 'typesafe.json'), JSON.stringify({ apiKey: ' from-file ' }));
  assert.equal(typesafeKey(dir), 'from-file');
  process.env.TYPESAFE_API_KEY = 'from-env';
  assert.equal(typesafeKey(dir), 'from-env');
  assert.ok(readFileSync(path.join(dir, 'typesafe.json'), 'utf8').includes('from-file'));
});
