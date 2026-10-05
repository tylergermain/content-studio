/**
 * VR's quality profile at work (see quality-profile.ts for the numbers): what's set before a session
 * starts (the resolution and the foveation), and while it runs, through handles the office already
 * has, each knob live so the perf overlay can flip it for an A/B in the headset. All of it is put back
 * as the session ends: the desktop goes on exactly as it was.
 *
 * - outline: read by the session's own drawing each frame (session.ts), from `s.quality`.
 * - framebufferScale: only when a session starts (three refuses it during one), so a change is kept
 *   in the VR prefs for next time.
 * - foveation and frameRate: straight to the XR layer and session.
 * - shadows: the sun's map size, and drawn only every `shadowEveryMs` ('throttled'), or not at all
 *   ('off', which recompiles every material once).
 * - halos: the sky's night halos (additive points it shows again every frame) hidden after it.
 * - maxLamps: how many of the sky's lamps the toon shaders light with.
 * - sceneryReach: the scenic loop culled nearer than the fog's far edge.
 * - hotTextureEveryMs: a texture uploaded more than five times a second (a video, the TV, a screen's
 *   canvas, the arcade) is held to one upload per that many ms. A texture with `userData.vrHot === false`
 *   is left alone.
 * - panelScale: read by the panels when they paint (panels/).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { uniforms as skyUniforms } from '../../world/sky';
import { saveVrPrefs } from './prefs';
import type { VrKnobs, VrPrefs, VrQuality, VrSession } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Before the session is handed to three: the resolution (the prefs' own, if one was chosen) and the foveation. */
export function qualityBefore(renderer: THREE.WebGLRenderer, q: VrQuality, prefs: VrPrefs): void {
  q.framebufferScale = clamp(prefs.scale ?? q.framebufferScale, 0.5, 1);
  q.foveation = clamp(q.foveation, 0, 1);
  renderer.xr.setFramebufferScaleFactor(q.framebufferScale);
  renderer.xr.setFoveation(q.foveation);
}

/** Each session's knobs, for the perf overlay (which starts before quality does: see knobsOf). */
const running = new WeakMap<VrSession, VrKnobs>();

/** The knobs of session `s`, once startQuality has run for it. */
export function knobsOf(s: VrSession): VrKnobs | undefined {
  return running.get(s);
}

/** The quality profile in play for the session (`s.quality`, changed in place by `set`), until it ends. */
export function startQuality(ctx: Ctx, parts: Pick<Parts, 'stage'>, s: VrSession): VrKnobs {
  const { renderer, camera, office } = ctx;
  const { sun, scene } = parts.stage;
  const q = s.quality;
  const was = { autoUpdate: renderer.shadowMap.autoUpdate, enabled: renderer.shadowMap.enabled, size: sun.shadow.mapSize.x };
  const halos = skyHalos(scene);
  const hot = new HotTextures();
  let shadowAt = -Infinity;

  function shadows() {
    const map = renderer.shadowMap;
    setShadowsOn(renderer, scene, q.shadows !== 'off');
    map.autoUpdate = q.shadows === 'on';
    resizeShadow(sun, q.shadowMapSize);
    map.needsUpdate = true;
    shadowAt = -Infinity;
  }
  function frameRate() {
    const rate = q.frameRate;
    const supported = s.xr.supportedFrameRates;
    if (rate === null || typeof s.xr.updateTargetFrameRate !== 'function') return;
    if (supported && !Array.from(supported).includes(rate)) return;
    s.xr.updateTargetFrameRate(rate).catch(() => {});
  }

  shadows();
  frameRate();
  hot.every = q.hotTextureEveryMs;
  if (hot.every > 0) hot.patch();

  s.tick('env', ({ now }) => {
    // After the sky (which shows its halos and sets its lamps every frame) and the scenic loop's own cull.
    if (!q.halos) for (const h of halos) h.visible = false;
    if (skyUniforms.skyLampCount.value > q.maxLamps) skyUniforms.skyLampCount.value = Math.max(0, q.maxLamps);
    if (!ctx.upTop() && q.sceneryReach < 1) office.scenic.cull(camera.position, office.night.street, (scene.fog as THREE.Fog).far * q.sceneryReach);
    if (q.shadows === 'throttled' && now - shadowAt >= q.shadowEveryMs) {
      renderer.shadowMap.needsUpdate = true;
      shadowAt = now;
    }
    hot.flush(now);
  });

  s.onEnd(() => {
    running.delete(s);
    hot.unpatch();
    setShadowsOn(renderer, scene, was.enabled);
    renderer.shadowMap.autoUpdate = was.autoUpdate;
    resizeShadow(sun, was.size);
    renderer.shadowMap.needsUpdate = true;
    // The halos, the lamps and the scenery: the sky and the frame loop set them again next frame.
  });

  const knobs: VrKnobs = {
    quality: q,
    set(k, v) {
      if (q[k] === v) return;
      q[k] = v;
      switch (k) {
        case 'framebufferScale':
          saveVrPrefs({ scale: q.framebufferScale });
          break;
        case 'foveation':
          renderer.xr.setFoveation(clamp(q.foveation, 0, 1));
          break;
        case 'frameRate':
          frameRate();
          break;
        case 'shadows':
        case 'shadowMapSize':
        case 'shadowEveryMs':
          shadows();
          break;
        case 'hotTextureEveryMs':
          hot.every = q.hotTextureEveryMs;
          if (hot.every > 0) hot.patch();
          else hot.unpatch();
          break;
      }
    },
  };
  running.set(s, knobs);
  return knobs;
}

