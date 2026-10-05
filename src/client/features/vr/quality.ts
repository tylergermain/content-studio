/**
 * A headset's quality profile at work (see quality-profile.ts for the numbers), in VR and on the
 * headset browser's own page outside it (flat.ts): what's set before a VR session starts (the
 * resolution and the foveation), and while a profile is on, through handles the office already has,
 * each knob live so the perf overlay can flip it for an A/B in the headset.
 *
 * Profiles stack: on a Quest the flat page's is on from the start, a VR session's goes over it while
 * you're in VR, and as one comes off the one under it is back. With none on, everything is as it was:
 * a laptop never has one, and the desktop goes on exactly as it always has.
 *
 * - outline: the toon outline's own pass skipped while the top profile has it off (the frame is drawn
 *   the same way otherwise, so your hands still go over it); a VR session also draws without the
 *   effect at all then (session.ts).
 * - framebufferScale (VR): only when a session starts (three refuses it during one), so a change is kept
 *   in the VR prefs for next time.
 * - foveation and frameRate (VR): straight to the XR layer and session.
 * - shadows: the sun's map size, and drawn only every `shadowEveryMs` ('throttled'), or not at all
 *   ('off', which recompiles every material once).
 * - halos: the sky's night halos (additive points it shows again every frame) hidden after it.
 * - maxLamps: how many of the sky's lamps the toon shaders light with.
 * - sceneryReach: the scenic loop culled nearer than the fog's far edge.
 * - hotTextureEveryMs: a texture uploaded more than five times a second (a video, the TV, a screen's
 *   canvas, the arcade) is held to one upload per that many ms. A texture with `userData.vrHot === false`
 *   is left alone.
 * - batching: the office's still meshes drawn a region at a time (world/batch), through the batcher
 *   the profile was put on with.
 * - textureCap: the pictures on the walls at most this many pixels across (world/frames.ts).
 * - panelScale (VR): read by the panels when they paint (panels/).
 */
