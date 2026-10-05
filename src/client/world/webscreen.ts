/**
 * A YouTube video on a screen in the world, through YouTube's own embedded player (webscreen-player.ts).
 *
 * An iframe can't be a texture, so the player is a DOM element laid exactly over the screen's mesh
 * (three's CSS3DRenderer works out the transform), in a layer BEHIND the office's canvas. The mesh gets
 * a cover that writes nothing but zero alpha, with no blending: a hole in the canvas the player shows
 * through. Whatever the scene draws in front of the screen (furniture, people, your own hands) is drawn
 * over the hole as it's drawn over anything else, so it hides the video with no work here.
 *
 * A player only runs while its screen is on the floor you're on, near and in view (or can be heard):
 * a few at once, the nearest first. The rest, and one whose video hasn't started, show the video's
 * thumbnail on the cover instead, with the same label under it.
 */
import './webscreen.css';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Ctx } from '../core/context';
import { Embed, YT } from './webscreen-player';

export { youtubeId } from '../../shared/youtube';

/** A YouTube video playing on a flat screen in the world, through YouTube's own embedded player. */
export interface WebScreen {
  /** Plays the video `id` on the screen from `start` seconds (default 0), or takes the player off with null. */
  show(video: { id: string; start?: number } | null): void;
  /** 0..1; 0 mutes. Starts muted. */
  volume(v: number): void;
  /** Seconds into the video, and its length (0 until the player knows). */
  time(): number;
  duration(): number;
  seek(seconds: number): void;
  /** Called when the video ends, and when it can't be played (embedding off, removed): `why` says which. */
  onEnded(fn: (why: 'ended' | 'error') => void): void;
  /** Whether the player is up and playing. */
  readonly playing: boolean;
  /** Moves it onto `mesh`: its screen was built again (a piece of furniture is, whenever it's repainted). */
  attach(mesh: THREE.Mesh): void;
  /** Stops caring about this screen for good. */
  dispose(): void;
}

/** How far off a screen's player starts (metres), and how far off one that's running is kept. */
const RANGE = 25;
const RANGE_KEEP = 28;
/** The most players running at once: the nearest screens get them. */
const MAX_PLAYERS = 3;
/** How long a screen plays on after it's gone out of view, and how long its player is kept (paused) for a look back, in milliseconds. */
const GLANCE = 1500;
const KEEP = 20_000;
/** How long a video may take to start before it's given up on (it's a première that hasn't begun, or the browser won't play it), in milliseconds. */
const STALL = 20_000;
/** How wide the player's element is, in CSS pixels: what YouTube sizes its picture for. Its height follows the screen's shape. */
const PX = 960;
/** How much of the screen's height the label under the video takes. */
const STRIP = 0.11;
/** How tall the label's letters are, as a share of the strip. */
const TYPE = 0.5;
const SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif";
const STRIP_BG = '#12141c';

/** The hole: zero alpha written straight to the canvas, so the layer behind it shows. */
const HOLE = new THREE.MeshBasicMaterial({ color: '#000000', opacity: 0, blending: THREE.NoBlending, fog: false, toneMapped: false });
HOLE.userData.outlineParameters = { visible: false };
/** One unit square for every cover, sized by its screen: never let go of with a piece (see disposePiece). */
const SQUARE = new THREE.PlaneGeometry(1, 1);

