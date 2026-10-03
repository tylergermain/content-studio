// The channels a floor watches: reading a YouTube link (shared/youtube.ts), a channel's feed and its
// page (server/watch.ts), its page of videos while the feeds are off (server/watch-page.ts, against
// pages YouTube really sent, trimmed, in tests/fixtures/youtube), what a floor's setup keeps of them
// (shared/studio.ts), and what a screen set to them plays, in what order (client/features/screens/watchlist.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WATCH_MEDIA, cleanFurniture } from '../src/shared/furniture.js';
import { LIMITS, cleanSetup } from '../src/shared/studio.js';
import { CHANNEL_ID, YOUTUBE_ID, channelLink, youtubeId } from '../src/shared/youtube.js';
import type { WatchVideo } from '../src/shared/protocol.js';
import type { Floor } from '../src/server/floor.js';
import { Studio } from '../src/server/studio.js';
import { KEEP, Watch, channelIdIn, feedUrl, newest, parseFeed } from '../src/server/watch.js';
import { ageOf, initialData, parseVideosPage, videosUrl } from '../src/server/watch-page.js';
import { BAD_FOR, ago, fresh, labelOf, nextVideo, playable, startAt } from '../src/client/features/screens/watchlist.js';

const UC = 'UCXuqSBlHAE6Xw-yeJA0Tunw';
const UC2 = 'UCBJycsmduvYEL83R_U4JriQ';

test('the video id in a YouTube link, however it is written', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `http://m.youtube.com/watch?feature=share&v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=PL123`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}?start=3`,
    `youtube.com/watch?v=${id}`,
    `  youtu.be/${id}  `,
  ])
    assert.equal(youtubeId(link), id, link);
  assert.ok(YOUTUBE_ID.test(id));
});

test('what is not a YouTube video link has no video id', () => {
  for (const link of [
    '',
    'dQw4w9WgXcQ',
    'https://www.youtube.com/',
    'https://www.youtube.com/@mkbhd',
    `https://www.youtube.com/channel/${UC}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQtoolong',
    'https://youtu.be/',
    'https://vimeo.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/youtu.be/dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ and more',
  ])
    assert.equal(youtubeId(link), undefined, link);
});

