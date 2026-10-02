// Video screens (client/features/screens): what each plays out of a floor's media folder and in what
// order, how a picture fits on a 16:9 face, and the wall-mounted kind in the furniture catalog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FURNITURE, FURNITURE, cleanFurniture, isSolid, kindDef, pieceCollider } from '../src/shared/furniture.js';
import { problemAt } from '../src/shared/office-builder.js';
import { DRAWN_SIDE, MAX_CROP, capSize, fitOn, freeSlot, mediaFolder, mediaListUrl, mediaUrl, nextAfter, programme, startOf, wrapPath, type MediaFile } from '../src/client/features/screens/playlist.js';

const video = (name: string, size = 1): MediaFile => ({ name, kind: 'video', size });
const image = (name: string, size = 1): MediaFile => ({ name, kind: 'image', size });
const names = (files: readonly MediaFile[]) => files.map((f) => f.name);

// The face every screen has (see videoScreen in world/office/furniture-studio.ts).
const FACE = { w: 1.98, h: 1.11 };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('a screen plays the file it names, else every video in turn, else every picture', () => {
  const folder = [video('a.mp4'), image('logo.png'), video('b.webm'), image('wall.jpg')];
  assert.deepEqual(programme(folder), { files: [folder[0], folder[2]], single: false });
  assert.deepEqual(programme(folder, 'b.webm'), { files: [folder[2]], single: true });
  // A named picture is shown, though there are videos.
  assert.deepEqual(programme(folder, 'logo.png'), { files: [folder[1]], single: true });
  // A file that isn't there (taken out of the folder, or never put in): the folder's videos, as if it named none.
  assert.deepEqual(names(programme(folder, 'gone.mp4').files), ['a.mp4', 'b.webm']);
  assert.equal(programme(folder, 'gone.mp4').single, false);
  // No videos: the pictures, a slideshow.
  assert.deepEqual(names(programme([image('logo.png'), image('wall.jpg')]).files), ['logo.png', 'wall.jpg']);
  assert.deepEqual(programme([]), { files: [], single: false });
});

test('what will not play here is left out, so one bad file does not stop the rest', () => {
  const folder = [video('a.mov'), video('b.mp4'), image('logo.png')];
  assert.deepEqual(names(programme(folder, undefined, new Set(['a.mov'])).files), ['b.mp4']);
  // Every video bad: the pictures instead.
  assert.deepEqual(names(programme(folder, undefined, new Set(['a.mov', 'b.mp4'])).files), ['logo.png']);
  // The one it names is bad: the others, in turn.
  assert.deepEqual(programme(folder, 'a.mov', new Set(['a.mov'])), { files: [folder[1]], single: false });
  assert.deepEqual(programme(folder, undefined, new Set(['a.mov', 'b.mp4', 'logo.png'])).files, []);
});

test('screens side by side start on different files, and share one from different places in it', () => {
  // Three files, three screens: one each.
  assert.deepEqual([0, 1, 2].map((slot) => startOf(slot, 3, 3)), [{ index: 0, phase: 0 }, { index: 1, phase: 0 }, { index: 2, phase: 0 }]);
  // Two files, three screens: the third shares the first's file, halfway through it.
  assert.deepEqual([0, 1, 2].map((slot) => startOf(slot, 2, 3)), [{ index: 0, phase: 0 }, { index: 1, phase: 0 }, { index: 0, phase: 0.5 }]);
  // One file: each a third of the way on from the last.
  const one = [0, 1, 2].map((slot) => startOf(slot, 1, 3));
  assert.deepEqual(one.map((s) => s.index), [0, 0, 0]);
  near(one[1].phase, 1 / 3);
  near(one[2].phase, 2 / 3);
  // No two screens start at the same place, however many there are of each.
  for (let count = 1; count <= 5; count++) {
    for (let screens = 1; screens <= 9; screens++) {
      const starts = Array.from({ length: screens }, (_, slot) => startOf(slot, count, screens));
      assert.equal(new Set(starts.map((s) => `${s.index}@${s.phase.toFixed(6)}`)).size, screens, `${screens} screens, ${count} files`);
      for (const s of starts) assert.ok(s.index >= 0 && s.index < count && s.phase >= 0 && s.phase < 1, JSON.stringify(s));
    }
  }
  // A slot past the count it was told (a screen put up since) still has a place.
  assert.deepEqual(startOf(3, 2, 1), { index: 1, phase: 0.5 });
  assert.deepEqual(startOf(2, 0, 3), { index: 0, phase: 0 });
});

