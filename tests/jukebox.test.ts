import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NAME_MAX, STREAM, YOUTUBE, checkStreamUrl, jukeboxVideo, trackName, trackTitle, videoTitle, watchUrl, type JukeboxState } from '../src/shared/jukebox.js';
import { Jukebox } from '../src/server/jukebox.js';
import { lookUpVideo, oembedUrl, type Fetch } from '../src/server/jukebox-video.js';
import { MAX_DRIFT, driftOf, seekTo, startAt, videoAt } from '../src/client/features/jukebox/sync.js';

const SET = '0350Xfg-sac';
const TOPIC = { id: SET, title: 'TOPIC - Live in Bali 2025 | Afro House (Full Set)', by: 'Topic' };
const state = (s: Partial<JukeboxState>): JukeboxState => ({ on: true, track: YOUTUBE, startedAt: 0, elapsed: 0, ...s });

// ---- A pasted link ------------------------------------------------------------------------------

test('a pasted YouTube link is a video, however it is written', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${SET}`,
    `https://www.youtube.com/watch?v=${SET}&t=95s&list=PLxyz`,
    `https://youtu.be/${SET}?si=abc`,
    `https://m.youtube.com/watch?v=${SET}`,
    `https://music.youtube.com/watch?v=${SET}`,
    `https://www.youtube.com/live/${SET}`,
    `https://www.youtube.com/shorts/${SET}`,
    `https://www.youtube.com/embed/${SET}`,
    `youtube.com/watch?v=${SET}`,
    `  https://youtu.be/${SET}  `,
  ]) {
    assert.deepEqual(checkStreamUrl(link), { url: `https://www.youtube.com/watch?v=${SET}`, video: SET }, link);
  }
  assert.equal(watchUrl(SET), `https://www.youtube.com/watch?v=${SET}`);
});

test('a stream or an audio file is still a stream, and a look-alike host is not YouTube', () => {
  assert.deepEqual(checkStreamUrl('https://radio.example/stream.mp3'), { url: 'https://radio.example/stream.mp3' });
  assert.deepEqual(checkStreamUrl(`https://notyoutube.com/watch?v=${SET}`), { url: `https://notyoutube.com/watch?v=${SET}` });
  assert.deepEqual(checkStreamUrl(`https://youtube.com.evil.example/watch?v=${SET}`), { url: `https://youtube.com.evil.example/watch?v=${SET}` });
});