test('a pasted link says which channel it is, or which page of YouTube says', () => {
  assert.deepEqual(channelLink(`https://www.youtube.com/channel/${UC}`), { kind: 'channel', id: UC, url: `https://www.youtube.com/channel/${UC}` });
  assert.deepEqual(channelLink(`youtube.com/channel/${UC}/videos`), { kind: 'channel', id: UC, url: `https://www.youtube.com/channel/${UC}` });
  assert.ok(CHANNEL_ID.test(UC));
  // A handle, a custom name and a legacy user name: a page to read the channel's id from, always on www.youtube.com.
  assert.deepEqual(channelLink('https://www.youtube.com/@mkbhd'), { kind: 'page', url: 'https://www.youtube.com/@mkbhd' });
  assert.deepEqual(channelLink('https://m.youtube.com/@mkbhd/videos?view=0'), { kind: 'page', url: 'https://www.youtube.com/@mkbhd' });
  assert.deepEqual(channelLink('youtube.com/@Some.Name-1'), { kind: 'page', url: 'https://www.youtube.com/@Some.Name-1' });
  assert.deepEqual(channelLink('https://www.youtube.com/c/Veritasium'), { kind: 'page', url: 'https://www.youtube.com/c/Veritasium' });
  assert.deepEqual(channelLink('https://www.youtube.com/user/marquesbrownlee'), { kind: 'page', url: 'https://www.youtube.com/user/marquesbrownlee' });
  // One of its videos, in any of the ways a video is linked.
  assert.deepEqual(channelLink('https://youtu.be/dQw4w9WgXcQ?si=x'), { kind: 'page', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.deepEqual(channelLink('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { kind: 'page', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  // A handle in another script is kept, escaped.
  assert.equal(channelLink('https://www.youtube.com/@%E3%83%86%E3%82%B9%E3%83%88')?.url, 'https://www.youtube.com/@%E3%83%86%E3%82%B9%E3%83%88');
});

test('anything that is not a YouTube channel or video link is refused', () => {
  for (const link of [
    '',
    'mkbhd',
    '@mkbhd',
    'https://www.youtube.com/',
    'https://www.youtube.com/feed/trending',
    'https://www.youtube.com/channel/not-a-channel-id',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/results?search_query=x',
    'https://example.com/@mkbhd',
    'https://youtube.com.evil.example/@mkbhd',
    'https://evil.example/?next=https://www.youtube.com/@mkbhd',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:4600/@x',
    'file:///etc/passwd',
    'https://www.youtube.com/@',
    'https://www.youtube.com/%E0%A4%A',
  ])
    assert.equal(channelLink(link), undefined, link);
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${UC}"/>
 <id>yt:channel:XuqSBlHAE6Xw-yeJA0Tunw</id>
 <yt:channelId>XuqSBlHAE6Xw-yeJA0Tunw</yt:channelId>
 <title>Linus &amp; Friends</title>
 <link rel="alternate" href="https://www.youtube.com/channel/${UC}"/>
 <author>
  <name>Linus &amp; Friends</name>
  <uri>https://www.youtube.com/channel/${UC}</uri>
 </author>
 <published>2008-11-25T00:46:52+00:00</published>
 <entry>
  <id>yt:video:AAAAAAAAAA1</id>
  <yt:videoId>AAAAAAAAAA1</yt:videoId>
  <yt:channelId>${UC}</yt:channelId>
  <title>I&#39;m &quot;done&quot; with &lt;this&gt; &#x1F600;</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAA1"/>
  <author>
   <name>Linus &amp; Friends</name>
   <uri>https://www.youtube.com/channel/${UC}</uri>
  </author>
  <published>2026-09-30T17:00:05+00:00</published>
  <updated>2026-10-01T02:11:40+00:00</updated>
  <media:group>
   <media:title>The media title, not the entry's</media:title>
   <media:content url="https://www.youtube.com/v/AAAAAAAAAA1?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i2.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg" width="480" height="360"/>
   <media:description>Lines
of description with a <title>decoy</title></media:description>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:AAAAAAAAAA2</id>
  <yt:videoId>AAAAAAAAAA2</yt:videoId>
  <title><![CDATA[A Short & sweet]]></title>
  <link rel="alternate" href="https://www.youtube.com/shorts/AAAAAAAAAA2"/>
  <author><name>Linus &amp; Friends</name></author>
  <published>2026-10-01T09:30:00+00:00</published>
 </entry>
 <entry>
  <id>yt:video:AAAAAAAAAA3</id>
  <title>Only an id, and single quotes on its link</title>
  <link href='https://www.youtube.com/watch?v=AAAAAAAAAA3' rel='alternate'/>
  <published>2026-09-01T00:00:00Z</published>
 </entry>
 <entry>
  <yt:videoId>not-an-id</yt:videoId>
  <title>Left out: its id is no video id</title>
  <published>2026-10-01T10:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>AAAAAAAAAA4</yt:videoId>
  <title>Left out: no date</title>
 </entry>
 <entry>
  <yt:videoId>AAAAAAAAAA1</yt:videoId>
  <title>Left out: a second copy of the first</title>
  <published>2026-09-30T17:00:05+00:00</published>
 </entry>
</feed>`;

test('a channel’s feed gives its name and its videos, newest first', () => {
  const feed = parseFeed(FEED);
  assert.equal(feed.name, 'Linus & Friends');
  assert.deepEqual(
    feed.videos.map((v) => v.id),
    ['AAAAAAAAAA2', 'AAAAAAAAAA1', 'AAAAAAAAAA3'],
  );
  const [short, first, bare] = feed.videos;
  assert.deepEqual(first, { id: 'AAAAAAAAAA1', title: 'I\'m "done" with <this> 😀', channel: 'Linus & Friends', at: Date.parse('2026-09-30T17:00:05+00:00'), short: false });
  assert.deepEqual(short, { id: 'AAAAAAAAAA2', title: 'A Short & sweet', channel: 'Linus & Friends', at: Date.parse('2026-10-01T09:30:00+00:00'), short: true });
  // No author of its own: the channel's name. No yt:videoId: the id's.
  assert.deepEqual(bare, { id: 'AAAAAAAAAA3', title: 'Only an id, and single quotes on its link', channel: 'Linus & Friends', at: Date.parse('2026-09-01T00:00:00Z'), short: false });
});

test('a feed that is cut short, empty, or not a feed at all still parses', () => {
  // Cut off in the middle of the second entry: the first is whole, and the second has enough to count.
  const cut = FEED.slice(0, FEED.indexOf('<published>2026-10-01T09:30:00+00:00</published>') + '<published>2026-10-01T09:30:00+00:00</published>'.length);
  assert.deepEqual(
    parseFeed(cut).videos.map((v) => v.id),
    ['AAAAAAAAAA2', 'AAAAAAAAAA1'],
  );
  assert.deepEqual(parseFeed(FEED.slice(0, FEED.indexOf('<entry>'))), { name: 'Linus & Friends', videos: [] });
  assert.deepEqual(parseFeed(''), { name: '', videos: [] });
  assert.deepEqual(parseFeed('<!doctype html><html><head><title>404 Not Found</title></head><body>nope</body></html>').videos, []);
  // Control characters and line breaks in a title come out as spaces, and a title is never endless.
  const odd = parseFeed(`<feed><title>C</title><entry><yt:videoId>BBBBBBBBBB1</yt:videoId><title>a\u0000b\n\tc&#8232;d ${'x'.repeat(500)}</title><published>2026-01-01T00:00:00Z</published></entry></feed>`);
  assert.ok(odd.videos[0].title.startsWith('a b c d xxx'));
  assert.equal(odd.videos[0].title.length, 200);
  // An entry with no title still plays.
  assert.equal(parseFeed('<feed><entry><yt:videoId>BBBBBBBBBB2</yt:videoId><published>2026-01-01T00:00:00Z</published></entry></feed>').videos[0].title, 'Untitled');
});

test('the channel a page of YouTube’s is about', () => {
  // A channel's own page: its canonical link, whatever other channels it features.
  assert.equal(channelIdIn(`<html><head><script>{"channelId":"${UC2}"}</script><link rel="canonical" href="https://www.youtube.com/channel/${UC}"></head></html>`), UC);
  assert.equal(channelIdIn(`<link href="https://www.youtube.com/channel/${UC}" rel="canonical">`), UC);
  assert.equal(channelIdIn(`var ytInitialData = {"featured":{"channelId":"${UC2}"},"metadata":{"channelMetadataRenderer":{"title":"X","externalId":"${UC}"}}};`), UC);
  // A video's page: the channel that put it out.
  assert.equal(channelIdIn(`<link rel="canonical" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">{"microformat":{"playerMicroformatRenderer":{"externalChannelId":"${UC}"}}}`), UC);
  assert.equal(channelIdIn(`<meta itemprop="channelId" content="${UC}">`), UC);
  assert.equal(channelIdIn(`{"videoDetails":{"videoId":"dQw4w9WgXcQ","channelId":"${UC}","author":"X"}}`), UC);
  assert.equal(channelIdIn('<html><body>Before you continue to YouTube</body></html>'), undefined);
  assert.equal(channelIdIn('{"channelId":"UCtooshort"}'), undefined);
  assert.equal(feedUrl(UC), `https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`);
});

const vid = (id: string, at: number, channel = 'A', short = false): WatchVideo => ({ id: id.padEnd(11, '_'), title: `Video ${id}`, channel, at, short });
const ids = (list: readonly WatchVideo[]) => list.map((v) => v.id.replace(/_+$/, ''));

test('a floor is sent the newest videos across its channels, each once', () => {
  const a = [vid('a3', 300), vid('a2', 200), vid('a1', 100)];
  const b = [vid('b3', 250, 'B'), vid('b2', 150, 'B'), vid('a2', 200)];
  assert.deepEqual(ids(newest([...a, ...b])), ['a3', 'b3', 'a2', 'b2', 'a1']);
  assert.deepEqual(ids(newest([...a, ...b], 2)), ['a3', 'b3']);
  const many = Array.from({ length: 50 }, (_, i) => vid(`v${i}`, i));
  assert.equal(newest(many).length, KEEP);
  assert.equal(newest(many)[0].id, vid('v49', 0).id);
});

test('what a floor watches, as the office says it with nothing read yet', () => {
  const watch = new Watch({ floors: () => [], watch: () => assert.fail('nothing to tell'), studio: () => assert.fail('nothing to tell') });
  assert.deepEqual(watch.state([]), { videos: [], at: 0 });
  assert.deepEqual(watch.state([{ id: UC, name: '', url: `https://www.youtube.com/channel/${UC}` }, { id: '', name: '', url: 'https://www.youtube.com/@mkbhd' }]), { videos: [], at: 0 });
});

test('a floor’s setup keeps the channels that are YouTube links, each once, and no more than it takes', () => {
  const setup = cleanSetup({
    watch: {
      channels: [
        { url: 'https://www.youtube.com/@mkbhd', id: UC, name: '  Marques\nBrownlee ' },
        { url: 'youtube.com/@mkbhd/videos' },
        `https://www.youtube.com/channel/${UC2}`,
        { url: `https://www.youtube.com/channel/${UC2}`, id: UC, name: 'A lie about which channel' },
        { url: 'https://www.youtube.com/@other', id: 'not-an-id' },
        { url: 'https://www.youtube.com/@same-channel-again', id: UC },
        { url: 'https://example.com/@mkbhd' },
        { url: 'javascript:alert(1)' },
        { id: UC },
        null,
        42,
      ],
    },
  });
  assert.deepEqual(setup.watch, {
    channels: [
      { id: UC, name: 'Marques Brownlee', url: 'https://www.youtube.com/@mkbhd' },
      // A /channel/ link says which channel it is itself, whatever id came with it.
      { id: UC2, name: '', url: `https://www.youtube.com/channel/${UC2}` },
      { id: '', name: '', url: 'https://www.youtube.com/@other' },
    ],
  });
  assert.equal(cleanSetup({}).watch, undefined);
  assert.equal(cleanSetup({ watch: { channels: [] } }).watch, undefined);
  assert.equal(cleanSetup({ watch: { channels: 'https://www.youtube.com/@mkbhd' } }).watch, undefined);
  const many = cleanSetup({ watch: { channels: Array.from({ length: 40 }, (_, i) => ({ url: `https://www.youtube.com/@channel${i}` })) } });
  assert.equal(many.watch?.channels.length, LIMITS.channels);
  // The rest of a setup is untouched by it.
  assert.deepEqual(cleanSetup({ ticker: { symbols: ['aapl'] }, watch: { channels: [{ url: 'youtu.be/dQw4w9WgXcQ' }] } }), { boards: {}, agents: {}, ticker: { symbols: ['AAPL'] }, watch: { channels: [{ id: '', name: '', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] } });
});

test('a screen can be set to the channels the floor watches, and to nothing else that is not a file’s name', () => {
  const piece = (media: unknown) => {
    const out = cleanFurniture([{ id: 'screen-1', kind: 'wall-screen', x: 0, z: 0, rotY: 0, media }]);
    assert.ok(Array.isArray(out), String(out));
    return out[0].media;
  };
  assert.equal(WATCH_MEDIA, '@watch');
  assert.equal(piece(WATCH_MEDIA), WATCH_MEDIA);
  assert.equal(piece('clip.mp4'), 'clip.mp4');
  for (const bad of ['@watch2', '@other', '@', ' @watch', '../x.mp4', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 42, null]) assert.equal(piece(bad), undefined, String(bad));
  // Only on a kind that plays.
  const sofa = cleanFurniture([{ id: 'sofa-1', kind: 'sofa', x: 0, z: 0, rotY: 0, media: WATCH_MEDIA }]);
  assert.ok(Array.isArray(sofa) && sofa[0].media === undefined);
});

test('screens start on different videos, the first on the newest', () => {
  assert.deepEqual([0, 1, 2, 3].map((slot) => startAt(slot, 3)), [0, 1, 2, 0]);
  assert.deepEqual([0, 1, 2].map((slot) => startAt(slot, 1)), [0, 0, 0]);
  assert.equal(startAt(2, 0), 0);
});

test('a screen plays newest first, on to the next when one ends, and round again', () => {
  const list = [vid('c', 300), vid('b', 200), vid('a', 100)];
  const order: string[] = [];
  let on: WatchVideo | undefined = list[startAt(0, list.length)];
  for (let i = 0; i < 5; i++) {
    order.push(ids([on!])[0]);
    on = nextVideo(list, on!.id);
  }
  assert.deepEqual(order, ['c', 'b', 'a', 'c', 'b']);
  // Its video has dropped off the list (thirty newer ones came out): the newest.
  assert.equal(nextVideo(list, 'gone_______'), list[0]);
  assert.equal(nextVideo(list, undefined), list[0]);
  assert.equal(nextVideo([], 'x'), undefined);
  // One video: it again.
  assert.equal(nextVideo([list[0]], list[0].id), list[0]);
});

test('whenever a new video appears, the screens go back to the newest', () => {
  const before = [vid('b', 200), vid('a', 100)];
  assert.equal(fresh(before, [vid('c', 300), ...before]), true);
  assert.equal(fresh([], before), true);
  // The same list read again, one dropping off the end, or an older one joining (a channel added): nothing new at the top.
  assert.equal(fresh(before, before), false);
  assert.equal(fresh(before, [before[0]]), false);
  assert.equal(fresh(before, [before[0], vid('z', 150), before[1]]), false);
  assert.equal(fresh(before, []), false);
});

test('a video that will not play is left out for a while, and all of them play again when none will', () => {
  const list = [vid('c', 300), vid('b', 200), vid('a', 100)];
  const now = 1_000_000_000;
  const bad = new Map([[list[1].id, now - 1000]]);
  assert.deepEqual(ids(playable(list, bad, now)), ['c', 'a']);
  // Long enough ago: it's tried again.
  assert.deepEqual(ids(playable(list, bad, now + BAD_FOR)), ['c', 'b', 'a']);
  const all = new Map(list.map((v) => [v.id, now]));
  assert.deepEqual(ids(playable(list, all, now)), ['c', 'b', 'a']);
  assert.deepEqual(playable([], all, now), []);
});

test('the line under a video says who, what and how long ago', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const h = 3_600_000;
  assert.equal(ago(now - 20_000, now), 'just now');
  assert.equal(ago(now + 5000, now), 'just now');
  assert.equal(ago(now - 5 * 60_000, now), '5m ago');
  assert.equal(ago(now - 2 * h, now), '2h ago');
  assert.equal(ago(now - 23.9 * h, now), '23h ago');
  assert.equal(ago(now - 3 * 24 * h, now), '3d ago');
  assert.equal(ago(now - 21 * 24 * h, now), '3w ago');
  assert.equal(ago(now - 90 * 24 * h, now), '3mo ago');
  assert.equal(ago(now - 800 * 24 * h, now), '2y ago');
  assert.equal(labelOf({ id: 'AAAAAAAAAA1', title: 'The new thing', channel: 'A Channel', at: now - 2 * h, short: false }, now), 'A Channel · The new thing · 2h ago');
});

// ---- The office reading YouTube (server/watch.ts), with YouTube played by a stand-in for fetch ----

/** A floor with a setup of its own and nothing else, which is all the office's watching asks of one. */
function floorWatching(id: string, links: string[]): Floor {
  const studio = new Studio(mkdtempSync(path.join(tmpdir(), 'office-watch-')));
  studio.configure({ watch: { channels: links.map((url) => ({ url })) } });
  return { id, studio } as unknown as Floor;
}

/** Stands in for YouTube: `pages` by address, each a body, or a status with a body or where it sends you. What was asked for is kept. */
function youtube(pages: Record<string, string | { status: number; location?: string; body?: string }>) {
  const asked: { url: string; redirect?: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, redirect: init?.redirect });
    const page = pages[url];
    if (page === undefined) return new Response('nothing here', { status: 404 });
    if (typeof page === 'string') return new Response(page);
    return new Response(page.body ?? null, { status: page.status, headers: page.location ? { location: page.location } : {} });
  }) as typeof fetch;
  return { asked, restore: () => void (globalThis.fetch = real) };
}

const asked = (yt: { asked: { url: string }[] }) => yt.asked.map((a) => a.url);

/** Has the office read what `floors` watch, and waits until it has told every one of them. */
async function readFor(floors: Floor[]): Promise<{ watch: Watch; told: string[]; renamed: string[] }> {
  const told: string[] = [];
  const renamed: string[] = [];
  const watch = new Watch({ floors: () => floors, watch: (f) => told.push(f.id), studio: (f) => renamed.push(f.id) });
  watch.refresh();
  for (let i = 0; i < 200 && told.length < floors.length; i++) await new Promise((r) => setTimeout(r, 5));
  return { watch, told, renamed };
}

test('the office finds which channel a link is, reads its feed, and tells the floor', async () => {
  const yt = youtube({
    'https://www.youtube.com/@linus': `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${UC}"></head></html>`,
    [feedUrl(UC)]: FEED,
  });
  try {
    const floor = floorWatching('one', ['youtube.com/@linus']);
    const { watch, told, renamed } = await readFor([floor]);
    assert.deepEqual(told, ['one']);
    // Once for which channel it is, once for what it's called.
    assert.deepEqual(renamed, ['one', 'one']);
    assert.deepEqual(floor.studio.watching(), [{ id: UC, name: 'Linus & Friends', url: 'https://www.youtube.com/@linus' }]);
    const state = watch.state(floor.studio.watching());
    assert.deepEqual(
      state.videos.map((v) => v.id),
      ['AAAAAAAAAA2', 'AAAAAAAAAA1', 'AAAAAAAAAA3'],
    );
    assert.equal(state.errors, undefined);
    assert.ok(state.at > 0);
    // Only YouTube was asked, and never to be followed anywhere by itself.
    assert.deepEqual(asked(yt), ['https://www.youtube.com/@linus', feedUrl(UC)]);
    assert.ok(yt.asked.every((a) => a.redirect === 'manual'));
    // What was found is saved with the floor's setup: the next office to open reads the feed straight away.
    assert.equal(floor.studio.state().setup.watch?.channels[0].id, UC);
  } finally {
    yt.restore();
  }
});

test('a link YouTube sends somewhere else is not followed there', async () => {
  const yt = youtube({
    'https://www.youtube.com/@elsewhere': { status: 302, location: 'https://evil.example/steal' },
    'https://www.youtube.com/@local': { status: 302, location: 'http://127.0.0.1:4600/api/me' },
    'https://www.youtube.com/@consent': { status: 302, location: 'https://consent.youtube.com/m?continue=x' },
    'https://www.youtube.com/@moved': { status: 301, location: '/@linus' },
    'https://www.youtube.com/@linus': `<link rel="canonical" href="https://www.youtube.com/channel/${UC}">`,
    'https://www.youtube.com/@round': { status: 302, location: 'https://www.youtube.com/@round' },
    [feedUrl(UC)]: FEED,
  });
  try {
    const floor = floorWatching('one', ['youtube.com/@elsewhere', 'youtube.com/@local', 'youtube.com/@consent', 'youtube.com/@moved', 'youtube.com/@round', 'youtube.com/@nothing-here']);
    const { watch } = await readFor([floor]);
    assert.ok(!asked(yt).some((url) => !url.startsWith('https://www.youtube.com/')), asked(yt).join(' '));
    const state = watch.state(floor.studio.watching());
    assert.match(state.errors?.['https://www.youtube.com/@elsewhere'] ?? '', /isn’t YouTube/);
    assert.match(state.errors?.['https://www.youtube.com/@local'] ?? '', /isn’t YouTube/);
    assert.match(state.errors?.['https://www.youtube.com/@consent'] ?? '', /cookies/);
    assert.match(state.errors?.['https://www.youtube.com/@round'] ?? '', /kept sending/);
    assert.match(state.errors?.['https://www.youtube.com/@nothing-here'] ?? '', /nothing at that link/);
    // A move within YouTube is followed, and the channel found.
    assert.equal(floor.studio.watching().find((c) => c.url === 'https://www.youtube.com/@moved')?.id, UC);
    assert.equal(state.videos.length, 3);
  } finally {
    yt.restore();
  }
});

test('a feed that cannot be read says why, and what it had out stays up', async () => {
  const link = `https://www.youtube.com/channel/${UC}`;
  const yt = youtube({ [feedUrl(UC)]: FEED });
  try {
    const floor = floorWatching('one', [link]);
    const { watch, told } = await readFor([floor]);
    assert.equal(watch.state(floor.studio.watching()).videos.length, 3);
    // The same again is not news.
    assert.deepEqual(told, ['one']);
    // YouTube goes away, feed and page: a minute later (when it's due again) the office says so, and keeps the videos.
    yt.restore();
    const down = youtube({ [feedUrl(UC)]: { status: 500 }, [videosUrl(UC)]: { status: 500 } });
    try {
      const now = Date.now;
      Date.now = () => now() + 120_000;
      try {
        watch.refresh();
        for (let i = 0; i < 200 && told.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
      } finally {
        Date.now = now;
      }
      const state = watch.state(floor.studio.watching());
      assert.deepEqual(told, ['one', 'one']);
      assert.equal(state.errors?.[link], 'YouTube answered 500');
      assert.equal(state.videos.length, 3);
    } finally {
      down.restore();
    }
  } finally {
    yt.restore();
  }
});

test('two floors that watch the same channel share one read of it, and a floor that watches none is told nothing', async () => {
  const link = `https://www.youtube.com/channel/${UC}`;
  const yt = youtube({ [feedUrl(UC)]: FEED });
  try {
    const floors = [floorWatching('one', [link]), floorWatching('two', [link])];
    const idle = floorWatching('idle', []);
    const told: string[] = [];
    const watch = new Watch({ floors: () => [...floors, idle], watch: (f) => told.push(f.id), studio: () => {} });
    watch.refresh();
    for (let i = 0; i < 200 && told.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(told.sort(), ['one', 'two']);
    assert.deepEqual(asked(yt), [feedUrl(UC)]);
    assert.deepEqual(watch.state(idle.studio.watching()), { videos: [], at: 0 });
  } finally {
    yt.restore();
  }
});

// ---- A channel's page of videos (server/watch-page.ts), read while YouTube's feeds are off ----

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', 'youtube', name), 'utf8');
/** youtube.com/channel/UC2ojq-nuP8ceeHqiroeKhBA/videos as YouTube sent it on 2026-10-03, its grid cut to the first seven videos. */
const PAGE = fixture('channel-videos.html');
/** What feeds/videos.xml?channel_id=… answered for every channel that day, with a 404. */
const GONE = fixture('feed-404.html');
const NATE = 'UC2ojq-nuP8ceeHqiroeKhBA';
const NATES = ['9hetShMMp2s', 'l8ywUsEJ2XQ', 'pY5_Ux_YJjo', 'BvvfZKKz4Yo', '7eo-11K2e3c', 'eg_1NXDcoPk', 'Ktnwygcnd8U'];
const H = 3_600_000;
const D = 24 * H;
const MINUTE = 60_000;

test('a channel’s page of videos gives its name and its videos, newest first, dated by how long ago each came out', () => {
  const now = Date.parse('2026-10-03T06:21:00Z');
  const page = parseVideosPage(PAGE, now);
  assert.ok(page);
  assert.equal(page.name, 'Nate Herk | AI Automation');
  assert.deepEqual(
    page.videos.map((v) => v.id),
    NATES,
  );
  // "8h ago", "11h ago", "1d ago", "2d ago", "4d ago" twice (a second apart, in the page's order), "5d ago".
  assert.deepEqual(
    page.videos.map((v) => now - v.at),
    [8 * H, 11 * H, D, 2 * D, 4 * D, 4 * D + 1000, 5 * D],
  );
  assert.deepEqual(page.videos[0], { id: '9hetShMMp2s', title: 'Claude Code Mods Are Game Changers. Set Up These 5 NOW.', channel: 'Nate Herk | AI Automation', at: now - 8 * H, short: false });
  // Made with another channel: its row of names is no date, and the page's channel is who it's from.
  assert.deepEqual(page.videos[1], { id: 'l8ywUsEJ2XQ', title: 'How to Actually Build & Sell Software with AI as a Non-Techie', channel: 'Nate Herk | AI Automation', at: now - 11 * H, short: false });
  assert.ok(page.videos.every((v) => !v.short && v.channel === page.name));
  // The page is found by its `ytInitialData`.
  assert.equal((initialData(PAGE)?.metadata as { channelMetadataRenderer: { externalId: string } }).channelMetadataRenderer.externalId, NATE);
  assert.equal(videosUrl(NATE), `https://www.youtube.com/channel/${NATE}/videos?hl=en`);
});

test('the same page read again keeps each video’s time while its words still allow it', () => {
  const now = Date.parse('2026-10-03T06:21:00Z');
  const first = parseVideosPage(PAGE, now)!.videos;
  // Ten minutes and half an hour later each says what it said, so nothing has changed to tell a floor.
  assert.deepEqual(parseVideosPage(PAGE, now + 10 * MINUTE, first)!.videos, first);
  assert.deepEqual(parseVideosPage(PAGE, now + 30 * MINUTE, first)!.videos, first);
  // Not told what it had, the times would move with the clock.
  assert.notDeepEqual(parseVideosPage(PAGE, now + 10 * MINUTE)!.videos, first);
  // Two hours on, a video that still says "8h ago" came out later than it was given: the newest time
  // the words allow again. The ones that say days still fit what they were given.
  const later = parseVideosPage(PAGE, now + 2 * H, first)!.videos;
  assert.deepEqual(
    later.slice(0, 2).map((v) => now - v.at),
    [6 * H, 9 * H],
  );
  assert.deepEqual(later.slice(2), first.slice(2));
  // A time from the feed (to the second) stays, as long as the page's words allow it.
  const exact = [{ ...first[2], at: now - 30 * H }];
  assert.equal(parseVideosPage(PAGE, now, exact)!.videos[2].at, now - 30 * H);
  assert.equal(parseVideosPage(PAGE, now, [{ ...first[2], at: now - 3 * D }])!.videos[2].at, now - D);
});

test('how long ago a video came out, as YouTube’s page says it', () => {
  const nbsp = String.fromCharCode(0xa0);
  const cases: [string, number, number][] = [
    ['8 hours ago', 8 * H, 9 * H],
    ['8h ago', 8 * H, 9 * H],
    ['1 hour ago', H, 2 * H],
    ['an hour ago', H, 2 * H],
    ['5m ago', 5 * MINUTE, 6 * MINUTE],
    ['5 minutes ago', 5 * MINUTE, 6 * MINUTE],
    ['45 seconds ago', 45_000, 46_000],
    ['1d ago', D, 2 * D],
    ['1 day ago', D, 2 * D],
    [`3${nbsp}days ago`, 3 * D, 4 * D],
    ['2w ago', 14 * D, 21 * D],
    ['2 weeks ago', 14 * D, 21 * D],
    ['1 month ago', 30 * D, 60 * D],
    ['5mo ago', 150 * D, 180 * D],
    ['2 years ago', 730 * D, 1095 * D],
    ['1y ago', 365 * D, 730 * D],
    ['Streamed 2 days ago', 2 * D, 3 * D],
    ['Streamed live 3 hours ago', 3 * H, 4 * H],
    ['Premiered 6 days ago', 6 * D, 7 * D],
  ];
  for (const [text, least, most] of cases) assert.deepEqual(ageOf(text), { least, most }, text);
  for (const text of ['', 'ago', 'Premieres 10/5/26, 7:00 PM', 'Scheduled for 10/9/26, 12:00 PM', 'Streaming now', '1.2K watching', '40K views', '40 thousand views', 'I quit 3 years ago', '8 hours ago, again', 'vor 8 Stunden', 'il y a 2 jours', 'Streamed live on Oct 1, 2026'])
    assert.equal(ageOf(text), undefined, text);
});

/** A page of YouTube's with `data` as its `ytInitialData`, written the way `how` says. */
const pageOf = (data: unknown, how = 'var ytInitialData = ') => `<!DOCTYPE html><html><body><script nonce="n">${how}${JSON.stringify(data)};</script></body></html>`;
/** A grid item as the Videos tab writes one (a `lockupViewModel`), cut to what the office reads. */
const lockup = (id: string, title: string, said: string | undefined, kind = 'LOCKUP_CONTENT_TYPE_VIDEO', url = `/watch?v=${id}`, endpoint: object = { watchEndpoint: { videoId: id } }) => ({
  richItemRenderer: {
    content: {
      lockupViewModel: {
        metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '1.2K' }, accessibilityLabel: '1.2 thousand views' }, ...(said ? [{ text: { content: said } }] : [])] }] } } } },
        contentId: id,
        contentType: kind,
        rendererContext: { accessibilityContext: { label: `${title} 10 minutes` }, commandContext: { onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url } }, ...endpoint } } } },
      },
    },
  },
});