test('a screen goes on to the next file, round to the first, and past one that has gone', () => {
  const list = ['a.mp4', 'b.mp4', 'c.mp4'];
  assert.equal(nextAfter(list, undefined), 'a.mp4');
  assert.equal(nextAfter(list, 'a.mp4'), 'b.mp4');
  assert.equal(nextAfter(list, 'c.mp4'), 'a.mp4');
  assert.equal(nextAfter(['a.mp4'], 'a.mp4'), 'a.mp4');
  // What it was playing was taken out of the folder: the one that would have come after it.
  assert.equal(nextAfter(['a.mp4', 'c.mp4'], 'b.mp4'), 'c.mp4');
  assert.equal(nextAfter(['a.mp4', 'b.mp4'], 'z.mp4'), 'a.mp4');
  assert.equal(nextAfter([], 'a.mp4'), undefined);
  // Round the whole folder and back, a file dropped in on the way.
  const seen: string[] = [];
  let at: string | undefined;
  for (let i = 0; i < 5; i++) seen.push((at = nextAfter(i < 2 ? list : [...list, 'd.mp4'], at)!));
  assert.deepEqual(seen, ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4', 'a.mp4']);
});

test('each screen taking the folder in turn has a slot of its own', () => {
  assert.equal(freeSlot([]), 0);
  assert.equal(freeSlot([0, 1]), 2);
  // One taken down leaves its slot for the next put up.
  assert.equal(freeSlot([0, 2, 3]), 1);
});

test('a 16:9 video fills the face, and a wider or squarer one covers it with its overhang cut off evenly', () => {
  const hd = fitOn(1920, 1080, FACE.w, FACE.h);
  assert.equal(hd.cover, true);
  assert.deepEqual(hd.scale, { x: 1, y: 1 });
  // The face is a hair wider than 16:9: a sliver comes off the top and the bottom, and nothing's stretched.
  assert.equal(hd.repeat.x, 1);
  assert.ok(hd.repeat.y > 0.99 && hd.repeat.y < 1);
  near(hd.offset.y, (1 - hd.repeat.y) / 2);
  // What shows of it is the face's own shape.
  near((1920 * hd.repeat.x) / (1080 * hd.repeat.y), FACE.w / FACE.h);

  // A wide film: its sides come off.
  const scope = fitOn(2390, 1000, FACE.w, FACE.h);
  assert.equal(scope.cover, true);
  assert.equal(scope.repeat.y, 1);
  near((2390 * scope.repeat.x) / 1000, FACE.w / FACE.h);
  near(scope.offset.x * 2 + scope.repeat.x, 1);

  // 4:3: its top and bottom.
  const tv = fitOn(1440, 1080, FACE.w, FACE.h);
  assert.equal(tv.cover, true);
  assert.equal(tv.repeat.x, 1);
  near(1440 / (1080 * tv.repeat.y), FACE.w / FACE.h);
  near(tv.offset.y * 2 + tv.repeat.y, 1);
  assert.ok(1 - tv.repeat.y <= MAX_CROP);
});

test('a portrait reel is shown whole in the middle of the face, never stretched', () => {
  const reel = fitOn(1080, 1920, FACE.w, FACE.h);
  assert.equal(reel.cover, false);
  assert.deepEqual(reel.repeat, { x: 1, y: 1 });
  assert.deepEqual(reel.offset, { x: 0, y: 0 });
  assert.equal(reel.scale.y, 1);
  // As tall as the face, and as wide as its own shape makes it.
  near((FACE.w * reel.scale.x) / (FACE.h * reel.scale.y), 1080 / 1920);
  // A square one too: covering would cut off nearly half of it.
  const square = fitOn(1080, 1080, FACE.w, FACE.h);
  assert.equal(square.cover, false);
  near((FACE.w * square.scale.x) / FACE.h, 1);
  // And a banner far wider than the face: whole, with the face over and under it.
  const banner = fitOn(4000, 1000, FACE.w, FACE.h);
  assert.equal(banner.cover, false);
  assert.equal(banner.scale.x, 1);
  near(FACE.w / (FACE.h * banner.scale.y), 4);
  // Nothing to go by (a file that hasn't said its size): the whole face.
  assert.deepEqual(fitOn(0, 0, FACE.w, FACE.h), { cover: true, scale: { x: 1, y: 1 }, repeat: { x: 1, y: 1 }, offset: { x: 0, y: 0 } });
});

test('whichever way a picture is fitted, it keeps its shape and stays on the face', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [3840, 2160], [640, 480], [1000, 1000], [720, 1280], [2560, 1080], [300, 2000], [5000, 500]]) {
    const f = fitOn(w, h, FACE.w, FACE.h);
    assert.ok(f.scale.x > 0 && f.scale.x <= 1 && f.scale.y > 0 && f.scale.y <= 1, `${w}x${h} stays on the face`);
    assert.ok(f.repeat.x > 0 && f.repeat.x <= 1 && f.repeat.y > 0 && f.repeat.y <= 1 && f.offset.x >= 0 && f.offset.y >= 0);
    // What's shown of the picture is the shape of the part of the face it's shown on.
    near((w * f.repeat.x) / (h * f.repeat.y), (FACE.w * f.scale.x) / (FACE.h * f.scale.y), 1e-9);
    // Covering never loses more of it than MAX_CROP.
    assert.ok(f.repeat.x * f.repeat.y >= 1 - MAX_CROP - 1e-9, `${w}x${h} keeps most of itself`);
    assert.equal(f.cover, f.scale.x === 1 && f.scale.y === 1);
  }
});

