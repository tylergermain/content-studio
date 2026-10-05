// The links in a worker's chat (shared/chat-links.ts): the server reads the raw Markdown to find the
// files a worker linked, and the browser reads the href marked wrote for the same link. Both have to
// land on one key, or the link Tyler clicks never matches the file the office found for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Marked } from 'marked';
import { linkTargets, normalizeTarget } from '../src/shared/chat-links.js';
import { PREVIEW_TYPES, artifactKey, previewType } from '../src/shared/worker-chat.js';
import { artifactType } from '../src/server/worker-chat/artifacts.js';

/** The Video Editor's last message on the Content floor, word for word: the links that opened the office's loading screen. */
const JEV = 'Finished your Jev edit: **8:55, 4K/60 fps**, with tighter pacing, your blue channel graphics, demo close-ups, and polished audio.\n\n[Watch the edited video](</Users/tyler/Desktop/Content OS/outputs/youtube/jev-creator-workflows/edit/jev-v01/renders/Jev-for-Creators-v01-4K60.mp4>) · [Review page and editable timeline](</Users/tyler/Desktop/Content OS/outputs/youtube/jev-creator-workflows/edit/jev-v01/review.html>)';
const JEV_DIR = '/Users/tyler/Desktop/Content OS/outputs/youtube/jev-creator-workflows/edit/jev-v01';

// The worker chat renders messages the way markdownFile does (client/ui/markdown.ts).
const md = new Marked({ gfm: true });
/** An attribute as the page's getAttribute reads it back: character references undone. */
const attribute = (raw: string) => raw.replace(/&(?:(amp|lt|gt|quot)|#(\d+)|#x([0-9a-f]+));/gi, (_, name?: string, dec?: string, hex?: string) =>
  name ? ({ amp: '&', lt: '<', gt: '>', quot: '"' } as Record<string, string>)[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)));
/** The href and src of every link and picture marked writes for a message, in order, as the browser keys them. */
const pageKeys = (markdown: string) => [...(md.parse(markdown, { async: false }) as string).matchAll(/\s(?:href|src)="([^"]*)"/g)].map(m => normalizeTarget(attribute(m[1])));

test('one file is one key however the agent wrote the link', () => {
  const key = '/Users/tyler/Desktop/Content OS/a.mp4';
  for (const raw of ['</Users/tyler/Desktop/Content OS/a.mp4>', '/Users/tyler/Desktop/Content%20OS/a.mp4', 'file:///Users/tyler/Desktop/Content OS/a.mp4', 'file://localhost/Users/tyler/Desktop/Content%20OS/a.mp4', '  </Users/tyler/Desktop/Content OS/a.mp4>  '])
    assert.equal(normalizeTarget(raw), key, raw);
  assert.equal(normalizeTarget('/abs/app.py:12'), '/abs/app.py');
  assert.equal(normalizeTarget('/abs/app.py:12:3'), '/abs/app.py');
  assert.equal(normalizeTarget('/abs/app.py#L10'), '/abs/app.py');
  assert.equal(normalizeTarget('/abs/app.py#L10-L20'), '/abs/app.py');
  assert.equal(normalizeTarget('/abs/a.png?x=1'), '/abs/a.png');
  assert.equal(normalizeTarget('?x=1'), '');
  assert.equal(normalizeTarget('/abs/50%off.png'), '/abs/50%off.png', 'a stray % is kept as written');
  assert.equal(normalizeTarget('~/Desktop/cut.mp4'), '~/Desktop/cut.mp4');
  assert.equal(normalizeTarget('../../outputs/thumb.png'), '../../outputs/thumb.png');
  assert.equal(normalizeTarget('/abs/Caf%C3%A9.mp4'), '/abs/Café.mp4');
});

