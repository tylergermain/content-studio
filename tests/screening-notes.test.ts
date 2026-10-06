// The screening room's notes (client/ui/workspace/notes.ts): the draft you're writing on a cut, kept in this browser per
// worker and file, in the order they come in the cut, and what was already sent, read back from the chat's reviews so
// watching v02 shows what was asked of v01.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ReviewNote } from '../src/shared/worker-chat.js';
import { MAX_NOTE, MAX_NOTES, WHOLE_CUT, addNote, cleanNote, draftKey, loadDraft, saveDraft, seekBefore, sentNotes, seriesKey, sortNotes, withoutNotes } from '../src/client/ui/workspace/notes.js';

const V01 = 'youtube/jev-creator-workflows/edit/jev-v01/renders/Jev-for-Creators-v01-4K60.mp4';
const V02 = 'youtube/jev-creator-workflows/edit/jev-v02/renders/Jev-for-Creators-v02-4K60.mp4';

/** A localStorage stand-in, as a Map. */
function memory() {
  const kept = new Map<string, string>();
  return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, String(v)), removeItem: (k: string) => void kept.delete(k) };
}
/** A browser that blocks storage: every call throws. */
const blocked = { getItem(): string | null { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };

test('a draft is kept per worker and per file, and a file in a share is not the same file as one in the worker’s folder', () => {
  const a = draftKey('811e684d3c4c', { root: 's1791a45b47', path: V01 });
  assert.equal(a, draftKey('811e684d3c4c', { root: 's1791a45b47', path: V01 }));
  assert.notEqual(a, draftKey('811e684d3c4c', { root: 's1791a45b47', path: V02 }));
  assert.notEqual(a, draftKey('0a0a0a0a0a0a', { root: 's1791a45b47', path: V01 }));
  assert.notEqual(a, draftKey('811e684d3c4c', { path: V01 }));
  assert.ok(a.startsWith('agent-office.'));
});

test('notes come in the order of the cut, two at one moment in the order they were written', () => {
  const notes = sortNotes([{ at: 192, text: 'b-roll too long' }, { at: 29, text: 'cut the pause' }, { at: 192, text: 'and the music dips' }, { at: 491.5, text: 'end card' }]);
  assert.deepEqual(notes.map((n) => n.text), ['cut the pause', 'b-roll too long', 'and the music dips', 'end card']);
  let built: ReviewNote[] = [];
  for (const [at, text] of [[300, 'third'], [12, 'first'], [45.678, 'second']] as const) built = addNote(built, at, text);
  assert.deepEqual(built, [{ at: 12, text: 'first' }, { at: 45.68, text: 'second' }, { at: 300, text: 'third' }]);
});

test('a note is one clean line: no control characters, no empty notes, a real moment, and at most 50 of them', () => {
  assert.equal(cleanNote('  Cut\nthe\u0007 pause\t here  '), 'Cut the pause here');
  assert.equal(cleanNote('x'.repeat(MAX_NOTE + 50)).length, MAX_NOTE);
  assert.deepEqual(addNote([], 10, ' \n\t '), []);
  assert.deepEqual(addNote([], Number.NaN, 'no time'), []);
  assert.deepEqual(addNote([], -1, 'before the start'), []);
  assert.deepEqual(addNote([], Number.POSITIVE_INFINITY, 'never'), []);
  const full = Array.from({ length: MAX_NOTES }, (_, i) => ({ at: i, text: `note ${i}` }));
  assert.equal(addNote(full, 99, 'one too many').length, MAX_NOTES);
  // Clicking a note plays from just before it.
  assert.equal(seekBefore(192), 190);
  assert.equal(seekBefore(1), 0);
});

test('a draft survives in storage and comes back in order; an empty one is forgotten', () => {
  const store = memory();
  const key = draftKey('w1', { path: V01 });
  const notes = [{ at: 200, text: 'later' }, { at: 3, text: 'sooner' }];
  assert.equal(saveDraft(key, notes, store), true);
  assert.deepEqual(loadDraft(key, store), [{ at: 3, text: 'sooner' }, { at: 200, text: 'later' }]);
  assert.deepEqual(loadDraft(draftKey('w1', { path: V02 }), store), []);
  assert.equal(saveDraft(key, [], store), true);
  assert.equal(store.kept.has(key), false);
});

test('a hand-edited or broken draft keeps only its good notes', () => {
  const store = memory();
  store.setItem('bad-json', '{not json');
  store.setItem('not-a-list', '{"at":1,"text":"x"}');
  store.setItem('mixed', JSON.stringify([{ at: 5, text: 'kept' }, { at: -2, text: 'negative' }, { at: '7', text: 'string time' }, { at: 8 }, null, { at: 9, text: '   ' }, { at: 1, text: 'tab\there' }]));
  store.setItem('huge', JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ at: i, text: `n${i}` }))));
  assert.deepEqual(loadDraft('bad-json', store), []);
  assert.deepEqual(loadDraft('not-a-list', store), []);
  assert.deepEqual(loadDraft('mixed', store), [{ at: 1, text: 'tab here' }, { at: 5, text: 'kept' }]);
  assert.equal(loadDraft('huge', store).length, MAX_NOTES);
});