test('what a page of videos says, in whichever of YouTube’s shapes it is written', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const ls = String.fromCharCode(0x2028);
  const grid = [
    lockup('SSSSSSSSSS1', 'A Short with a date', '2 hours ago', 'LOCKUP_CONTENT_TYPE_SHORT', '/shorts/SSSSSSSSSS1', { reelWatchEndpoint: { videoId: 'SSSSSSSSSS1' } }),
    lockup('LLLLLLLLLL1', 'We met 3 years ago', '5 hours ago'),
    lockup('PPPPPPPPPP1', 'A playlist', '1 hour ago', 'LOCKUP_CONTENT_TYPE_PLAYLIST'),
    lockup('QQQQQQQQQQ1', 'A première', 'Premieres 10/9/26, 12:00 PM'),
    lockup('TTTTTTTTTT1', '2 hours ago', undefined),
    lockup('not-an-id', 'No video id', '1 hour ago'),
    lockup('LLLLLLLLLL1', 'The same again', '5 hours ago'),
    { richItemRenderer: { content: { shortsLockupViewModel: { entityId: 'shorts-shelf-item-UUUUUUUUUU1', overlayMetadata: { primaryText: { content: 'An undated Short' }, secondaryText: { content: '1.2K views' } }, onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'UUUUUUUUUU1' } } } } } } },
    { videoRenderer: { videoId: 'VVVVVVVVVV1', title: { runs: [{ text: 'Line\nbreak\u0000and ' }, { text: 'x'.repeat(300) }] }, publishedTimeText: { simpleText: 'Streamed 1 day ago' } } },
    { gridVideoRenderer: { videoId: 'GGGGGGGGGG1', title: { simpleText: 'An older grid' }, publishedTimeText: { simpleText: '3 days ago' } } },
    { continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN' } },
  ];
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          { tabRenderer: { title: 'Home', content: { sectionListRenderer: { contents: [lockup('HHHHHHHHHH1', 'On the home tab, not the one open', '1 minute ago')] } } } },
          // The grid wrapped differently from today's: still found.
          { tabRenderer: { title: 'Videos', selected: true, content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ gridRenderer: { items: grid } }] } }] } } } },
          { expandableTabRenderer: { title: '' } },
        ],
      },
    },
    metadata: { channelMetadataRenderer: { title: `Some${ls}Channel`, externalId: UC } },
  };
  const want = (page: ReturnType<typeof parseVideosPage>) => {
    assert.ok(page);
    assert.equal(page.name, 'Some Channel');
    assert.deepEqual(
      page.videos.map((v) => [v.id, now - v.at, v.short]),
      [
        ['SSSSSSSSSS1', 2 * H, true],
        ['LLLLLLLLLL1', 5 * H, false],
        ['VVVVVVVVVV1', D, false],
        ['GGGGGGGGGG1', 3 * D, false],
      ],
    );
    // Its title is never taken for its date, and a title is one line and never endless.
    assert.equal(page.videos[1].title, 'We met 3 years ago');
    assert.ok(page.videos[2].title.startsWith('Line break and xxx'));
    assert.equal(page.videos[2].title.length, 200);
    assert.equal(page.videos[3].title, 'An older grid');
  };
  want(parseVideosPage(pageOf(data), now));
  want(parseVideosPage(pageOf(data, 'window["ytInitialData"] = '), now));
  // Something that only looks like it first, then the real one.
  want(parseVideosPage(`<script>var ytcfg = "ytInitialData = {"; window.ytInitialData = {not json};</script>${pageOf(data)}`, now));
  // No tabs at all: whatever the page shows.
  assert.deepEqual(
    parseVideosPage(pageOf({ contents: { richGridRenderer: { contents: grid.slice(0, 2) } } }), now)?.videos.map((v) => v.id),
    ['SSSSSSSSSS1', 'LLLLLLLLLL1'],
  );
});

