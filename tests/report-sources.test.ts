// The Sources rail in the Researcher's reader (client/ui/workspace/sources.ts): each page a report cites shows once,
// numbered by where the report first cites it, with its site and the report's own name for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bareUrls, groupSources, sourceKey, sourcesText } from '../src/client/ui/workspace/sources.js';

test('two links to one page are one source, however the address is written', () => {
  const key = sourceKey('https://www.theverge.com/2026/10/1/ai-video');
  for (const href of ['http://theverge.com/2026/10/1/ai-video/', 'https://WWW.TheVerge.com/2026/10/1/ai-video#comments', 'https://www.theverge.com/2026/10/1/ai-video?utm_source=x&utm_medium=y', ' https://theverge.com/2026/10/1/ai-video '])
    assert.equal(sourceKey(href), key, href);
  // A different page, query or port is a different source.
  assert.notEqual(sourceKey('https://theverge.com/2026/10/1/ai-video?page=2'), key);
  assert.notEqual(sourceKey('https://theverge.com/2026/10/2/ai-video'), key);
  assert.notEqual(sourceKey('https://theverge.com:8443/2026/10/1/ai-video'), key);
});

test('only web addresses are sources', () => {
  for (const href of ['mailto:tyler@example.com', 'javascript:alert(1)', 'notes/claims.md', '/Users/tyler/Desktop/Content OS/outputs/a.md', '#methods', 'file:///etc/hosts', 'data:text/html,hi', '', 'https://'])
    assert.equal(sourceKey(href), undefined, href);
  assert.deepEqual(groupSources([{ href: 'mailto:a@b.c', text: 'Mail' }, { href: 'claims.md', text: 'Claims' }]), []);
});

test('sources are numbered by first citation, with their site and how often the report cites them', () => {
  const sources = groupSources([
    { href: 'https://www.youtube.com/watch?v=abc', text: 'Jev on creator workflows' },
    { href: 'https://openai.com/index/sora-2/', text: 'Sora 2 announcement' },
    { href: 'https://youtube.com/watch?v=abc#t=30', text: 'the interview' },
    { href: 'https://arxiv.org/abs/2410.00001', text: 'https://arxiv.org/abs/2410.00001' },
  ]);
  assert.deepEqual(sources.map((s) => [s.n, s.host, s.title, s.count]), [
    [1, 'youtube.com', 'Jev on creator workflows', 2],
    [2, 'openai.com', 'Sora 2 announcement', 1],
    [3, 'arxiv.org', 'arxiv.org/abs/2410.00001', 1],
  ]);
  // The address is kept as the report first wrote it.
  assert.equal(sources[0].url, 'https://www.youtube.com/watch?v=abc');
});

test('a source the report first links bare takes the name it gives it later', () => {
  const [s] = groupSources([
    { href: 'https://www.nytimes.com/2026/09/30/technology/ai-video.html', text: 'https://www.nytimes.com/2026/09/30/technology/ai-video.html' },
    { href: 'https://nytimes.com/2026/09/30/technology/ai-video.html', text: 'nytimes.com' },
    { href: 'https://www.nytimes.com/2026/09/30/technology/ai-video.html', text: '  The New York Times,\n AI video story ' },
  ]);
  assert.equal(s.title, 'The New York Times, AI video story');
  assert.equal(s.named, true);
  assert.equal(s.count, 3);
});

test('an unnamed source shows its address without the scheme, decoded', () => {
  const [s] = groupSources([{ href: 'https://en.wikipedia.org/wiki/Caf%C3%A9_racer', text: '' }]);
  assert.equal(s.title, 'en.wikipedia.org/wiki/Café_racer');
  assert.equal(s.named, false);
});

test('Copy sources gives one numbered line each, with no em dashes', () => {
  const text = sourcesText(groupSources([
    { href: 'https://openai.com/index/sora-2/', text: 'Sora 2 announcement' },
    { href: 'https://arxiv.org/abs/2410.00001', text: '' },
  ]));
  assert.equal(text, '1. Sora 2 announcement: https://openai.com/index/sora-2/\n2. https://arxiv.org/abs/2410.00001');
  assert.ok(!text.includes('—'));
  assert.equal(sourcesText([]), '');
});

test('addresses written out in plain notes are found without the punctuation around them', () => {
  const notes = 'Claim 1 (https://openai.com/index/sora-2/). See https://en.wikipedia.org/wiki/Foo_(bar), and [https://arxiv.org/abs/2410.00001]. Also http://example.com/a?b=1&c=2!\nNot ftp://x.org or www.nolink.com.';
  const found = bareUrls(notes);
  assert.deepEqual(found.map((u) => u.url), ['https://openai.com/index/sora-2/', 'https://en.wikipedia.org/wiki/Foo_(bar)', 'https://arxiv.org/abs/2410.00001', 'http://example.com/a?b=1&c=2']);
  // Each starts where the text has it, so the reader can cut the text around it.
  for (const u of found) assert.equal(notes.slice(u.at, u.at + u.url.length), u.url);
  assert.deepEqual(bareUrls('no links here'), []);
});
