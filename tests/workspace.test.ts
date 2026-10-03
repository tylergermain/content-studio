// A specialist's workspace (shared/workspace.ts): which interface a role opens with, which tab a file
// belongs on, and the prompt a review sends back to the worker. The prompt is what the Video Editor
// acts on, so it has to name the file by its full path and put the notes at the times Tyler saw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_WORKSPACES, WORKSPACES, WORKSPACE_KINDS, clock, isWorkspaceKind, parseChapters, reviewText, tabOf, versionLabel, workspaceHint, workspaceOf } from '../src/shared/workspace.js';
import { PREVIEW_TYPES } from '../src/shared/worker-chat.js';

const RENDER = '/Users/tyler/Desktop/Content OS/outputs/youtube/jev-creator-workflows/edit/jev-v01/renders/Jev-for-Creators-v01-4K60.mp4';
/** Jev's chapters.txt, next to the render's folder, word for word. */
const CHAPTERS = '00:00 Why creators should care\n00:29 What makes Jev different\n01:01 Costs and setup\n02:00 Searchable content library\n04:01 Clip discovery\n04:49 Video structure analysis\n05:58 Tool mentions\n07:05 Sponsor prospecting\n08:11 Get the workflows\n';

test('each role opens with its own interface, and a declared one wins', () => {
  assert.equal(workspaceOf('video-editor'), 'screening');
  assert.equal(workspaceOf('designer'), 'board');
  assert.equal(workspaceOf('researcher'), 'reader');
  assert.equal(workspaceOf('podcast-producer'), 'files');
  assert.equal(workspaceOf(undefined), 'files');
  assert.equal(workspaceOf('constructor'), 'files');
  assert.equal(workspaceOf('podcast-producer', 'board'), 'board');
  assert.equal(workspaceOf('video-editor', 'reader'), 'reader');
  assert.equal(workspaceOf('video-editor', 'theater'), 'screening');
  assert.equal(workspaceOf('video-editor', 42), 'screening');
  assert.ok(isWorkspaceKind('screening'));
  assert.ok(!isWorkspaceKind('Screening') && !isWorkspaceKind(undefined) && !isWorkspaceKind('toString'));
  for (const kind of Object.values(STARTER_WORKSPACES)) assert.ok(isWorkspaceKind(kind));
});

test('every interface has a name, a desk hint and its tabs, and always ends with Files', () => {
  assert.deepEqual(Object.keys(WORKSPACES).sort(), [...WORKSPACE_KINDS].sort());
  for (const kind of WORKSPACE_KINDS) {
    const w = WORKSPACES[kind];
    assert.ok(w.label && w.hint && w.about, kind);
    assert.ok(w.tabs.includes('files'), kind);
    assert.equal(w.tabs.at(-1), 'files', kind);
    assert.equal(new Set(w.tabs).size, w.tabs.length, kind);
    assert.ok(![w.label, w.hint, w.about].some((s) => s.includes('—')), kind);
  }
  assert.equal(WORKSPACES.screening.tabs[0], 'watch');
  assert.equal(WORKSPACES.board.tabs[0], 'board');
  assert.equal(WORKSPACES.reader.tabs[0], 'read');
  assert.deepEqual(WORKSPACES.files.tabs, ['files']);
  assert.equal(workspaceHint('video-editor'), 'Open the screening room');
  assert.equal(workspaceHint('designer'), 'Open the design board');
  assert.equal(workspaceHint('researcher'), 'Read the reports');
  assert.equal(workspaceHint(undefined), 'Open chat');
  assert.equal(workspaceHint('podcast-producer'), 'Open chat');
});

test('each file goes on the tab for what it is', () => {
  assert.equal(tabOf('video/mp4'), 'watch');
  assert.equal(tabOf('audio/wav'), 'watch');
  assert.equal(tabOf('image/png'), 'board');
  assert.equal(tabOf('image/svg+xml'), 'board');
  assert.equal(tabOf('text/plain'), 'read');
  assert.equal(tabOf('text/html'), 'read');
  assert.equal(tabOf('application/pdf'), 'read');
  assert.equal(tabOf('application/octet-stream'), undefined);
  // Every type the chat can preview lands on a tab of its own, not only under Files.
  for (const type of Object.values(PREVIEW_TYPES)) assert.ok(tabOf(type), type);
});

test('times read the way a player shows them', () => {
  assert.equal(clock(534.63), '8:54');
  assert.equal(clock(3723), '1:02:03');
  assert.equal(clock(192.9), '3:12');
  assert.equal(clock(59.99), '0:59');
  assert.equal(clock(0), '0:00');
  assert.equal(clock(-4), '0:00');
  assert.equal(clock(Number.NaN), '0:00');
  assert.equal(clock(36000), '10:00:00');
});

