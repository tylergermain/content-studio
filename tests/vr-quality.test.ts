import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLAT_PROFILES, KNOB_STEPS, VR_PROFILES, flatProfileFor, nextValue, profileFor, profileName } from '../src/client/features/vr/quality-profile.js';
import { HotTextures, applyQuality, qualityBefore, skyHalos, startQuality } from '../src/client/features/vr/quality.js';
import { median, quantile, summarize, type VrFrameStat } from '../src/client/features/vr/perf.js';
import { VR_DEFAULTS } from '../src/client/features/vr/prefs.js';
import type { SceneQuality, VrQuality, VrSession } from '../src/client/features/vr/types.js';
import { uniforms as sky } from '../src/client/world/sky.js';
import type { Ctx } from '../src/client/core/context.js';
import type { Parts } from '../src/client/core/parts.js';

// VR's quality (features/vr/quality-profile.ts, quality.ts, perf.ts): which profile a headset gets,
// what each knob does to the renderer and the scene while VR is on, that every bit of it is put back
// after, and how the perf numbers are summed up.

// The Quest Browser's user agents, as Meta's emulator (iwer 2.5.0) sends them.
const ua = (model: string) => `Mozilla/5.0 (X11; Linux x86_64; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36`;

test('each headset gets its profile from the user agent: the Quest 2 (or any Quest it can\'t tell), the Quest 3 or Pro, or anything else', () => {
  assert.equal(profileName(ua('Quest 2')), 'quest2');
  assert.equal(profileName(ua('Quest 1')), 'quest2');
  assert.equal(profileName(ua('Quest 3')), 'quest3');
  assert.equal(profileName(ua('Quest 3S')), 'quest3');
  assert.equal(profileName(ua('Quest Pro')), 'quest3');
  assert.equal(profileName('Mozilla/5.0 (Linux; Android 10; Quest) AppleWebKit/537.36 OculusBrowser/7.0'), 'quest2');
  assert.equal(profileName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), 'other');
  assert.equal(profileName('Mozilla/5.0 (X11; Linux x86_64) PicoBrowser/4.0 Chrome/105.0 VR Safari/537.36'), 'other');
  const q = profileFor(ua('Quest 2'));
  q.outline = true;
  assert.equal(VR_PROFILES.quest2.outline, false, 'a profile handed out is a copy, to change knob by knob');
});

test('the Quest 2 starts lean: no outline, 0.8 resolution, full foveation, 72 Hz, shadows four times a second, no halos, video capped, the still office batched, pictures halved', () => {
  const q = VR_PROFILES.quest2;
  assert.deepEqual(
    { outline: q.outline, scale: q.framebufferScale, fov: q.foveation, hz: q.frameRate, shadows: q.shadows, map: q.shadowMapSize, every: q.shadowEveryMs, halos: q.halos, lamps: q.maxLamps, hot: q.hotTextureEveryMs, reach: q.sceneryReach, panel: q.panelScale, batching: q.batching, cap: q.textureCap },
    { outline: false, scale: 0.8, fov: 1, hz: 72, shadows: 'throttled', map: 1024, every: 250, halos: false, lamps: 24, hot: 100, reach: 0.6, panel: 1.5, batching: true, cap: 512 },
  );
  for (const p of [...Object.values(VR_PROFILES), ...Object.values(FLAT_PROFILES)] as Partial<VrQuality>[]) {
    if (p.framebufferScale !== undefined) assert.ok(p.framebufferScale >= 0.5 && p.framebufferScale <= 1 && p.foveation! >= 0 && p.foveation! <= 1, p.name);
    // Each knob's value is one the overlay can step back to.
    for (const [k, steps] of Object.entries(KNOB_STEPS) as [keyof VrQuality, readonly unknown[]][]) {
      if (!(k in p) || (k === 'frameRate' && p.frameRate === null)) continue;
      assert.ok(steps.includes(p[k]), `${p.name}.${k} = ${p[k]} is one of ${steps}`);
    }
  }
  assert.equal(nextValue([0.6, 0.8, 1], 0.8), 1);
  assert.equal(nextValue([0.6, 0.8, 1], 1), 0.6, 'round to the first');
  assert.equal(nextValue(['on', 'throttled', 'off'], 'sideways'), 'on', 'from something else, the first');
});