test('a page with no ytInitialData, or one cut short, has nothing to read', () => {
  const now = Date.now();
  assert.equal(parseVideosPage('', now), undefined);
  assert.equal(parseVideosPage('<html><body>Before you continue to YouTube</body></html>', now), undefined);
  assert.equal(parseVideosPage(GONE, now), undefined);
  assert.equal(parseVideosPage(PAGE.slice(0, Math.floor(PAGE.length / 2)), now), undefined);
  assert.equal(parseVideosPage(pageOf([1, 2, 3]), now), undefined);
  // Found, with nothing in it: no videos.
  assert.deepEqual(parseVideosPage(pageOf({ contents: {} }), now), { name: '', videos: [] });
});

/** Waits (a little at a time, up to a second) until `done` says so. */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
}

/** Runs `fn` with the office's clock `ms` ahead. */
async function ahead(ms: number, fn: () => Promise<void>) {
  const now = Date.now;
  Date.now = () => now() + ms;
  try {
    await fn();
  } finally {
    Date.now = now;
  }
}

test('while YouTube’s feeds answer 404, a channel is read from its page of videos, and its feed tried again an hour on', async () => {
  const link = `https://www.youtube.com/channel/${NATE}`;
  const pages: Record<string, string | { status: number; body?: string }> = { [feedUrl(NATE)]: { status: 404, body: GONE }, [videosUrl(NATE)]: PAGE };
  const yt = youtube(pages);
  try {
    const floor = floorWatching('one', [link]);
    const { watch, told, renamed } = await readFor([floor]);
    assert.deepEqual(told, ['one']);
    assert.deepEqual(renamed, ['one']);
    assert.deepEqual(floor.studio.watching(), [{ id: NATE, name: 'Nate Herk | AI Automation', url: link }]);
    const state = watch.state(floor.studio.watching());
    assert.equal(state.errors, undefined);
    assert.deepEqual(
      state.videos.map((v) => v.id),
      NATES,
    );
    const age = Date.now() - state.videos[0].at;
    assert.ok(age >= 8 * H && age < 8 * H + 5000, String(age));
    assert.deepEqual(asked(yt), [feedUrl(NATE), videosUrl(NATE)]);
    assert.ok(yt.asked.every((a) => a.redirect === 'manual'));

    // Due again two minutes on: the page alone, the feeds being off, and the same videos at the same times are no news.
    await ahead(2 * MINUTE, async () => {
      watch.refresh();
      await until(() => yt.asked.length >= 3);
    });
    assert.deepEqual(asked(yt).slice(2), [videosUrl(NATE)]);
    assert.deepEqual(told, ['one']);
    assert.deepEqual(watch.state(floor.studio.watching()).videos, state.videos);

    // An hour on, the feed is tried first again, and it's back: the page isn't read.
    pages[feedUrl(NATE)] = `<feed><title>Nate Herk | AI Automation</title><entry><yt:videoId>9hetShMMp2s</yt:videoId><title>From the feed</title><published>2026-10-02T22:21:00+00:00</published></entry></feed>`;
    await ahead(61 * MINUTE, async () => {
      watch.refresh();
      await until(() => told.length >= 2);
    });
    assert.deepEqual(asked(yt).slice(3), [feedUrl(NATE)]);
    assert.deepEqual(
      watch.state(floor.studio.watching()).videos.map((v) => [v.id, v.title]),
      [['9hetShMMp2s', 'From the feed']],
    );
  } finally {
    yt.restore();
  }
});