test('a YouTube link that names no video is turned away, not tried as a stream', () => {
  for (const link of ['https://www.youtube.com/@topic', 'https://www.youtube.com/playlist?list=PLxyz', 'https://www.youtube.com/watch?v=short', 'https://youtu.be/']) {
    const r = checkStreamUrl(link);
    assert.ok('error' in r && /doesn't name a video/.test(r.error), link);
  }
  assert.ok('error' in checkStreamUrl(''));
  assert.ok('error' in checkStreamUrl('ftp://radio.example/stream'));
  assert.ok('error' in checkStreamUrl(42));
});

// ---- What it's called ---------------------------------------------------------------------------

test('a video is called what was typed for it, else its channel; its full title goes under that', () => {
  assert.equal(trackTitle(state({ video: TOPIC, name: 'Topic' })), 'Topic');
  assert.equal(trackTitle(state({ video: TOPIC })), 'Topic');
  assert.equal(trackTitle(state({ video: TOPIC, name: 'Friday set' })), 'Friday set');
  assert.equal(videoTitle(state({ video: TOPIC, name: 'Topic' })), TOPIC.title);
  // No channel: the title is the one line there is, and it isn't said twice.
  assert.equal(trackTitle(state({ video: { ...TOPIC, by: '' } })), TOPIC.title);
  assert.equal(videoTitle(state({ video: { ...TOPIC, by: '' } })), '');
  assert.equal(trackTitle(state({})), 'A video');
});

test('a stream takes a label too, and a tune never does', () => {
  assert.equal(trackTitle({ track: STREAM, url: 'https://radio.example/live.mp3', name: 'Radio Paradise' }), 'Radio Paradise');
  assert.equal(trackTitle({ track: STREAM, url: 'https://radio.example/live.mp3' }), 'radio.example · live.mp3');
  assert.equal(trackTitle({ track: 'rainy-window', name: 'Not this' }), 'Rainy Window');
  assert.equal(videoTitle({ track: 'rainy-window' }), '');
});

test('a label is one tidy line, no longer than the display takes', () => {
  assert.equal(trackName('  Topic  '), 'Topic');
  assert.equal(trackName('Topic\n\tlive   in Bali'), 'Topic live in Bali');
  assert.equal(trackName('x'.repeat(200))?.length, NAME_MAX);
  assert.equal(trackName('   '), undefined);
  assert.equal(trackName(undefined), undefined);
  assert.equal(trackName(7), undefined);
});

test('a video off the wire or the disk has to have an id YouTube could have given', () => {
  assert.deepEqual(jukeboxVideo(TOPIC), TOPIC);
  assert.deepEqual(jukeboxVideo({ id: SET }), { id: SET, title: '', by: '' });
  assert.equal(jukeboxVideo({ id: '../../etc', title: 'x', by: 'y' }), undefined);
  assert.equal(jukeboxVideo({ title: 'x' }), undefined);
  assert.equal(jukeboxVideo(null), undefined);
  assert.equal(jukeboxVideo('0350Xfg-sac'), undefined);
});

// ---- Asking YouTube what a video is -------------------------------------------------------------

const answer = (status: number, body = ''): Fetch => async () => new Response(body, { status });

test('the lookup asks YouTube’s oEmbed about the video, and takes its title and channel', async () => {
  let asked = '';
  const get: Fetch = async (url) => {
    asked = url;
    return new Response(JSON.stringify({ title: ` ${TOPIC.title} `, author_name: 'Topic', html: '<iframe></iframe>' }), { status: 200 });
  };
  assert.deepEqual(await lookUpVideo(SET, get), TOPIC);
  assert.equal(asked, oembedUrl(SET));
  assert.equal(asked, `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${SET}`)}&format=json`);
});

test('a video that cannot be embedded, is private or is gone is refused, each with its reason', async () => {
  const why = async (get: Fetch) => {
    const r = await lookUpVideo(SET, get);
    assert.ok('error' in r);
    return r.error;
  };
  assert.match(await why(answer(401, 'Unauthorized')), /doesn't let it play on other sites/);
  assert.match(await why(answer(403, 'Forbidden')), /private/);
  assert.match(await why(answer(404, 'Not Found')), /no video at that link/);
  assert.match(await why(answer(500)), /\(500\)/);
  assert.match(await why(answer(200, '<html>not json</html>')), /made no sense/);
  assert.match(await why(answer(200, '{}')), /made no sense/);
  assert.match(await why(answer(200, `{"title":"${'x'.repeat(70_000)}"}`)), /made no sense/);
  assert.match(
    await why(async () => {
      throw new Error('offline');
    }),
    /Couldn't reach YouTube/,
  );
});

// ---- What a floor's jukebox keeps ---------------------------------------------------------------

function jukeboxDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jukebox-'));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a YouTube link is handed back to be looked up, then put on as the video with its label', () => {
  const { dir, done } = jukeboxDir();
  try {
    const j = new Jukebox(dir);
    assert.deepEqual(j.play({ url: `https://youtu.be/${SET}`, name: 'Topic' }, 'Tyler'), { video: SET });
    assert.equal(j.state().on, false, 'nothing is on until YouTube has answered');

    j.playVideo(TOPIC, '  Topic ', 'Tyler');
    const s = j.state();
    assert.deepEqual({ on: s.on, track: s.track, video: s.video, name: s.name, by: s.by, url: s.url }, { on: true, track: YOUTUBE, video: TOPIC, name: 'Topic', by: 'Tyler', url: undefined });
    assert.equal(j.title(), 'Topic');

    // It's kept: the office restarted finds the set still on, started when it was.
    const again = new Jukebox(dir).state();
    assert.deepEqual({ track: again.track, video: again.video, name: again.name, startedAt: again.startedAt }, { track: YOUTUBE, video: TOPIC, name: 'Topic', startedAt: s.startedAt });

    // Off and back on keeps the video; skip goes to the first tune and drops it.
    assert.equal(j.stop('Cy'), true);
    assert.equal(j.state().video?.id, SET);
    assert.deepEqual(j.play({}, 'Cy'), { changed: true });
    assert.deepEqual({ on: j.state().on, track: j.state().track, name: j.state().name }, { on: true, track: YOUTUBE, name: 'Topic' });
    j.skip('Cy');
    assert.deepEqual({ track: j.state().track, video: j.state().video, name: j.state().name }, { track: 'rainy-window', video: undefined, name: undefined });
  } finally {
    done();
  }
});