/** A video's thumbnail, fetched through the office (GET /api/image): the sharp one, and the one every video has. */
const thumbs = (id: string) => [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`].map((url) => `/api/image?url=${encodeURIComponent(url)}`);

/** A player on a screen: its element behind the canvas, and YouTube's player in it. */
interface Live {
  el: HTMLDivElement;
  label: HTMLDivElement;
  object: CSS3DObject;
  embed: Embed;
  /** The video has played: until then the thumbnail stays up. */
  started: boolean;
  /** How long it has been asked to play without starting, in milliseconds. */
  waited: number;
  /** It's been asked to play, rather than to wait (out of view, or the tab hidden). */
  asked: boolean;
}

class MeshScreen implements WebScreen {
  /** When it was last in view, and how far off it is. */
  seen = -Infinity;
  dist = Infinity;
  private mesh!: THREE.Mesh;
  private w = 1;
  private h = 1;
  private readonly cover: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** The cover while no player shows: the thumbnail and the label, drawn on a canvas. */
  private readonly still = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  private canvas = document.createElement('canvas');
  private thumb: HTMLImageElement | null = null;
  private video: string | null = null;
  /** Seconds into the video: the player's, or counted on from where it was while there's none. */
  private at = 0;
  private length = 0;
  private loud = 0;
  private text = '';
  private live: Live | null = null;
  private ended: ((why: 'ended' | 'error') => void) | null = null;
  /** The video's end (or that it can't be played) has been told, and nothing's been shown since. */
  private done = false;
  private gone = false;

  constructor(
    private readonly stage: Stage,
    mesh: THREE.Mesh,
    private readonly title?: () => string,
  ) {
    this.still.userData.outlineParameters = { visible: false };
    this.cover = new THREE.Mesh(SQUARE, this.still);
    this.cover.userData.shared = true;
    this.cover.position.z = 0.004;
    this.cover.visible = false;
    // Nothing to aim at or click of its own: what's behind it is.
    this.cover.raycast = () => {};
    // Drawn into a texture (a filter over the whole frame, like the drunk vision), a hole would come out black.
    this.cover.onBeforeRender = (renderer) => {
      if (renderer.getRenderTarget()) stage.filtered = performance.now();
    };
    this.attach(mesh);
  }

  get playing(): boolean {
    return !!this.live && this.live.embed.state === YT.playing;
  }

  on(mesh: THREE.Mesh): boolean {
    return this.mesh === mesh;
  }

  attach(mesh: THREE.Mesh) {
    if (this.gone || (mesh === this.mesh && this.cover.parent === mesh)) return;
    this.mesh = mesh;
    const size = (mesh.geometry as Partial<THREE.PlaneGeometry>).parameters;
    const [w, h] = [size?.width || 1.6, size?.height || 0.9];
    mesh.add(this.cover);
    this.cover.scale.set(w, h, 1);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    // Another shape of screen: its player is made again to fit, and its picture drawn again.
    this.stop();
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX;
    this.canvas.height = Math.round((PX * h) / w);
    this.still.map?.dispose();
    this.still.map = new THREE.CanvasTexture(this.canvas);
    this.still.map.colorSpace = THREE.SRGBColorSpace;
    this.still.map.anisotropy = 8;
    this.still.needsUpdate = true;
    this.paint();
  }

  show(video: { id: string; start?: number } | null) {
    if (this.gone) return;
    this.done = false;
    if (!video) {
      this.video = null;
      this.stop();
      this.cover.visible = false;
      return;
    }
    const same = video.id === this.video;
    this.video = video.id;
    this.at = Math.max(0, video.start ?? 0);
    if (!same) {
      this.length = 0;
      this.picture(video.id);
    }
    const live = this.live;
    if (!live) return;
    live.waited = 0;
    if (same) {
      live.embed.seek(this.at);
      if (live.asked) live.embed.play();
      return;
    }
    live.started = false;
    live.embed.load(video.id, this.at);
  }

  volume(v: number) {
    this.loud = Math.max(0, Math.min(1, v));
    this.live?.embed.volume(this.loud);
  }

  time(): number {
    return this.at;
  }

  duration(): number {
    return this.length;
  }

  seek(seconds: number) {
    this.at = Math.max(0, seconds);
    this.live?.embed.seek(this.at);
  }

  onEnded(fn: (why: 'ended' | 'error') => void) {
    this.ended = fn;
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    this.stop();
    this.cover.removeFromParent();
    this.still.map?.dispose();
    this.still.dispose();
    this.thumb = null;
    this.stage.screens.delete(this);
  }

  /** Whether it's somewhere a player could show: in the scene that's drawn, with nothing over it hidden. */
  private standing(): boolean {
    let o: THREE.Object3D | null = this.mesh;
    for (; o; o = o.parent) {
      if (!o.visible) return false;
      if (o === this.stage.ctx.scene) return true;
    }
    return false;
  }

  /** Where it is from the camera: how far, and whether it's in view (from in front of it). Whether it could have a player at all. */
  look(now: number, camera: THREE.Camera, frustum: THREE.Frustum): boolean {
    if (!this.video || this.done || !this.standing()) return false;
    const m = this.mesh.matrixWorld.elements;
    const dx = camera.position.x - m[12];
    const dy = camera.position.y - m[13];
    const dz = camera.position.z - m[14];
    this.dist = Math.hypot(dx, dy, dz);
    // Its face is its own +z.
    const front = dx * m[8] + dy * m[9] + dz * m[10] > 0;
    if (front && frustum.intersectsObject(this.mesh)) this.seen = now;
    return this.loud > 0 || (this.dist <= (this.live ? RANGE_KEEP : RANGE) && now - this.seen < (this.live ? KEEP : GLANCE));
  }

  /**
   * Lower is first in line for a player: one that's heard, then the ones in view before the ones only
   * kept for a look back, then the nearest; and one that has a player keeps it over another as near.
   */
  rank(now: number): number {
    return (this.loud > 0 ? -1000 : 0) + (now - this.seen < GLANCE ? 0 : 500) + this.dist - (this.live ? 2 : 0);
  }

  /** Each frame: `wanted` is whether it gets a player, `awake` whether the tab's up. Whether its element has to be placed. */
  frame(now: number, dt: number, wanted: boolean, awake: boolean): boolean {
    if (this.gone || !this.video) return false;
    if (wanted && !this.live) this.start();
    else if (!wanted && this.live) this.stop();
    const text = this.title?.() ?? '';
    if (text !== this.text) {
      this.text = text;
      this.paint();
      if (this.live) this.live.label.textContent = text;
    }
    const live = this.live;
    if (!live) {
      // No player: it's taken to play on, so it's where it would be when you come back to it.
      if (!this.done) this.at += dt;
      if (this.length > 0 && this.at >= this.length) {
        this.at = this.length;
        this.finish('ended');
      }
      this.dress();
      return false;
    }
    const play = awake && (this.loud > 0 || now - this.seen < GLANCE);
    if (play !== live.asked) {
      live.asked = play;
      if (play) live.embed.play();
      else live.embed.pause();
    }
    if (live.started) this.at = live.embed.time() ?? this.at;
    this.length = live.embed.duration() ?? this.length;
    if (play && !live.started && (live.waited += dt * 1000) > STALL) {
      // YouTube's player never came up at all (offline, blocked): the next one is made from scratch.
      if (!live.embed.up) this.stop();
      this.finish('error');
      return false;
    }
    // Its element, where the screen is: the mesh's own place and turn, a CSS pixel `w / PX` metres across.
    const k = this.w / PX;
    live.object.matrixWorld.copy(this.mesh.matrixWorld).multiply(SCALE.makeScale(k, k, 1));
    this.dress();
    return true;
  }

  /** The tab's hidden: nothing plays to nobody. */
  hush() {
    if (!this.live?.asked) return;
    this.live.asked = false;
    this.live.embed.pause();
  }

  private finish(why: 'ended' | 'error') {
    if (this.done || this.gone) return;
    this.done = true;
    // Whoever's listening usually shows the next one, which undoes `done`.
    this.ended?.(why);
  }

  private start() {
    const height = this.canvas.height;
    const strip = this.title ? Math.round(height * STRIP) : 0;
    const el = document.createElement('div');
    el.className = 'webscreen';
    el.style.width = `${PX}px`;
    el.style.height = `${height}px`;
    const stage = document.createElement('div');
    stage.className = 'webscreen-video';
    const label = document.createElement('div');
    label.className = 'webscreen-label';
    label.style.height = label.style.lineHeight = `${strip}px`;
    label.style.fontSize = `${Math.round(strip * TYPE)}px`;
    label.style.background = STRIP_BG;
    label.textContent = this.text;
    label.hidden = !strip;
    el.append(stage, label);
    const object = new CSS3DObject(el);
    // Under the canvas there's nothing to click, and it never takes the mouse from the office.
    el.style.pointerEvents = 'none';
    object.matrixAutoUpdate = false;
    this.stage.scene.add(object);
    const live: Live = {
      el,
      label,
      object,
      started: false,
      waited: 0,
      asked: true,
      embed: new Embed(stage, { id: this.video!, start: this.at }, {
        state: (state) => {
          if (this.live !== live) return;
          if (state === YT.playing) live.started = true;
          if (state === YT.ended) this.finish('ended');
        },
        error: () => this.live === live && this.finish('error'),
      }),
    };
    live.embed.volume(this.loud);
    this.live = live;
  }

  private stop() {
    const live = this.live;
    if (!live) return;
    this.live = null;
    live.embed.destroy();
    // Takes its element out of the layer too.
    live.object.removeFromParent();
    live.el.remove();
    this.dress();
  }

  /** The cover is the hole while a player has a picture to show through it, and the thumbnail otherwise. */
  private dress() {
    this.cover.visible = !!this.video;
    const live = this.live;
    const state = live?.embed.state;
    const showing = !!live && live.started && !this.done && (state === YT.playing || state === YT.paused || state === YT.buffering);
    const hole = showing && performance.now() - this.stage.filtered > 250;
    this.cover.material = hole ? HOLE : this.still;
  }

  /** Fetches the thumbnail of `id`: the sharp one, or the one every video has. */
  private picture(id: string) {
    this.thumb = null;
    this.paint();
    const urls = thumbs(id);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (this.gone || this.video !== id) return;
      this.thumb = img;
      this.paint();
    };
    img.onerror = () => {
      const next = urls.shift();
      if (next && !this.gone && this.video === id) img.src = next;
    };
    img.src = urls.shift()!;
  }

  /** Draws the cover's picture: the thumbnail, whole, over black, and the label under it as the player's element has it. */
  private paint() {
    const { width, height } = this.canvas;
    const g = this.canvas.getContext('2d');
    if (!g || !this.still.map) return;
    const strip = this.title ? Math.round(height * STRIP) : 0;
    g.fillStyle = '#000000';
    g.fillRect(0, 0, width, height);
    const img = this.thumb;
    if (img?.naturalWidth) {
      const k = Math.min(width / img.naturalWidth, (height - strip) / img.naturalHeight);
      const [w, h] = [img.naturalWidth * k, img.naturalHeight * k];
      g.drawImage(img, (width - w) / 2, (height - strip - h) / 2, w, h);
    }
    if (strip) {
      g.fillStyle = STRIP_BG;
      g.fillRect(0, height - strip, width, strip);
      g.fillStyle = '#ffffff';
      g.font = `600 ${Math.round(strip * TYPE)}px ${SANS}`;
      g.textBaseline = 'middle';
      const pad = Math.round(width * 0.02);
      let text = this.text;
      // Cut to fit, as the element's own label is.
      if (g.measureText(text).width > width - pad * 2) {
        while (text.length > 1 && g.measureText(`${text}…`).width > width - pad * 2) text = text.slice(0, -1);
        text = `${text.trimEnd()}…`;
      }
      g.fillText(text, pad, height - strip / 2);
    }
    this.still.map.needsUpdate = true;
  }
}

const SCALE = new THREE.Matrix4();

/** The layer behind the office's canvas, and every screen with a video on it. */
class Stage {
  readonly screens = new Set<MeshScreen>();
  /** The players' elements, as CSS3DObjects: a scene of their own, placed by hand each frame. */
  readonly scene = new THREE.Scene();
  /** When the frame was last drawn into a texture rather than onto the canvas (see MeshScreen's cover). */
  filtered = -Infinity;
  private readonly css = new CSS3DRenderer();
  private readonly frustum = new THREE.Frustum();
  private readonly m = new THREE.Matrix4();

  constructor(readonly ctx: Ctx) {
    this.scene.matrixWorldAutoUpdate = false;
    const layer = this.css.domElement;
    layer.className = 'webscreens';
    layer.setAttribute('aria-hidden', 'true');
    // Behind the canvas: only a hole in it shows what's here.
    ctx.canvas.before(layer);
    const fit = () => this.css.setSize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', fit);
    fit();
    // After the office's own (the frame's drawn by then, and the camera and every mesh are where it drew them).
    ctx.ticks.add('render', ({ now, dt }) => this.frame(now, dt));
    // No frames come while the tab's hidden, so nothing else would stop them playing to nobody.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) for (const s of this.screens) s.hush();
    });
    // The keys stay the office's: a player never keeps the focus.
    window.addEventListener('blur', () => {
      const el = document.activeElement;
      if (el instanceof HTMLIFrameElement && layer.contains(el)) el.blur();
    });
  }

  private frame(now: number, dt: number) {
    if (!this.screens.size) return;
    const { ctx } = this;
    const here = !ctx.upTop();
    this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse));
    const up = [...this.screens].filter((s) => s.look(now, ctx.camera, this.frustum) && here).sort((a, b) => a.rank(now) - b.rank(now));
    const chosen = new Set(up.slice(0, MAX_PLAYERS));
    let any = false;
    for (const s of this.screens) any = s.frame(now, dt, chosen.has(s), !document.hidden) || any;
    if (any) this.css.render(this.scene, ctx.camera);
  }
}

const stages = new WeakMap<Ctx, Stage>();

/**
 * `mesh` is a THREE.Mesh with a PlaneGeometry facing its own +z (the TV's screen, a furniture piece's
 * screen). `title` is a line shown under the video (who and what). Asked again for a mesh that has a
 * screen, it hands that one back; a screen whose mesh is built again moves to the new one with `attach`.
 */
export function webScreen(ctx: Ctx, mesh: THREE.Mesh, opts: { title?: () => string } = {}): WebScreen {
  let stage = stages.get(ctx);
  if (!stage) stages.set(ctx, (stage = new Stage(ctx)));
  for (const s of stage.screens) if (s.on(mesh)) return s;
  const screen = new MeshScreen(stage, mesh, opts.title);
  stage.screens.add(screen);
  return screen;
}
