import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chatHistory, keepMessage, mergeMessages } from '../src/server/worker-chat/history.js';
import { parseReview } from '../src/server/worker-chat/review.js';
import { sendToWorker } from '../src/server/worker-chat/send.js';
import { addShare, removeShare } from '../src/server/worker-chat/shares.js';
import { workerChatRoutes } from '../src/server/http/routes/worker-chat.js';
import type { ChatMessage, ChatSnapshot } from '../src/shared/worker-chat.js';

const EDIT = 'youtube/jev/edit/jev-v01', RENDER = `${EDIT}/renders/Jev-v01.mp4`;

/**
 * A floor with a Pi Video Editor (hired on the admin's account) whose last message links a render and
 * its review page in a Content OS repository outside the floor, with that repository's outputs shared.
 * `prompts`, `resumed` and `toasts` record what reached the worker and the floor.
 */
async function screening(t: { after(fn: () => void): void }) {
  const floorDir = mkdtempSync(path.join(os.tmpdir(), 'review-floor-')), outside = mkdtempSync(path.join(os.tmpdir(), 'review-outside-'));
  t.after(() => { rmSync(floorDir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  const repo = path.join(outside, 'Content OS'), outputs = path.join(repo, 'outputs'), renders = path.join(outputs, EDIT, 'renders');
  mkdirSync(path.join(repo, '.git'), { recursive: true }); mkdirSync(path.join(renders, 'segments'), { recursive: true });
  writeFileSync(path.join(outputs, RENDER), Buffer.alloc(2048, 1)); writeFileSync(path.join(renders, 'Jev-v00.mp4'), 'v0'); writeFileSync(path.join(renders, 'concat.txt'), 'file a');
  writeFileSync(path.join(renders, 'segments', '001.mp4'), 's'); writeFileSync(path.join(renders, '.hidden.png'), ''); writeFileSync(path.join(renders, 'cut.fcpxml'), '<x/>');
  writeFileSync(path.join(outputs, EDIT, 'review.html'), '<p>review</p>'); writeFileSync(path.join(outputs, EDIT, 'chapters.txt'), '00:00 Intro\n08:11 Outro\n');
  writeFileSync(path.join(outputs, 'other.png'), ''); mkdirSync(path.join(outside, 'away')); writeFileSync(path.join(outside, 'away', 'a.png'), '');
  symlinkSync(path.join(outside, 'away', 'a.png'), path.join(renders, 'linked-away.png'));
  const transcripts = path.join(floorDir, '.agent-office', 'pi-sessions', 'worker1'); mkdirSync(transcripts, { recursive: true });
  const line = (role: string, text: string, at: string) => JSON.stringify({ type: 'message', timestamp: at, message: { role, content: [{ type: 'text', text: text.replaceAll('REPO', repo) }] } }) + '\n';
  const say = (text: string, at = '2026-10-03T03:35:42Z') => writeFileSync(path.join(transcripts, 'session1.jsonl'), line('assistant', text, at));
  const hear = (text: string, at: string) => appendFileSync(path.join(transcripts, 'session1.jsonl'), line('user', text, at));
  say(`Edited. [Watch the edited video](<REPO/outputs/${RENDER}>) and [open the review page](<REPO/outputs/${EDIT}/review.html>).`);
  const info = { id: 'worker1', kind: 'agent', status: 'idle', name: 'Video Editor', provider: 'pi', sessionId: 'session1', specialist: 'video-editor', createdAt: 1 };
  const prompts: string[] = [], resumed: string[] = [], toasts: string[] = [];
  const floor = { dir: floorDir, workers: { get: () => info, sessionContext: () => ({ info, state: {}, tracker: {} }), ownerOf: () => 'admin', owners: () => [{ workerId: 'worker1', cwd: path.join(floorDir, 'agents', 'video-editor') }], prompt: (_id: string, text: string) => { prompts.push(text); }, resume: (_id: string, text: string): string | undefined => { resumed.push(text); return undefined; }, write: () => {} } };
  const people = [{ id: 'admin', name: 'Tyler', role: 'admin' }, { id: 'peer', name: 'Mia', role: 'member' }];
  const ctx = { cfg: { dataDir: path.join(floorDir, '.agent-office'), trustProxy: false }, floors: new Map([['floor1', floor]]), accounts: { get: (id: string | undefined) => people.find(a => a.id === id) }, meOf: (id: string | undefined) => ({ admin: !id || id === 'admin' }), toastFloor: (_floor: unknown, text: string) => { toasts.push(text); } };
  const share = addShare(floorDir, outputs, 'admin', { dataDir: ctx.cfg.dataDir, floorDirs: [floorDir] });
  assert.ok(!('error' in share));
  const state = { caller: 'admin' as string | undefined };
  const server = http.createServer((req, res) => { const url = new URL(req.url!, 'http://localhost'); void workerChatRoutes.chat.handle(ctx as never, { req, res, url, path: url.pathname, session: { account: people.find(a => a.id === state.caller) as never } }).catch(() => { res.statusCode = 500; res.end(); }); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, q = '?floor=floor1&worker=worker1';
  const snapshot = async () => (await (await fetch(`${base}/api/worker-chat${q}`)).json()) as ChatSnapshot;
  const review = (body: unknown, origin = base) => fetch(`${base}/api/worker-chat/review${q}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const file = (rel: string, root?: string) => fetch(`${base}/api/worker-chat/file${q}${root ? `&root=${root}` : ''}&path=${encodeURIComponent(rel)}`);
  return { floor, info, root: share.id, real: realpathSync(outputs), floorDir, prompts, resumed, toasts, state, say, hear, snapshot, review, file };
}

test('approving a cut sends one prompt with its real path, keeps the review on the message and tells the floor once', async t => {
  const o = await screening(t);
  const data = await o.snapshot();
  assert.deepEqual(data.linked.map(f => [f.root, f.path]), [[o.root, RENDER], [o.root, `${EDIT}/review.html`]]);
  assert.equal(data.workspace, 'screening'); assert.equal(data.canSend, true);
  const approve = { kind: 'approve', requestId: 'approve-1', files: [{ root: o.root, path: RENDER }] };
  assert.deepEqual(await (await o.review(approve)).json(), { ok: true });
  assert.equal(o.prompts.length, 1);
  assert.ok(o.prompts[0].includes(path.join(o.real, RENDER)), o.prompts[0]); assert.match(o.prompts[0], /Approved/); assert.match(o.prompts[0], /do not publish/);
  assert.deepEqual(o.toasts, ['Tyler approved Jev-v01.mp4 from Video Editor']);
  // A retry of the same request is answered, never sent or announced again.
  assert.deepEqual(await (await o.review(approve)).json(), { ok: true, duplicate: true });
  assert.equal(o.prompts.length, 1); assert.equal(o.toasts.length, 1);
  const sent = (await o.snapshot()).messages.filter(m => m.review);
  assert.deepEqual(sent.map(m => [m.id, m.review]), [['approve-1', { kind: 'approve', files: [{ root: o.root, path: RENDER }] }]]);
  assert.equal(statSync(path.join(o.floorDir, '.agent-office', 'worker-chat', 'worker1.json')).mode & 0o777, 0o600);
  // A file in the worker's own folder (the floor, for a specialist) needs no share, and only approvals are announced.
  mkdirSync(path.join(o.floorDir, 'outputs')); writeFileSync(path.join(o.floorDir, 'outputs', 'thumb.png'), '');
  assert.equal((await o.review({ kind: 'variations', requestId: 'vary-1', files: [{ path: 'outputs/thumb.png' }], text: 'Bolder type' })).status, 200);
  assert.ok(o.prompts[1].includes(path.join(realpathSync(o.floorDir), 'outputs', 'thumb.png')), o.prompts[1]); assert.match(o.prompts[1], /Bolder type/);
  assert.equal(o.toasts.length, 1);
});

test('notes go back in time order as a request for a new version, and keep their badge on the provider\'s copy', async t => {
  const o = await screening(t);
  const notes = [{ at: 192.4, text: '  Tighten this pause  ' }, { at: 31, text: 'Music is too loud here' }];
  assert.equal((await o.review({ kind: 'notes', requestId: 'notes-1', files: [{ root: o.root, path: RENDER }], notes })).status, 200);
  const [prompt] = o.prompts;
  assert.ok(prompt.includes(path.join(o.real, RENDER)));
  assert.ok(prompt.indexOf('0:31 Music is too loud here') < prompt.indexOf('3:12 Tighten this pause'), prompt);
  assert.match(prompt, /v02/); assert.ok(!prompt.includes('—'));
  // Once the provider logs the prompt, its copy stands in for the kept one and carries the review.
  o.hear(prompt, '2026-10-03T04:00:00Z');
  const data = await o.snapshot(), reviewed = data.messages.filter(m => m.review);
  assert.equal(reviewed.length, 1); assert.notEqual(reviewed[0].id, 'notes-1');
  assert.deepEqual(reviewed[0].review, { kind: 'notes', files: [{ root: o.root, path: RENDER }], notes: [{ at: 31, text: 'Music is too loud here' }, { at: 192.4, text: 'Tighten this pause' }] });
});

test('a review is refused unless its viewer may direct the worker, its files open here, and its notes fit', async t => {
  const o = await screening(t);
  const notes = (n: number, text = 'Trim') => Array.from({ length: n }, (_, i) => ({ at: i, text }));
  const on = (rel: string, root = o.root) => [{ root, path: rel }];
  assert.equal((await o.review({ kind: 'approve', requestId: 'x1', files: on(RENDER) }, 'https://attacker.test')).status, 403);
  for (const [body, status] of [
    [{ kind: 'notes', requestId: 'x2', files: on(RENDER), notes: [{ at: 3, text: 'bad \u001b[31m' }] }, 400],
    [{ kind: 'notes', requestId: 'x3', files: on(RENDER), notes: notes(51) }, 400],
    [{ kind: 'notes', requestId: 'x4', files: on(RENDER), notes: notes(21, 'n'.repeat(1000)) }, 400],
    [{ kind: 'notes', requestId: 'x5', files: on(RENDER), notes: [{ at: -1, text: 'Before the start' }] }, 400],
    [{ kind: 'notes', requestId: 'x6', files: on(RENDER) }, 400],
    [{ kind: 'publish', requestId: 'x7', files: on(RENDER) }, 400],
    [{ kind: 'approve', files: on(RENDER) }, 400],
    [{ kind: 'variations', requestId: 'x8', files: [...on(RENDER), ...on('a.png'), ...on('b.png'), ...on('c.png'), ...on('d.png')], text: 'Warmer' }, 400],
    [{ kind: 'question', requestId: 'x9', files: on(RENDER), text: '  ' }, 400],
    // Files the viewer couldn't open: elsewhere in the share, outside it, through a symlink, under no share.
    [{ kind: 'approve', requestId: 'x10', files: on('other.png') }, 404],
    [{ kind: 'approve', requestId: 'x11', files: on(`${EDIT}/../../../../../away/a.png`) }, 404],
    [{ kind: 'approve', requestId: 'x12', files: on(`${EDIT}/renders/linked-away.png`) }, 404],
    [{ kind: 'approve', requestId: 'x13', files: on(RENDER, 's0000000000') }, 404],
    [{ kind: 'approve', requestId: 'x14', files: [{ path: RENDER }] }, 404],
  ] as const) assert.equal((await o.review(body)).status, status, JSON.stringify(body).slice(0, 120));
  assert.deepEqual(o.prompts, []);
  // A member who didn't hire this worker sees a read-only window and can't send it a review.
  o.state.caller = 'peer';
  const data = await o.snapshot();
  assert.equal(data.canSend, false); assert.deepEqual(data.linked, []); assert.deepEqual(data.nearby, []);
  assert.equal((await o.review({ kind: 'approve', requestId: 'x15', files: on(RENDER) })).status, 403);
  assert.deepEqual(o.prompts, []); assert.deepEqual(o.toasts, []);
});

test('the files beside a linked render are listed, and remembered links outlast the transcript\'s tail', async t => {
  const o = await screening(t);
  let data = await o.snapshot();
  const beside = data.nearby.map(f => f.path).sort();
  assert.deepEqual(beside, [`${EDIT}/chapters.txt`, `${EDIT}/renders/Jev-v00.mp4`, `${EDIT}/renders/concat.txt`]);
  assert.ok(data.nearby.every(f => f.root === o.root));
  for (const rel of beside) assert.equal((await o.file(rel, o.root)).status, 200, rel);
  assert.equal(statSync(path.join(o.floorDir, '.agent-office', 'worker-chat', 'worker1.links.json')).mode & 0o777, 0o600);
  // The worker moves on and its linking message leaves the transcript: the render still opens, and can still be approved.
  o.say('All set. Anything else?', '2026-10-03T05:00:00Z');
  data = await o.snapshot();
  assert.ok(!data.messages.some(m => m.text.includes('Watch the edited video')));
  assert.deepEqual(data.linked.map(f => f.path), [RENDER, `${EDIT}/review.html`]);
  assert.equal(data.nearby.length, 3);
  assert.equal((await o.file(RENDER, o.root)).status, 200);
  assert.equal((await o.review({ kind: 'approve', requestId: 'later', files: [{ root: o.root, path: RENDER }] })).status, 200);
  // Stopping the share takes the remembered links with it.
  assert.ok(removeShare(o.floorDir, o.root));
  data = await o.snapshot();
  assert.deepEqual(data.linked, []); assert.deepEqual(data.nearby, []);
  assert.equal((await o.file(RENDER, o.root)).status, 404);
  assert.deepEqual(JSON.parse(readFileSync(path.join(o.floorDir, '.agent-office', 'worker-chat', 'worker1.links.json'), 'utf8')).length, 2);
});

test('sending wakes an asleep worker with the message, and keeps nothing when the worker can\'t take it', async t => {
  const o = await screening(t);
  o.info.status = 'exited';
  assert.deepEqual(sendToWorker(o.floor as never, 'worker1', '  Make the intro shorter  ', 'wake-1', 'Tyler'), { status: 200, body: { ok: true } });
  assert.deepEqual(o.resumed, ['Make the intro shorter']); assert.deepEqual(o.prompts, []);
  assert.deepEqual(sendToWorker(o.floor as never, 'worker1', 'Again', 'wake-1', 'Tyler'), { status: 200, body: { ok: true, duplicate: true } });
  o.floor.workers.resume = () => 'No session to carry on';
  assert.deepEqual(sendToWorker(o.floor as never, 'worker1', 'Hello', 'wake-2', 'Tyler'), { status: 409, body: { error: 'No session to carry on' } });
  assert.deepEqual(sendToWorker(o.floor as never, 'worker1', 'Hello', 'bad id!', 'Tyler').status, 400);
  assert.deepEqual(sendToWorker(o.floor as never, 'worker1', 'Hello \u0007', 'wake-3', 'Tyler').status, 400);
  o.info.kind = 'shell';
  assert.deepEqual(sendToWorker(o.floor as never, 'worker1', 'Hello', 'wake-4', 'Tyler').status, 400);
  assert.deepEqual(chatHistory(path.join(o.floorDir, '.agent-office'), 'worker1').map(m => m.id), ['wake-1']);
});

test('kept reviews are checked when read, and follow a matching session copy', t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'review-history-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const review = { kind: 'notes' as const, files: [{ root: 's0123456789', path: RENDER }], notes: [{ at: 31, text: 'Louder' }] };
  keepMessage(dir, 'w1', { id: 'a', role: 'user', text: 'Revision notes\n\n- 0:31 Louder', at: 5, review });
  writeFileSync(path.join(dir, 'worker-chat', 'w2.json'), JSON.stringify([
    { id: 'b', role: 'user', text: 'bad kind', at: 1, review: { kind: 'publish', files: [{ path: 'a.png' }] } },
    { id: 'c', role: 'user', text: 'bad notes', at: 2, review: { kind: 'notes', files: [{ path: 'a.png' }], notes: [{ at: 'soon', text: 'x' }] } },
    { id: 'd', role: 'user', text: 'extra fields', at: 3, secret: 'x', review: { kind: 'approve', files: [{ path: 'a.png', extra: 1 }], note: 'x' } },
  ]));
  assert.deepEqual(chatHistory(dir, 'w1'), [{ id: 'a', role: 'user', text: 'Revision notes\n\n- 0:31 Louder', at: 5, review }]);
  assert.deepEqual(chatHistory(dir, 'w2'), [{ id: 'b', role: 'user', text: 'bad kind', at: 1 }, { id: 'c', role: 'user', text: 'bad notes', at: 2 }, { id: 'd', role: 'user', text: 'extra fields', at: 3, review: { kind: 'approve', files: [{ path: 'a.png' }] } }]);
  const session: ChatMessage[] = [{ id: 's1', role: 'user', text: 'Revision notes - 0:31 Louder', at: 6 }, { id: 's2', role: 'assistant', text: 'Revision notes - 0:31 Louder', at: 7 }];
  const merged = mergeMessages(session, chatHistory(dir, 'w1'));
  assert.deepEqual(merged.map(m => [m.id, m.review?.kind]), [['s1', 'notes'], ['s2', undefined]]);
  // A note about the whole cut (or a design's element) keeps where it's on.
  const whole = { kind: 'notes' as const, files: [{ path: RENDER }], notes: [{ at: 0, text: 'Tighter overall', where: 'the whole cut' }] };
  keepMessage(dir, 'w3', { id: 'e', role: 'user', text: 'Revision notes', at: 8, review: whole });
  assert.deepEqual(chatHistory(dir, 'w3')[0].review, whole);
});

test('a review body is tidied: files de-duplicated, notes trimmed and in time order, an empty root is the worker\'s own folder', () => {
  assert.deepEqual(parseReview({ kind: 'notes', requestId: 'r1', files: [{ path: 'a.mp4', root: '' }, { path: 'a.mp4' }], notes: [{ at: 9.87654, text: ' b ' }, { at: 2, text: 'a' }], text: ' Also warmer ' }),
    { kind: 'notes', requestId: 'r1', files: [{ path: 'a.mp4' }], notes: [{ at: 2, text: 'a' }, { at: 9.877, text: 'b' }], text: 'Also warmer' });
  assert.deepEqual(parseReview({ kind: 'variations', requestId: 'r2', files: [{ root: 's0123456789', path: 'a.png' }, { path: 'a.png' }], text: 'Bolder type' }),
    { kind: 'variations', requestId: 'r2', files: [{ root: 's0123456789', path: 'a.png' }, { path: 'a.png' }], text: 'Bolder type' });
  for (const body of [null, [], 'x', { kind: 'approve', requestId: 'r3', files: [{ root: '../x', path: 'a.png' }] }, { kind: 'approve', requestId: 'r4', files: [{ path: 'a.png' }], notes: [{ at: 1, text: 'x' }] }, { kind: 'notes', requestId: 'r5', files: [{ path: 'a.mp4' }, { path: 'b.mp4' }], notes: [{ at: 1, text: 'x' }] }, { kind: 'question', requestId: 'r6', files: [{ path: 'a.md' }], text: 'x'.repeat(4001) }])
    assert.ok('error' in parseReview(body), JSON.stringify(body));
});