test('a stream keeps its label, and a saved video with a bad id is not loaded', () => {
  const { dir, done } = jukeboxDir();
  try {
    const j = new Jukebox(dir);
    assert.deepEqual(j.play({ url: 'https://radio.example/live.mp3', name: 'Radio Paradise' }, 'Tyler'), { changed: true });
    assert.deepEqual({ track: j.state().track, name: j.state().name }, { track: STREAM, name: 'Radio Paradise' });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'jukebox.json'), 'utf8')).name, 'Radio Paradise');

    writeFileSync(path.join(dir, 'jukebox.json'), JSON.stringify({ on: true, track: YOUTUBE, video: { id: 'nope', title: 'x', by: 'y' }, startedAt: 1 }));
    assert.deepEqual({ on: new Jukebox(dir).state().on, track: new Jukebox(dir).state().track }, { on: false, track: 'rainy-window' });
  } finally {
    done();
  }
});

// ---- Everyone at the same point in the set -------------------------------------------------------

const TWO_HOURS = 2 * 3600 + 2 * 60; // the set: 2 h 02 m

test('everyone is as far into the video as it has been on, and it comes round again when it ends', () => {
  assert.equal(videoAt(0, TWO_HOURS), 0);
  assert.equal(videoAt(95_500, TWO_HOURS), 95.5);
  assert.equal(videoAt((TWO_HOURS + 30) * 1000, TWO_HOURS), 30);
  assert.equal(videoAt((3 * TWO_HOURS + 12.5) * 1000, TWO_HOURS), 12.5);
  // Until the player knows how long the video is, it's on its first time through.
  assert.equal(videoAt(95_500, 0), 95.5);
  // A clock that says it started a moment in the future still starts at the top.
  assert.equal(videoAt(-400, TWO_HOURS), 0);
});

test('drift is measured the short way round the end of a video that loops', () => {
  assert.equal(driftOf(100, 98.5, TWO_HOURS), 1.5);
  assert.equal(driftOf(95, 100, TWO_HOURS), -5);
  // The player has just started over; everyone else is on the last second.
  assert.equal(driftOf(0.5, TWO_HOURS - 0.5, TWO_HOURS), 1);
  assert.equal(driftOf(TWO_HOURS - 0.5, 0.5, TWO_HOURS), -1);
  assert.equal(driftOf(10, 4, 0), 6);
});

test('a player is moved only once it is more than two seconds out', () => {
  assert.equal(MAX_DRIFT, 2);
  assert.equal(seekTo(100, 101_500, TWO_HOURS), undefined);
  assert.equal(seekTo(100, 98_100, TWO_HOURS), undefined);
  assert.equal(seekTo(100, 102_500, TWO_HOURS), 102.5);
  assert.equal(seekTo(100, 60_000, TWO_HOURS), 60);
  // Joining an hour in: straight there.
  assert.equal(seekTo(0, 3_600_000, TWO_HOURS), 3600);
  // On its second time through, where it is on this one.
  assert.equal(seekTo(0, (TWO_HOURS + 600) * 1000, TWO_HOURS), 600);
  // Across the loop: the player started over a moment early, which isn't drift.
  assert.equal(seekTo(0.4, (TWO_HOURS - 0.6) * 1000, TWO_HOURS), undefined);
  // Never onto the last second (it runs out and comes round by itself), and never before the length is known.
  assert.equal(seekTo(100, (TWO_HOURS - 0.5) * 1000, TWO_HOURS), undefined);
  assert.equal(seekTo(0, 3_600_000, 0), undefined);
});

test('a player starts where everyone is, and from the top when that is the very end', () => {
  assert.equal(startAt(0, 0), 0);
  assert.equal(startAt(600_000, 0), 600);
  assert.equal(startAt(600_000, TWO_HOURS), 600);
  assert.equal(startAt((TWO_HOURS + 600) * 1000, TWO_HOURS), 600);
  // It ended a second early here: everyone else is about to start over too.
  assert.equal(startAt((TWO_HOURS - 1) * 1000, TWO_HOURS), 0);
  assert.equal(startAt((2 * TWO_HOURS - 2.5) * 1000, TWO_HOURS), 0);
  assert.equal(startAt((TWO_HOURS - 10) * 1000, TWO_HOURS), TWO_HOURS - 10);
});