test('a Quest\'s own page outside VR has a profile of its own; a laptop (or anything else) has none and is drawn as it always was', () => {
  const q2 = flatProfileFor(ua('Quest 2'));
  assert.deepEqual(
    { name: q2?.name, outline: q2?.outline, ratio: q2?.pixelRatio, shadows: q2?.shadows, map: q2?.shadowMapSize, batching: q2?.batching },
    { name: 'quest2', outline: false, ratio: 1, shadows: 'throttled', map: 1024, batching: true },
  );
  assert.equal(flatProfileFor(ua('Quest 3'))?.name, 'quest3');
  assert.equal(flatProfileFor(ua('Quest Pro'))?.name, 'quest3');
  assert.equal(flatProfileFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), null);
  assert.equal(flatProfileFor('Mozilla/5.0 (X11; Linux x86_64) PicoBrowser/4.0 Chrome/105.0 VR Safari/537.36'), null);
  q2!.outline = true;
  assert.equal(FLAT_PROFILES.quest2.outline, false, 'a copy, to change knob by knob');
});

test('before a session: the resolution (yours, if you chose one) and the foveation', () => {
  const calls: [string, number][] = [];
  const renderer = { xr: { setFramebufferScaleFactor: (v: number) => calls.push(['scale', v]), setFoveation: (v: number) => calls.push(['foveation', v]) } } as unknown as THREE.WebGLRenderer;
  const q = profileFor(ua('Quest 2'));
  qualityBefore(renderer, q, { ...VR_DEFAULTS });
  assert.deepEqual(calls, [['scale', 0.8], ['foveation', 1]]);
  calls.length = 0;
  qualityBefore(renderer, q, { ...VR_DEFAULTS, scale: 0.3 });
  assert.deepEqual(calls[0], ['scale', 0.5], 'never under half');
  assert.equal(q.framebufferScale, 0.5, 'and the profile says what was set');
});

/** A texture as a video or a canvas makes one: drawn into over and over. */
const canvasTexture = () => Object.assign(new THREE.Texture(), { isCanvasTexture: true });

test('a texture uploaded more than five times a second is held to the cap; others never are', () => {
  let now = 0;
  const hot = new HotTextures(() => now);
  const before = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  hot.every = 100;
  hot.patch();
  try {
    const video = canvasTexture();
    const data = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const v0 = video.version;
    const d0 = data.version;
    // Sixty frames a second for a second.
    for (let i = 0; i < 60; i++) {
      now = i * (1000 / 60);
      video.needsUpdate = true;
      data.needsUpdate = true;
      hot.flush(now);
    }
    assert.equal(data.version - d0, 60, 'a data texture (a skeleton\'s bones, say) always goes up');
    const ups = video.version - v0;
    assert.ok(ups >= 13 && ups <= 17, `the first five, then ten a second: ${ups}`);
    now += 1;
    video.needsUpdate = true;
    assert.equal(hot.waiting, 1, 'a frame straight after one went up waits');
    now += 100;
    hot.flush(now);
    assert.equal(hot.waiting, 0, 'and goes up once its time comes');
    // A texture that asks for itself only now and then is never held.
    const sign = canvasTexture();
    const s0 = sign.version;
    for (let i = 0; i < 4; i++) {
      now += 300;
      sign.needsUpdate = true;
    }
    assert.equal(sign.version - s0, 4);
    const own = canvasTexture();
    own.userData.vrHot = false;
    const o0 = own.version;
    for (let i = 0; i < 30; i++) own.needsUpdate = true;
    assert.equal(own.version - o0, 30, 'nor is one that says it isn\'t a video (a panel, the overlay)');
    video.needsUpdate = true;
    video.needsUpdate = true;
    const held = video.version;
    hot.unpatch();
    assert.equal(video.version, held + 1, 'what was held goes up as the throttle comes off');
  } finally {
    hot.unpatch();
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate'), before, 'Texture is as it was');
});

test('the sky\'s halos are the additive, coloured points out of the fog: not the holiday lights, not the stars', () => {
  const scene = new THREE.Scene();
  const points = (o: THREE.PointsMaterialParameters) => new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial(o));
  const halo = points({ vertexColors: true, blending: THREE.AdditiveBlending, fog: false });
  const ground = new THREE.Group();
  const groundHalo = points({ vertexColors: true, blending: THREE.AdditiveBlending, fog: false });
  ground.add(groundHalo);
  scene.add(halo, ground, points({ vertexColors: true, blending: THREE.AdditiveBlending }), points({ fog: false }));
  assert.deepEqual(skyHalos(scene), [halo, groundHalo]);
});