test('a browser that blocks storage loses the draft, never the page', () => {
  assert.deepEqual(loadDraft('k', blocked), []);
  assert.equal(saveDraft('k', [{ at: 1, text: 'x' }], blocked), false);
  assert.equal(saveDraft('k', [], blocked), false);
  assert.equal(saveDraft('k', [{ at: 1, text: 'x' }], undefined), false);
  // Even reading window.localStorage itself can throw (a sandboxed frame, or site data blocked).
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.deepEqual(loadDraft('k'), []);
    assert.equal(saveDraft('k', [{ at: 1, text: 'x' }]), false);
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('versions of one cut are one series, whatever their folder and name number them', () => {
  assert.equal(seriesKey({ root: 's1', path: V01 }), seriesKey({ root: 's1', path: V02 }));
  assert.equal(seriesKey({ path: 'renders/cut-V3.mp4' }), seriesKey({ path: 'renders/cut-v12.mp4' }));
  assert.notEqual(seriesKey({ root: 's1', path: V01 }), seriesKey({ path: V01 }));
  assert.notEqual(seriesKey({ path: 'renders/intro-v01.mp4' }), seriesKey({ path: 'renders/outro-v01.mp4' }));
  // 'dev01' and 'mov2' are words, not versions.
  assert.notEqual(seriesKey({ path: 'dev01/a.mp4' }), seriesKey({ path: 'dev02/a.mp4' }));
  assert.equal(seriesKey({ path: 'final.mp4' }), ':final.mp4');
});

test('the notes sent on a cut, and on the versions before it, come back newest first; approvals and other cuts do not', () => {
  const share = 's1791a45b47';
  const messages: ChatMessage[] = [
    { id: 'a', role: 'user', text: 'Revision notes…', at: 1000, review: { kind: 'notes', files: [{ root: share, path: V01 }], notes: [{ at: 300, text: 'music too loud' }, { at: 29, text: 'cut the pause' }] } },
    { id: 'b', role: 'assistant', text: 'Here is [v02](</x/v02.mp4>)', at: 2000 },
    { id: 'c', role: 'user', text: 'Approved', at: 3000, review: { kind: 'approve', files: [{ root: share, path: V01 }] } },
    { id: 'd', role: 'user', text: 'Revision notes…', at: 4000, review: { kind: 'notes', files: [{ root: share, path: V02 }], notes: [{ at: 12, text: 'title card typo' }] } },
    { id: 'e', role: 'user', text: 'Revision notes…', at: 5000, review: { kind: 'notes', files: [{ root: share, path: 'youtube/other/edit/v01/renders/Other-v01.mp4' }], notes: [{ at: 5, text: 'not this cut' }] } },
    { id: 'f', role: 'user', text: 'Notes in the folder, not the share', at: 6000, review: { kind: 'notes', files: [{ path: V01 }], notes: [{ at: 1, text: 'another root' }] } },
  ];
  const onV02 = sentNotes(messages, { root: share, path: V02 });
  assert.deepEqual(onV02.map((g) => [g.file.path, g.at, g.notes.map((n) => n.at)]), [[V02, 4000, [12]], [V01, 1000, [29, 300]]]);
  assert.deepEqual(onV02[1].file, { root: share, path: V01 });
  const onV01 = sentNotes(messages, { root: share, path: V01 });
  assert.equal(onV01.length, 2);
  assert.deepEqual(sentNotes(messages, { path: 'renders/unrelated.mp4' }), []);
  // Each group says which message sent it, for its notes' done marks.
  assert.ok(onV02.every((g) => typeof g.id === 'string' && g.id.length > 0));
});

test('sending takes away only the notes that went: one written meanwhile stays', () => {
  const sent = [{ at: 29, text: 'cut the pause' }, { at: 300, text: 'music too loud' }];
  const now = [...sent, { at: 120, text: 'written while sending' }];
  assert.deepEqual(withoutNotes(now, sent), [{ at: 120, text: 'written while sending' }]);
  assert.deepEqual(withoutNotes(sent, []), sent);
});

test('a note about the whole cut keeps saying so, kept and read back', () => {
  const store = memory();
  const key = draftKey('w1', { path: V02 });
  const notes = addNote(addNote([], 12, 'logo late'), 40, 'pacing is great', true);
  assert.deepEqual(notes, [{ at: 0, text: 'pacing is great', where: WHOLE_CUT }, { at: 12, text: 'logo late' }]);
  saveDraft(key, notes, store);
  assert.deepEqual(loadDraft(key, store), notes);
});