test("Jev's chapters become nine places to jump to", () => {
  const chapters = parseChapters(CHAPTERS);
  assert.equal(chapters.length, 9);
  assert.deepEqual(chapters[0], { at: 0, title: 'Why creators should care' });
  assert.deepEqual(chapters.find((c) => c.title === 'Get the workflows'), { at: 491, title: 'Get the workflows' });
  assert.deepEqual(chapters.map((c) => c.at), [0, 29, 61, 120, 241, 289, 358, 425, 491]);
  // The other ways a description lists them, in time order, and what is not a chapter.
  assert.deepEqual(parseChapters('Chapters\r\n[1:02:03] Outro\r\n- 0:29 – Intro\r\n2. 12:00 | Middle\r\n0:75 Bad seconds\r\n12:345 Too many digits\r\n3:00\r\n'), [
    { at: 29, title: 'Intro' },
    { at: 720, title: 'Middle' },
    { at: 3723, title: 'Outro' },
  ]);
  assert.deepEqual(parseChapters(''), []);
});

test('versions are told apart by the name, or by the folder the file is in', () => {
  assert.equal(versionLabel(RENDER), 'v01');
  assert.equal(versionLabel('/x/jev-v02/renders/Jev-for-Creators-4K60.mp4'), 'v02');
  assert.equal(versionLabel('/x/jev-v01/review.html'), 'v01');
  assert.equal(versionLabel('/x/thumb_V3.png'), 'v3');
  assert.equal(versionLabel('/x/v12/cut.mp4'), 'v12');
  // Not a version: a word with a v in it, a resolution, a frame rate, or a folder too far up.
  assert.equal(versionLabel('/x/review/final-4K60.mp4'), undefined);
  assert.equal(versionLabel('/x/dev2/cut.mp4'), undefined);
  assert.equal(versionLabel('/v01/a/b/c/d/cut.mp4'), undefined);
  assert.equal(versionLabel('cut.mp4'), undefined);
});

test('notes go back as one revision request, in time order, at the full path', () => {
  const text = reviewText('notes', [RENDER], [{ at: 192.4, text: 'The zoom is   too fast.' }, { at: 42, text: 'Cut the pause before\nthe demo.' }], 'Keep the music under the voice.');
  assert.ok(text.includes(RENDER), 'the absolute path');
  assert.ok(text.includes(`\`${RENDER}\``), 'as one piece, though it has spaces');
  assert.ok(text.startsWith(`Revision notes on Jev-for-Creators-v01-4K60.mp4:\n\`${RENDER}\``), text);
  // The version is named when only the folder says which it is.
  assert.ok(reviewText('notes', ['/x/jev-v02/renders/cut.mp4'], [{ at: 1, text: 'Louder.' }]).startsWith('Revision notes on cut.mp4 (v02):'));
  const first = text.indexOf('- 0:42 Cut the pause before the demo.'), second = text.indexOf('- 3:12 The zoom is too fast.');
  assert.ok(first > 0 && second > first, text);
  assert.ok(text.includes('Keep the music under the voice.'));
  assert.match(text, /new file with v02 in its name, and leave v01 as it is/);
  assert.match(text, /Markdown link to its full path/);
  assert.ok(!text.includes('—'));
  // A file with no version still asks for a new one rather than an overwrite.
  assert.match(reviewText('notes', ['/x/cut.mp4'], [{ at: 1, text: 'Louder.' }]), /with v02 in its name, and leave this file as it is/);
  assert.match(reviewText('notes', ['/x/cut-v9.mp4'], [{ at: 1, text: 'Louder.' }]), /v10 in its name, and leave v9 as it is/);
});

test('approving says the cut is final and not to publish it', () => {
  const text = reviewText('approve', [RENDER]);
  assert.ok(text.includes(RENDER) && text.includes('Approved'));
  assert.ok(text.startsWith(`Approved: Jev-for-Creators-v01-4K60.mp4 is final.\n\`${RENDER}\``), text);
  assert.match(text, /do not publish/);
  const pick = reviewText('approve', ['/x/thumbs/thumb-b.png']);
  assert.match(pick, /^Approved: I pick thumb-b\.png\.\n`\/x\/thumbs\/thumb-b\.png`/);
  assert.match(pick, /do not publish/);
});

test('variations and questions name every file they are about', () => {
  const files = ['/x/thumbs/a.png', '/x/thumbs/b.png', '/x/thumbs/c d.png'];
  const variations = reviewText('variations', files, undefined, 'Try a warmer background.');
  for (const f of files) assert.ok(variations.includes(`- \`${f}\``), f);
  assert.ok(variations.includes('Try a warmer background.'));
  assert.match(variations, /new file next to its original/);
  const question = reviewText('question', [RENDER], undefined, 'Can you make an H.264 review copy?');
  assert.ok(question.includes(RENDER) && question.includes('H.264 review copy'));
  for (const kind of ['notes', 'approve', 'variations', 'question'] as const) {
    for (const list of [[RENDER], files]) assert.ok(!reviewText(kind, list, [{ at: 3, text: 'x' }], 'y').includes('—'), kind);
  }
});