/** The office as quality sees it, a VR session to run it in, and what each did. */
function rig() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#fff', 40, 100);
  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(2048, 2048);
  const map = new THREE.WebGLRenderTarget(2048, 2048);
  sun.shadow.map = map;
  const halo = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, fog: false }));
  const mat = new THREE.MeshBasicMaterial();
  scene.add(sun, halo, new THREE.Mesh(new THREE.BoxGeometry(), mat));
  const culls: number[] = [];
  const foveation: number[] = [];
  const rates: number[] = [];
  const renderer = {
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
    xr: { setFoveation: (v: number) => foveation.push(v) },
  };
  const camera = new THREE.PerspectiveCamera();
  const ctx = { renderer, camera, office: { scenic: { cull: (_e: THREE.Vector3, _s: number, far: number) => culls.push(far) }, night: { street: -12 } }, upTop: () => false } as unknown as Ctx;
  const ticks: ((f: { now: number }) => void)[] = [];
  const ends: (() => void)[] = [];
  const s = {
    quality: profileFor(ua('Quest 2')),
    xr: { supportedFrameRates: new Float32Array([72, 90]), updateTargetFrameRate: async (r: number) => void rates.push(r) },
    tick: (phase: string, fn: (f: { now: number }) => void) => (assert.equal(phase, 'env'), ticks.push(fn)),
    onEnd: (fn: () => void) => ends.push(fn),
  } as unknown as VrSession;
  const run = (now: number) => ticks.forEach((fn) => fn({ now }));
  const end = () => ends.reverse().forEach((fn) => fn());
  return { scene, sun, map, halo, mat, culls, foveation, rates, renderer, ctx, s, run, end, parts: { stage: { sun, scene } } as unknown as Pick<Parts, 'stage'> };
}