test('a channel whose page of videos cannot be read says why, on its own, and only YouTube is asked', async () => {
  const id = (n: number) => `UC${'x'.repeat(21)}${n}`;
  const yt = youtube({
    [videosUrl(id(1))]: { status: 404, body: GONE },
    [videosUrl(id(2))]: { status: 302, location: 'https://consent.youtube.com/m?continue=x' },
    [videosUrl(id(3))]: { status: 302, location: 'https://evil.example/steal' },
    [videosUrl(id(4))]: '<html><body>Before you continue to YouTube</body></html>',
    [videosUrl(id(5))]: pageOf({ contents: { richGridRenderer: { contents: [lockup('QQQQQQQQQQ1', 'A première', 'Premieres 10/9/26, 12:00 PM')] } } }),
    [videosUrl(id(6))]: { status: 500 },
    [videosUrl(NATE)]: PAGE,
  });
  try {
    const links = [1, 2, 3, 4, 5, 6].map((n) => `https://www.youtube.com/channel/${id(n)}`);
    const floor = floorWatching('one', [...links, `https://www.youtube.com/channel/${NATE}`]);
    const { watch } = await readFor([floor]);
    const { errors = {}, videos } = watch.state(floor.studio.watching());
    assert.equal(errors[links[0]], 'YouTube has nothing at that link');
    assert.equal(errors[links[1]], 'YouTube asked the office to agree to cookies before showing its videos');
    assert.match(errors[links[2]], /isn’t YouTube/);
    assert.match(errors[links[3]], /videos page has changed/);
    assert.match(errors[links[4]], /lists none the office can read/);
    assert.equal(errors[links[5]], 'YouTube answered 500');
    assert.equal(Object.keys(errors).length, 6);
    // The one that reads plays all the same.
    assert.equal(videos.length, NATES.length);
    assert.ok(!asked(yt).some((url) => !url.startsWith('https://www.youtube.com/')), asked(yt).join(' '));
    // Each fits whole on a screen's card.
    for (const e of Object.values(errors)) assert.ok(e.length <= 70, e);
  } finally {
    yt.restore();
  }
});