import * as THREE from 'three';
import type { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import type { Frame, TickPhase } from '../../core/registry';
import type { Batcher } from '../../world/batch/batcher';
import { capPictures } from '../../world/frames';
import { uniforms as skyUniforms } from '../../world/sky';
import { saveVrPrefs } from './prefs';
import type { SceneQuality, VrKnobs, VrPrefs, VrQuality, VrSession } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Before the session is handed to three: the resolution (the prefs' own, if one was chosen) and the foveation. */
export function qualityBefore(renderer: THREE.WebGLRenderer, q: VrQuality, prefs: VrPrefs): void {
  q.framebufferScale = clamp(prefs.scale ?? q.framebufferScale, 0.5, 1);
  q.foveation = clamp(q.foveation, 0, 1);
  renderer.xr.setFramebufferScaleFactor(q.framebufferScale);
  renderer.xr.setFoveation(q.foveation);
}

/** Where a profile is on: what runs it each frame, and what says when it comes off. */
export interface QualityHost {
  tick(phase: TickPhase, fn: (f: Frame) => void): void;
  onEnd(fn: () => void): void;
}

/** A profile that's on, and its knobs, changed one at a time. */
export interface OnQuality<Q extends SceneQuality> {
  readonly quality: Q;
  set<K extends keyof SceneQuality>(k: K, v: Q[K]): void;
}

/** What a profile is put on with: the office's batcher, which its `batching` turns on and off. */
export interface QualityDeps {
  batcher?: Batcher | null;
}

interface Entry {
  q: SceneQuality;
  batcher: Batcher | null;
}

/** The profiles on in an office, the top one applied (see the stacking above). */
class Profiles {
  private readonly entries: Entry[] = [];
  /** The renderer's shadows as they were before any profile was on. */
  private was = { autoUpdate: true, enabled: true, size: 2048 };
  private readonly hot = new HotTextures();
  private halos: THREE.Points[] = [];
  private shadowAt = -Infinity;
  /** The outline effect's own outline pass, while a profile stands in front of it. */
  private outline: OutlineEffect['renderOutline'] | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly parts: Pick<Parts, 'stage'>,
  ) {}

  private top(): Entry | undefined {
    return this.entries.at(-1);
  }

  push<Q extends SceneQuality>(q: Q, host: QualityHost, deps: QualityDeps): OnQuality<Q> {
    const { renderer } = this.ctx;
    const { effect } = this.parts.stage;
    if (!this.entries.length) {
      this.was = { autoUpdate: renderer.shadowMap.autoUpdate, enabled: renderer.shadowMap.enabled, size: this.parts.stage.sun.shadow.mapSize.x };
      // The outline's pass, drawn only while the top profile has it.
      if (effect) {
        const draw = (this.outline = effect.renderOutline);
        effect.renderOutline = (scene, camera) => {
          if (this.top()?.q.outline !== false) draw.call(effect, scene, camera);
        };
      }
    }
    const entry: Entry = { q, batcher: deps.batcher ?? null };
    this.entries.push(entry);
    this.halos = skyHalos(this.parts.stage.scene);
    this.applyAll();
    host.tick('env', ({ now }) => {
      // After the sky (which shows its halos and sets its lamps every frame) and the scenic loop's own cull.
      if (this.top() === entry) this.frame(now);
    });
    host.onEnd(() => this.pop(entry));
    return {
      quality: q,
      set: (k, v) => {
        if (q[k] === v) return;
        q[k] = v;
        if (this.top() === entry) this.apply(k);
      },
    };
  }

  private pop(entry: Entry) {
    const i = this.entries.indexOf(entry);
    if (i < 0) return;
    this.entries.splice(i, 1);
    if (this.entries.length) return this.applyAll();
    // None on: the office as it was. (The halos, the lamps and the scenery: the sky and the frame loop set them again next frame.)
    const { renderer } = this.ctx;
    const { sun, scene } = this.parts.stage;
    this.hot.unpatch();
    setShadowsOn(renderer, scene, this.was.enabled);
    renderer.shadowMap.autoUpdate = this.was.autoUpdate;
    resizeShadow(sun, this.was.size);
    renderer.shadowMap.needsUpdate = true;
    entry.batcher?.enable(false);
    capPictures(0);
    if (this.outline && this.parts.stage.effect) this.parts.stage.effect.renderOutline = this.outline;
    this.outline = null;
  }

  private applyAll() {
    for (const k of ['shadows', 'hotTextureEveryMs', 'batching', 'textureCap'] as const) this.apply(k);
  }

  /** What changing knob `k` of the top profile does there and then (the rest are read every frame). */
  private apply(k: keyof SceneQuality) {
    const e = this.top();
    if (!e) return;
    const q = e.q;
    switch (k) {
      case 'shadows':
      case 'shadowMapSize':
      case 'shadowEveryMs': {
        const { renderer } = this.ctx;
        const { sun, scene } = this.parts.stage;
        setShadowsOn(renderer, scene, q.shadows !== 'off');
        renderer.shadowMap.autoUpdate = q.shadows === 'on';
        resizeShadow(sun, q.shadowMapSize);
        renderer.shadowMap.needsUpdate = true;
        this.shadowAt = -Infinity;
        break;
      }
      case 'hotTextureEveryMs':
        this.hot.every = q.hotTextureEveryMs;
        if (this.hot.every > 0) this.hot.patch();
        else this.hot.unpatch();
        break;
      case 'batching':
        e.batcher?.enable(q.batching);
        break;
      case 'textureCap':
        capPictures(q.textureCap);
        break;
    }
  }

  private frame(now: number) {
    const q = this.top()!.q;
    const { renderer, camera, office } = this.ctx;
    const { scene } = this.parts.stage;
    if (!q.halos) for (const h of this.halos) h.visible = false;
    if (skyUniforms.skyLampCount.value > q.maxLamps) skyUniforms.skyLampCount.value = Math.max(0, q.maxLamps);
    if (!this.ctx.upTop() && q.sceneryReach < 1) office.scenic.cull(camera.position, office.night.street, (scene.fog as THREE.Fog).far * q.sceneryReach);
    if (q.shadows === 'throttled' && now - this.shadowAt >= q.shadowEveryMs) {
      renderer.shadowMap.needsUpdate = true;
      this.shadowAt = now;
    }
    this.hot.flush(now);
  }
}

const profiles = new WeakMap<Ctx, Profiles>();

/** Puts profile `q` on, over whatever was, until `host` ends; the knobs change it live. */
export function applyQuality<Q extends SceneQuality>(ctx: Ctx, parts: Pick<Parts, 'stage'>, host: QualityHost, q: Q, deps: QualityDeps = {}): OnQuality<Q> {
  let p = profiles.get(ctx);
  if (!p) profiles.set(ctx, (p = new Profiles(ctx, parts)));
  return p.push(q, host, deps);
}

/** Each session's knobs, for the perf overlay (which starts before quality does: see knobsOf). */
const running = new WeakMap<VrSession, VrKnobs>();

/** The knobs of session `s`, once startQuality has run for it. */
export function knobsOf(s: VrSession): VrKnobs | undefined {
  return running.get(s);
}

/** The quality profile in play for the session (`s.quality`, changed in place by `set`), until it ends. */
export function startQuality(ctx: Ctx, parts: Pick<Parts, 'stage'>, s: VrSession, deps: QualityDeps = {}): VrKnobs {
  const { renderer } = ctx;
  const q = s.quality;
  function frameRate() {
    const rate = q.frameRate;
    const supported = s.xr.supportedFrameRates;
    if (rate === null || typeof s.xr.updateTargetFrameRate !== 'function') return;
    if (supported && !Array.from(supported).includes(rate)) return;
    s.xr.updateTargetFrameRate(rate).catch(() => {});
  }
  const on = applyQuality(ctx, parts, s, q, deps);
  frameRate();
  s.onEnd(() => running.delete(s));

  const knobs: VrKnobs = {
    quality: q,
    set(k, v) {
      if (q[k] === v) return;
      switch (k) {
        case 'name':
          return;
        case 'framebufferScale':
          q.framebufferScale = v as number;
          saveVrPrefs({ scale: q.framebufferScale });
          return;
        case 'foveation':
          q.foveation = v as number;
          renderer.xr.setFoveation(clamp(q.foveation, 0, 1));
          return;
        case 'frameRate':
          q.frameRate = v as number | null;
          frameRate();
          return;
        case 'panelScale':
          q.panelScale = v as number;
          return;
        default:
          on.set(k as keyof SceneQuality, v as never);
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