test('in VR the Quest 2 profile throttles the sun\'s shadows, hides the halos, culls the scenery nearer and caps the lamps; all of it put back after', () => {
  const r = rig();
  const before = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  const knobs = startQuality(r.ctx, r.parts, r.s);
  try {
    assert.equal(knobs.quality, r.s.quality, 'the knobs change the session\'s own profile');
    assert.deepEqual(r.rates, [72], '72 Hz asked for');
    assert.equal(r.renderer.shadowMap.autoUpdate, false);
    assert.equal(r.sun.shadow.mapSize.x, 1024);
    assert.equal(r.sun.shadow.map, null, 'the 2048 map let go of, for three to make a 1024 one');
    assert.notDeepEqual(Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate'), before, 'video capped');

    r.renderer.shadowMap.needsUpdate = false;
    r.halo.visible = true;
    sky.skyLampCount.value = 20;
    r.run(1000);
    assert.equal(r.renderer.shadowMap.needsUpdate, true, 'the shadows drawn now...');
    assert.equal(r.halo.visible, false, 'the sky\'s halos hidden after it showed them');
    assert.deepEqual(r.culls, [60], 'the scenery culled at 0.6 of the fog');
    assert.equal(sky.skyLampCount.value, 20, 'every lamp');
    r.renderer.shadowMap.needsUpdate = false;
    r.run(1100);
    assert.equal(r.renderer.shadowMap.needsUpdate, false, '...and not again for a quarter of a second');
    r.run(1260);
    assert.equal(r.renderer.shadowMap.needsUpdate, true);

    // Live, from the overlay.
    knobs.set('maxLamps', 8);
    knobs.set('halos', true);
    knobs.set('sceneryReach', 1);
    knobs.set('foveation', 0.5);
    knobs.set('frameRate', 90);
    knobs.set('frameRate', 120);
    r.halo.visible = true;
    r.culls.length = 0;
    r.run(2000);
    assert.equal(sky.skyLampCount.value, 8);
    assert.equal(r.halo.visible, true);
    assert.deepEqual(r.culls, [], 'the frame loop\'s own cull is the one');
    assert.deepEqual(r.foveation, [0.5]);
    assert.deepEqual(r.rates, [72, 90], 'a rate the headset has, and not one it hasn\'t');
    knobs.set('shadows', 'on');
    assert.equal(r.renderer.shadowMap.autoUpdate, true);
    r.mat.version = 0;
    knobs.set('shadows', 'off');
    assert.equal(r.renderer.shadowMap.enabled, false);
    assert.ok(r.mat.version > 0, 'every material compiled again without them');
    knobs.set('hotTextureEveryMs', 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate'), before, 'no cap, no throttle');
    knobs.set('hotTextureEveryMs', 100);
  } finally {
    r.end();
  }
  assert.equal(r.renderer.shadowMap.enabled, true);
  assert.equal(r.renderer.shadowMap.autoUpdate, true);
  assert.equal(r.sun.shadow.mapSize.x, 2048);
  assert.equal(r.renderer.shadowMap.needsUpdate, true, 'drawn afresh at the old size');
  assert.deepEqual(Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate'), before, 'Texture is as it was');
  sky.skyLampCount.value = 0;
});

test('profiles stack: the flat page\'s under a VR session\'s, each knob back to the flat page\'s as VR ends; the outline pass drawn only where the top one has it', () => {
  const r = rig();
  let outlines = 0;
  const effect = { renderOutline: () => void outlines++ };
  const draw = effect.renderOutline;
  const parts = { stage: { ...r.parts.stage, effect } } as unknown as Pick<Parts, 'stage'>;
  const ticks: ((f: { now: number }) => void)[] = [];
  const flat: SceneQuality = { outline: false, shadows: 'throttled', shadowMapSize: 1024, shadowEveryMs: 250, halos: true, maxLamps: 24, hotTextureEveryMs: 0, sceneryReach: 1, batching: false, textureCap: 0 };
  const texture = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  let flatEnded: (() => void) | undefined;
  applyQuality(r.ctx, parts, { tick: (_p, fn) => void ticks.push(fn), onEnd: (fn) => void (flatEnded = fn) }, flat);
  assert.equal(r.sun.shadow.mapSize.x, 1024, 'the flat page\'s shadow map');
  assert.equal(r.renderer.shadowMap.autoUpdate, false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate'), texture, 'no video cap in this profile');
  effect.renderOutline.call(effect);
  assert.equal(outlines, 0, 'no outline pass on the flat page');
  // In VR on the Quest 3, say, the outline's on and the shadows go to 2048.
  r.s.quality.outline = true;
  r.s.quality.shadowMapSize = 2048;
  const knobs = startQuality(r.ctx, parts, r.s);
  assert.equal(r.sun.shadow.mapSize.x, 2048);
  effect.renderOutline.call(effect);
  assert.equal(outlines, 1, 'the outline pass while VR\'s profile has it');
  knobs.set('outline', false);
  effect.renderOutline.call(effect);
  assert.equal(outlines, 1);
  r.end();
  assert.equal(r.sun.shadow.mapSize.x, 1024, 'out of VR: the flat page\'s again, not the laptop\'s');
  assert.equal(r.renderer.shadowMap.autoUpdate, false);
  // The flat page's own tick keeps running its knobs.
  r.renderer.shadowMap.needsUpdate = false;
  ticks.forEach((fn) => fn({ now: 5000 }));
  assert.equal(r.renderer.shadowMap.needsUpdate, true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate'), texture, 'VR\'s video cap came off with it');
  flatEnded?.();
  assert.equal(effect.renderOutline, draw, 'with no profile on, the outline effect is its own again');
  assert.equal(r.sun.shadow.mapSize.x, 2048);
  assert.equal(r.renderer.shadowMap.autoUpdate, true);
  sky.skyLampCount.value = 0;
});

test('a second of frames sums up as its fps, late frames, and the middle of its CPU time and draw calls', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), 0);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  const frames: VrFrameStat[] = Array.from({ length: 72 }, (_, i) => ({ at: i * 13.9, dt: i === 10 ? 40 : 13.9, cpuMs: i % 2 ? 6 : 8, calls: 400 + i, triangles: 1000 }));
  const s = summarize(frames, 72, { gpuMs: null, programs: 50, textures: 120, paintMs: 1.5 });
  assert.ok(s.fps > 70 && s.fps < 72, `${s.fps}`);
  assert.ok(Math.abs(s.late - 100 / 72) < 1e-9, `one late frame in 72: ${s.late}%`);
  assert.equal(s.cpuMs, 8);
  assert.equal(s.calls, 436);
  assert.equal(s.gpuMs, null);
  assert.equal(s.at, frames.at(-1)!.at);
});