test('web, mail, script and in-page links are not files', () => {
  for (const raw of ['https://example.com/a.mp4', 'http://localhost:5173/a.png', 'mailto:tyler@example.com', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:image/png;base64,AAAA', 'vbscript:x', '#top', '#', '', '   ', '<>', 'file://otherhost/share/a.mp4', 'file:a.mp4', '//cdn.example.com/a.png', '/abs/a%0Ab.png'])
    assert.equal(normalizeTarget(raw), '', raw);
});

test('the server reads the same key from the Markdown as the browser reads from the page', () => {
  const forms = [
    // The forms agents use, checked against the repo's own marked.
    '</Users/tyler/Desktop/Content OS/out/a v01.mp4>', '/Users/tyler/x/app.py:12', '</Users/tyler/Desktop/Content OS/a.md:3:4>', '../../outputs/youtube/x/thumb.png', 'outputs/a%20b.png', 'file:///Users/tyler/x.mp4', '/Users/tyler/x/a(1).png',
    // And the escapes Markdown allows in a destination.
    '/x/a\\(1\\).png', '/x/a\\_b.png', '/x/a\\\\b.png', '/x/Q&A.mp4', '/x/a&amp;b.png', '/x/a&#32;b.png', '/x/a&#x41;.png', '</x/a\\>b.png>', '<./renders/z (final).mp4>', '/x/Café.mp4', '/abs/50%off.png', '/x/a.png?x=1#y',
  ];
  for (const dest of forms) {
    for (const markdown of [`[x](${dest})`, `![x](${dest})`, `[x](${dest} "A title")`, `[x][r]\n\n[r]: ${dest}`]) {
      const server = linkTargets(markdown);
      assert.equal(server.length, 1, markdown);
      assert.deepEqual(pageKeys(markdown), server, markdown);
    }
  }
  const thumb = '[![Thumbnail](</x/Content OS/thumb.png>)](</x/Content OS/cut.mp4>)';
  assert.deepEqual(linkTargets(thumb), ['/x/Content OS/thumb.png', '/x/Content OS/cut.mp4']);
  assert.deepEqual(new Set(pageKeys(thumb)), new Set(linkTargets(thumb)));
});

test("the Video Editor's message links exactly its render and its review page", () => {
  assert.deepEqual(linkTargets(JEV), [`${JEV_DIR}/renders/Jev-for-Creators-v01-4K60.mp4`, `${JEV_DIR}/review.html`]);
  assert.deepEqual(pageKeys(JEV), linkTargets(JEV));
});

test('code spans that name a previewable file count, and code blocks, commands and web links do not', () => {
  const message = [
    'Rendered `renders/cut-v02.mp4` and the poster ![poster](outputs/poster.png).',
    'The notes are in `/Users/tyler/Desktop/Content OS/notes.md:12`; run `npm install` first.',
    'Docs at [the site](https://example.com/guide.html) and [mail](mailto:a@b.c); see [above](#top).',
    '```bash',
    'ffmpeg -i `in/raw.mov` out.mp4',
    '[not a link](in/fenced.mp4)',
    '```',
    '~~~',
    '`in/tilde.png`',
    '~~~',
    'Inline ```in/triple.mp4``` and ``in/double.mp4`` are not single-backtick spans; `[x](in/code.mp4)` is code.',
    'Again `renders/cut-v02.mp4` and [the cut](renders/cut-v02.mp4).',
    '[^1]: A footnote, not a link.',
  ].join('\n');
  assert.deepEqual(linkTargets(message), ['renders/cut-v02.mp4', 'outputs/poster.png', '/Users/tyler/Desktop/Content OS/notes.md']);
  assert.deepEqual(linkTargets('Open `review.html` or `.env` or `Makefile`'), ['review.html']);
  assert.deepEqual(linkTargets('```\n[a](in/a.mp4)\n'), [], 'an unclosed fence runs to the end');
  assert.deepEqual(linkTargets('   ```js\n`in/b.png`\n   ```\n`out/c.png`'), ['out/c.png']);
});

test('a message gives at most 50 targets, each once', () => {
  const many = Array.from({ length: 80 }, (_, i) => `[clip ${i}](clips/c${i}.mp4) [again](clips/c${i}.mp4)`).join('\n');
  const found = linkTargets(many);
  assert.equal(found.length, 50);
  assert.equal(new Set(found).size, 50);
  assert.deepEqual(found.slice(0, 2), ['clips/c0.mp4', 'clips/c1.mp4']);
  assert.ok(linkTargets(`${'['.repeat(20000)}](a.png)\n${'`'.repeat(20000)}`).length <= 1, 'long runs of brackets and backticks stay cheap');
});

test('preview types are the one table, read by extension as path.extname reads it', () => {
  assert.equal(previewType('A.MP4'), 'video/mp4');
  assert.equal(previewType('/x/Content OS/Jev-for-Creators-v01-4K60.mp4'), 'video/mp4');
  assert.equal(previewType('.md'), undefined);
  assert.equal(previewType('x.fcpxml'), undefined);
  assert.equal(previewType('x.constructor'), undefined);
  assert.equal(previewType('x.__proto__'), undefined);
  assert.equal(Object.keys(PREVIEW_TYPES).length, 18);
  for (const name of ['a.png', 'b.JPG', 'dir.mp4/x', 'dir/x.mov', 'x.md/', '..mp4', '..', '.', '...', 'a.', 'a..', 'v1.2.webm', '/', '', 'a\\b.wav', 'a/.html', '.git/x.json'])
    assert.equal(previewType(name), PREVIEW_TYPES[path.extname(name).toLowerCase()], name);
  assert.equal(artifactType, previewType, 'the server serves files with the same table the browser reads links with');
  assert.equal(artifactKey({ path: 'renders/a.mp4' }), ':renders/a.mp4');
  assert.notEqual(artifactKey({ root: 's0123456789', path: 'renders/a.mp4' }), artifactKey({ path: 'renders/a.mp4' }));
});