test('a big video is drawn down to a size the graphics card is not bothered by, the same shape', () => {
  assert.deepEqual(capSize(3840, 2160, DRAWN_SIDE), { w: 1280, h: 720 });
  assert.deepEqual(capSize(2160, 3840, DRAWN_SIDE), { w: 720, h: 1280 });
  // One that's small enough is left as it is.
  assert.deepEqual(capSize(1280, 720, DRAWN_SIDE), { w: 1280, h: 720 });
  assert.deepEqual(capSize(640, 360, DRAWN_SIDE), { w: 640, h: 360 });
  assert.deepEqual(capSize(4000, 3, 1000), { w: 1000, h: 1 });
});

test('a floor\'s media is asked for by floor and name, and the folder is written the way it is on disk', () => {
  assert.equal(mediaUrl('content', 'my reel (1).mp4'), '/api/media?floor=content&name=my%20reel%20(1).mp4');
  assert.equal(mediaUrl('content', 'a.mp4', 1234), '/api/media?floor=content&name=a.mp4&v=1234');
  assert.equal(mediaListUrl('ai-innovators'), '/api/media?floor=ai-innovators&list');
  assert.equal(mediaFolder('/Users/tyler/Workspaces/content'), '/Users/tyler/Workspaces/content/.agent-office/media');
  assert.equal(mediaFolder('/Users/tyler/Workspaces/content/'), '/Users/tyler/Workspaces/content/.agent-office/media');
});

test('a long folder is written over a few lines, broken at its slashes', () => {
  assert.deepEqual(wrapPath('/Users/tyler/Workspaces/content/.agent-office/media', 60), ['/Users/tyler/Workspaces/content/.agent-office/media']);
  assert.deepEqual(wrapPath('/Users/tyler/Workspaces/content/.agent-office/media', 24), ['/Users/tyler/Workspaces/', 'content/.agent-office/', 'media']);
  // A name longer than a line is cut where the line ends, and nothing's lost.
  const long = '/tmp/a-folder-with-a-very-long-name-indeed/media';
  const lines = wrapPath(long, 16);
  assert.ok(lines.every((l) => l.length <= 16), JSON.stringify(lines));
  assert.equal(lines.join(''), long);
  assert.deepEqual(wrapPath('', 10), []);
});

test('the wall screen plays, hangs clear of the floor, and goes where a screen on a stand could not', () => {
  const k = kindDef('wall-screen');
  assert.equal(k.plays, true);
  assert.equal(k.group, 'Work');
  assert.equal(FURNITURE.screen.plays, true);
  const hung = { id: 'w', kind: 'wall-screen' as const, x: 5, z: 7.5, rotY: 0 };
  // Nothing's in the way under it: nothing to bump into, and it can hang over what stands on the floor.
  assert.equal(isSolid(hung), false);
  assert.equal(pieceCollider(hung), undefined);
  const layout = (pieces: (typeof hung | { id: string; kind: 'screen'; x: number; z: number; rotY: number })[]) => ({ desks: {}, furniture: [...DEFAULT_FURNITURE.map((p) => ({ ...p })), ...pieces] });
  const couch = DEFAULT_FURNITURE.find((p) => p.id === 'couch')!;
  assert.equal(problemAt(layout([{ ...hung, x: couch.x, z: couch.z }]), 'w'), undefined);
  assert.match(problemAt(layout([{ id: 's', kind: 'screen', x: couch.x, z: couch.z, rotY: 0 }]), 's')!, /overlaps/);
  // Pushed up against the room's north wall: its footprint's as thin as it is.
  assert.equal(problemAt(layout([{ ...hung, x: 0, z: -12.9 }]), 'w'), undefined);
  // Both kinds keep the file they name, when it's a name a media folder could have.
  const kept = cleanFurniture([
    { id: 'a', kind: 'wall-screen', x: 0, z: 0, rotY: 0, media: 'reel one (2).mp4' },
    { id: 'b', kind: 'screen', x: 4, z: 0, rotY: 0, media: '../secrets.mp4' },
    { id: 'c', kind: 'sofa', x: 8, z: 0, rotY: 0, media: 'a.mp4' },
  ]);
  assert.ok(typeof kept === 'object');
  assert.deepEqual(kept.map((p) => p.media), ['reel one (2).mp4', undefined, undefined]);
});