/** The sky's night halos: additive, vertex-coloured points out of the fog (see Sky in world/sky.ts). */
export function skyHalos(scene: THREE.Object3D): THREE.Points[] {
  const out: THREE.Points[] = [];
  scene.traverse((o) => {
    const p = o as THREE.Points;
    if (!p.isPoints || Array.isArray(p.material)) return;
    const m = p.material as THREE.PointsMaterial;
    if (m.blending === THREE.AdditiveBlending && m.vertexColors && m.fog === false) out.push(p);
  });
  return out;
}

/** The sun's shadow map at `size`: the old one let go of, so three makes the new one next time it draws. */
function resizeShadow(sun: THREE.DirectionalLight, size: number) {
  const shadow = sun.shadow;
  if (shadow.mapSize.x === size && shadow.mapSize.y === size) return;
  shadow.mapSize.set(size, size);
  if (shadow.map) {
    shadow.map.depthTexture?.dispose();
    shadow.map.dispose();
    shadow.map = null;
  }
}

/** Shadows on or off for the whole renderer: every material in the scene is compiled again for it. */
function setShadowsOn(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, on: boolean) {
  if (renderer.shadowMap.enabled === on) return;
  renderer.shadowMap.enabled = on;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
  });
}

/** How many uploads a second make a texture hot. */
const HOT_PER_SECOND = 5;
/** Texture's own needsUpdate (a setter that bumps its version), which the throttle stands in front of. */
const NEEDS_UPDATE = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate')!;
const upload = (t: THREE.Texture) => NEEDS_UPDATE.set!.call(t, true);

/** Textures that are drawn into over and over: a video's, a canvas's. */
function streams(t: THREE.Texture): boolean {
  if (t.userData?.vrHot === false) return false;
  const img = t.image as unknown;
  return (
    (t as THREE.VideoTexture).isVideoTexture === true ||
    (t as THREE.CanvasTexture).isCanvasTexture === true ||
    (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) ||
    (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)
  );
}

/**
 * Holds hot textures to an upload every `every` ms: Texture.prototype's needsUpdate is stood in front
 * of while it's on, counting each texture's uploads; once one has had more than HOT_PER_SECOND in a
 * second, an upload asked for sooner than `every` after the last waits for flush.
 */
export class HotTextures {
  every = 0;
  private readonly seen = new WeakMap<THREE.Texture, { n: number; since: number; hot: boolean; last: number }>();
  private readonly pending = new Set<THREE.Texture>();
  private patched = false;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  patch() {
    if (this.patched) return;
    this.patched = true;
    const self = this;
    Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', {
      configurable: true,
      enumerable: NEEDS_UPDATE.enumerable,
      get: NEEDS_UPDATE.get,
      set(this: THREE.Texture, v: boolean) {
        if (v !== true || !self.hold(this)) NEEDS_UPDATE.set!.call(this, v);
      },
    });
  }

  /** Texture's needsUpdate as it was, and whatever was held back uploaded. */
  unpatch() {
    if (!this.patched) return;
    this.patched = false;
    Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', NEEDS_UPDATE);
    for (const t of this.pending) upload(t);
    this.pending.clear();
  }

  /** Whether this upload of `t` waits (for flush): it's hot, and its last went less than `every` ago. */
  hold(t: THREE.Texture): boolean {
    if (this.every <= 0 || !streams(t)) return false;
    const now = this.clock();
    let r = this.seen.get(t);
    if (!r) this.seen.set(t, (r = { n: 0, since: now, hot: false, last: -Infinity }));
    if (!r.hot) {
      if (now - r.since > 1000) {
        r.n = 0;
        r.since = now;
      }
      if (++r.n <= HOT_PER_SECOND) return false;
      r.hot = true;
    }
    if (now - r.last >= this.every) {
      r.last = now;
      this.pending.delete(t);
      return false;
    }
    this.pending.add(t);
    return true;
  }

  /** The held uploads whose time has come. */
  flush(now = this.clock()) {
    for (const t of this.pending) {
      const r = this.seen.get(t)!;
      if (now - r.last < this.every) continue;
      r.last = now;
      this.pending.delete(t);
      upload(t);
    }
  }

  /** How many textures are waiting for an upload. */
  get waiting() {
    return this.pending.size;
  }
}
