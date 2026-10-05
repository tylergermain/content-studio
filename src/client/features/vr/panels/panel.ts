/**
 * One panel of the live page in VR: a flat mesh in the office whose texture is painted from part of
 * the page (paint.ts). It shows one or more segments, each a client rect of the page placed on its
 * canvas (a window is one; the hint strip stacks the newest toasts over the hint bar). It keeps what
 * changed since it was painted (dirty.ts), paints a slice at a time, and uploads only the part that
 * changed (copyTextureToTexture); <canvas> and <video> in it are live quads of their own over it. A
 * sheet lets the ray through where nothing's painted (its ink, kept on a coarse grid).
 */
import * as THREE from 'three';
import { noOutline } from '../../../core/outline';
import { DirtyRects, due, watch, type Pace } from './dirty';
import { intersect, overlaps, textureScale, type Pose, type Rect } from './layout';
import { PaintJob } from './paint';
import { fit, sameOrigin } from './paint-parts';

export interface Segment {
  readonly el: Element;
  /** Its client rect, as the page has it now. */
  readonly src: Rect;
  /** Where it goes on the panel, in panel px (CSS px). */
  readonly at: { readonly x: number; readonly y: number };
}

export interface PanelOpts {
  readonly id: string;
  readonly order: number;
  readonly pace: Pace;
  /** An opaque base under each segment's root (a window's glass), or what it is for each root. */
  readonly base?: string | null | ((root: Element) => string | null);
  /** Whether each root's own background is painted. */
  readonly rootBox?: boolean;
  /** Whether a ray passes where nothing's painted. */
  readonly seeThrough?: boolean;
  skip?(el: Element): boolean;
}

/** A live <canvas> or <video> over the panel. */
interface Sub {
  readonly el: HTMLCanvasElement | HTMLVideoElement;
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly texture: THREE.Texture;
  uploaded: number;
}

/** Ink grid cells, in CSS px. */
const CELL = 8;
const plane = new THREE.PlaneGeometry(1, 1);

function material(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** Whether a video's frames can go on a texture: a stream, this origin's, or fetched with CORS. */
function videoOk(v: HTMLVideoElement): boolean {
  const src = v.currentSrc || v.src;
  return !!v.srcObject || !!v.crossOrigin || !src || sameOrigin(src, document.baseURI);
}

/** Whether a 2D canvas has had another origin's picture drawn on it (its upload would throw). WebGL canvases can't be. */
function tainted(c: HTMLCanvasElement): boolean {
  if (!c.width || !c.height) return true;
  try {
    const g = c.getContext('2d');
    g?.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

export class DomPanel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly dirty = new DirtyRects();
  readonly pose: Pose = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
  segments: Segment[] = [];
  /** Panel size in CSS px, the texture's px per CSS px, and meters per CSS px. */
  w = 0;
  h = 0;
  scale = 1;
  mpp = 0.0011;
  shown = false;
  /** Put where it is by hand (the grip): it stays there until the window changes. */
  pinned = false;
  lastPaint = -Infinity;
  lastCost = 0;
  /** Looked at lately, for the safety repaint. */
  lookedAt = false;

  /** Whether the texture has had a whole paint since it was made. */
  private painted = false;
  private canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private texture: THREE.Texture | null = null;
  private readonly source = new THREE.Texture();
  private jobs: { job: PaintJob; region: Rect }[] = [];
  /** The canvas pixels a partial paint changes (x0, y0, x1, y1), uploaded alone once it's done; null for a whole paint. */
  private px: [number, number, number, number] | null = null;
  private full = false;
  private ink = new Uint8Array(0);
  private inkCols = 0;
  private readonly subs = new Map<Element, Sub>();
  private subsAt = -Infinity;
  private unwatch: (() => void)[] = [];
  private watched: Element[] = [];

  constructor(readonly opts: PanelOpts) {
    this.mesh = new THREE.Mesh(plane, material(null));
    this.mesh.name = `vr-panel-${opts.id}`;
    this.mesh.renderOrder = opts.order;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    noOutline(this.mesh);
  }

  get id(): string {
    return this.opts.id;
  }

  /** Shows these segments, `size` big (CSS px), `mpp` meters a px: a new size is a new canvas and texture, and a whole new paint. */
  setSegments(segments: Segment[], size: { w: number; h: number }, mpp: number, scale: number): void {
    const same = segments.length === this.segments.length && segments.every((s, i) => s.el === this.segments[i].el);
    this.segments = segments;
    this.mpp = mpp;
    const w = Math.max(1, Math.round(size.w));
    const h = Math.max(1, Math.round(size.h));
    const sc = textureScale(w, h, scale);
    if (w !== this.w || h !== this.h || Math.abs(sc - this.scale) > 0.01 || !this.texture) this.resize(w, h, sc);
    else if (!same) {
      this.cancel();
      this.dirty.all();
      // Another window in the same place: hidden until it's painted, rather than showing the last one.
      if (segments.length === 1) this.painted = this.mesh.visible = false;
    }
    this.mesh.scale.set(w * mpp, h * mpp, 1);
  }

  private resize(w: number, h: number, scale: number) {
    this.cancel();
    this.w = w;
    this.h = h;
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(w * scale));
    this.canvas.height = Math.max(1, Math.round(h * scale));
    this.g = this.canvas.getContext('2d')!;
    this.texture?.dispose();
    const t = new THREE.Texture(this.canvas);
    t.flipY = false;
    // Canvas row 0 is the panel's top: v runs down the texture.
    t.repeat.set(1, -1);
    t.offset.set(0, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.anisotropy = 4;
    t.userData.vrHot = false;
    this.texture = t;
    this.source.image = this.canvas;
    this.mesh.material.map = t;
    this.mesh.material.needsUpdate = true;
    this.painted = false;
    this.inkCols = Math.ceil(w / CELL);
    this.ink = new Uint8Array(this.inkCols * Math.ceil(h / CELL));
    this.dirty.all();
  }

  /** Watches these roots for changes (`skip`: what under them isn't the panel's). */
  watch(roots: Element[]): void {
    if (roots.length === this.watched.length && roots.every((r, i) => r === this.watched[i])) return;
    this.unwatchAll();
    this.watched = roots;
    this.unwatch = roots.map((r) => watch(r, this.dirty, this.opts.skip));
    this.dirty.all();
  }

  unwatchAll(): void {
    for (const off of this.unwatch) off();
    this.unwatch = [];
    this.watched = [];
  }

  /** Puts it at a pose (yaw about up, then pitch about its own x). */
  place(p: Pose): void {
    this.pose.position = { ...p.position };
    this.pose.yaw = p.yaw;
    this.pose.pitch = p.pitch;
    this.mesh.position.set(p.position.x, p.position.y, p.position.z);
    this.mesh.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    this.mesh.updateMatrixWorld(true);
  }

  show(on: boolean): void {
    this.shown = on;
    this.mesh.visible = on && this.painted;
    if (!on) {
      this.cancel();
      this.lookedAt = false;
    }
  }

  /** The client point (and its segment) under a uv; `free`: past the edges too, through the first segment (a captured drag). */
  clientAt(u: number, v: number, free = false): { x: number; y: number; seg: Segment } | null {
    const px = u * this.w;
    const py = (1 - v) * this.h;
    for (const s of this.segments) {
      if (px >= s.at.x && px <= s.at.x + s.src.w && py >= s.at.y && py <= s.at.y + s.src.h) return { x: s.src.x + px - s.at.x, y: s.src.y + py - s.at.y, seg: s };
    }
    const s = this.segments[0];
    return free && s ? { x: s.src.x + px - s.at.x, y: s.src.y + py - s.at.y, seg: s } : null;
  }

  /** Where a client rect of a segment is on the mesh, in its local units (-0.5..0.5, y up). */
  local(seg: Segment, r: Rect): { x: number; y: number; w: number; h: number } {
    const x = seg.at.x + r.x - seg.src.x;
    const y = seg.at.y + r.y - seg.src.y;
    return { x: (x + r.w / 2) / this.w - 0.5, y: 0.5 - (y + r.h / 2) / this.h, w: r.w / this.w, h: r.h / this.h };
  }

  /** Whether something's painted under a uv (always, unless it's see-through). */
  inked(u: number, v: number): boolean {
    if (!this.opts.seeThrough) return true;
    const x = Math.floor((u * this.w) / CELL);
    const y = Math.floor(((1 - v) * this.h) / CELL);
    return x >= 0 && x < this.inkCols && !!this.ink[y * this.inkCols + x];
  }

  private markInk(seg: Segment, r: Rect) {
    const x0 = Math.max(0, Math.floor((seg.at.x + r.x - seg.src.x) / CELL));
    const y0 = Math.max(0, Math.floor((seg.at.y + r.y - seg.src.y) / CELL));
    const x1 = Math.min(this.inkCols - 1, Math.floor((seg.at.x + r.x + r.w - seg.src.x) / CELL));
    const rows = this.ink.length / Math.max(1, this.inkCols);
    const y1 = Math.min(rows - 1, Math.floor((seg.at.y + r.y + r.h - seg.src.y) / CELL));
    for (let y = y0; y <= y1; y++) this.ink.fill(1, y * this.inkCols + x0, y * this.inkCols + x1 + 1);
  }

  /** Whether it's due a paint now. */
  due(now: number): boolean {
    return this.shown && !this.jobs.length && this.segments.length > 0 && due(now, this.lastPaint, this.lastCost, this.opts.pace, this.dirty.any, this.lookedAt);
  }

  get painting(): boolean {
    return this.jobs.length > 0;
  }

  /** Starts a paint of what changed (or of all of it: a panel of several segments is always painted whole). */
  start(now: number, focus: Element | null): void {
    const one = this.segments.length === 1 ? this.segments[0] : null;
    const safety = !this.dirty.any;
    let region: Rect | null;
    if (!one || safety) {
      this.dirty.take({ x: 0, y: 0, w: 0, h: 0 });
      region = null;
    } else {
      region = this.dirty.take(one.src);
      if (!region) return;
    }
    this.full = !region || (region.w >= one!.src.w - 1 && region.h >= one!.src.h - 1);
    this.px = null;
    if (!this.full && one && region) {
      const sc = this.scale;
      const x = one.at.x + region.x - one.src.x;
      const y = one.at.y + region.y - one.src.y;
      this.px = [Math.max(0, Math.floor(x * sc) - 1), Math.max(0, Math.floor(y * sc) - 1), Math.min(this.canvas.width, Math.ceil((x + region.w) * sc) + 1), Math.min(this.canvas.height, Math.ceil((y + region.h) * sc) + 1)];
    }
    if (this.opts.seeThrough) {
      if (this.full) this.ink.fill(0);
      else if (one && region) this.clearInk(one, region);
    }
    this.jobs = this.segments.map((seg) => {
      const r = this.full ? seg.src : intersect(region!, seg.src) ?? { x: seg.src.x, y: seg.src.y, w: 0, h: 0 };
      return {
        region: r,
        job: new PaintJob(this.g, {
          root: seg.el,
          src: seg.src,
          dst: seg.at,
          scale: this.scale,
          region: r,
          base: typeof this.opts.base === 'function' ? this.opts.base(seg.el) : this.opts.base,
          rootBox: this.opts.rootBox,
          focus,
          skip: this.opts.skip,
          ink: this.opts.seeThrough ? (ir) => this.markInk(seg, ir) : undefined,
          again: () => this.dirty.all(),
        }),
      };
    });
    if (this.full) this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.lastPaint = now;
    this.lastCost = 0;
  }

  private clearInk(seg: Segment, r: Rect) {
    const x0 = Math.ceil((seg.at.x + r.x - seg.src.x) / CELL);
    const x1 = Math.floor((seg.at.x + r.x + r.w - seg.src.x) / CELL) - 1;
    const y0 = Math.ceil((seg.at.y + r.y - seg.src.y) / CELL);
    const y1 = Math.floor((seg.at.y + r.y + r.h - seg.src.y) / CELL) - 1;
    for (let y = y0; y <= y1; y++) if (x1 >= x0) this.ink.fill(0, y * this.inkCols + Math.max(0, x0), y * this.inkCols + Math.min(this.inkCols, x1 + 1));
  }

  /** Paints on until `until`: true when the paint's done and uploaded. */
  step(until: number, renderer: THREE.WebGLRenderer): boolean {
    while (this.jobs.length) {
      const j = this.jobs[0];
      const done = j.job.step(until);
      this.lastCost += j.job.cost;
      j.job.cost = 0;
      if (!done) return false;
      this.jobs.shift();
    }
    this.upload(renderer);
    this.painted = true;
    if (this.shown) this.mesh.visible = true;
    return true;
  }

  private upload(renderer: THREE.WebGLRenderer) {
    const t = this.texture;
    if (!t) return;
    if (this.full || !this.px || t.version === 0) {
      t.needsUpdate = true;
      return;
    }
    // Only what changed: its pixels, from the canvas, into the texture already there.
    const [x0, y0, x1, y1] = this.px;
    if (x1 <= x0 || y1 <= y0) return;
    try {
      renderer.copyTextureToTexture(this.source, t, new THREE.Box2(new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y1)), new THREE.Vector2(x0, y0));
    } catch {
      t.needsUpdate = true;
    }
  }

  /** Stops a paint under way (what it had painted stays on the canvas, not uploaded). */
  cancel(): void {
    for (const j of this.jobs) j.job.cancel();
    if (this.jobs.length) this.dirty.all();
    this.jobs = [];
  }

  /** Keeps the live quads over the <canvas> and <video> elements it shows: found again twice a second, uploaded up to `hz` a second. */
  updateSubs(now: number, hz: number): void {
    if (!this.shown) return;
    if (now - this.subsAt > 500) {
      this.subsAt = now;
      const seen = new Set<Element>();
      for (const seg of this.segments) {
        for (const el of seg.el.querySelectorAll<HTMLCanvasElement | HTMLVideoElement>('canvas, video')) {
          if (this.opts.skip?.(el) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          const b = el.getBoundingClientRect();
          const r = intersect({ x: b.left, y: b.top, w: b.width, h: b.height }, seg.src);
          if (!r || r.w < 4 || r.h < 4) continue;
          const sub = this.subs.get(el) ?? this.makeSub(el);
          if (!sub) continue;
          seen.add(el);
          this.placeSub(sub, seg, { x: b.left, y: b.top, w: b.width, h: b.height }, r);
        }
      }
      for (const [el, sub] of this.subs) if (!seen.has(el)) this.dropSub(el, sub);
    }
    for (const sub of this.subs.values()) {
      if (sub.el instanceof HTMLCanvasElement && now - sub.uploaded >= 1000 / hz) {
        sub.uploaded = now;
        sub.texture.needsUpdate = true;
      }
    }
  }

  private makeSub(el: HTMLCanvasElement | HTMLVideoElement): Sub | null {
    if (el instanceof HTMLCanvasElement ? tainted(el) : !videoOk(el)) return null;
    const texture = el instanceof HTMLVideoElement ? new THREE.VideoTexture(el) : new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.userData.vrHot = false;
    const mesh = new THREE.Mesh(plane, material(texture));
    mesh.renderOrder = this.opts.order + 1;
    mesh.frustumCulled = false;
    this.mesh.add(mesh);
    const sub: Sub = { el, mesh, texture, uploaded: -Infinity };
    this.subs.set(el, sub);
    return sub;
  }

  /** Over `full` (its whole box, client px), showing only the part `r` the panel shows; a video letterboxed as object-fit has it. */
  private placeSub(sub: Sub, seg: Segment, full: Rect, r: Rect) {
    let box = full;
    if (sub.el instanceof HTMLVideoElement && sub.el.videoWidth) {
      const f = fit(sub.el.videoWidth, sub.el.videoHeight, full, getComputedStyle(sub.el).objectFit || 'contain');
      box = { x: f.dx, y: f.dy, w: f.dw, h: f.dh };
    }
    const shown = intersect(box, r);
    if (!shown || !overlaps(shown, seg.src)) {
      sub.mesh.visible = false;
      return;
    }
    const l = this.local(seg, shown);
    sub.mesh.visible = true;
    sub.mesh.position.set(l.x, l.y, 0);
    sub.mesh.scale.set(l.w, l.h, 1);
    // The part of the picture that's on the panel (the texture's v runs up).
    const u0 = (shown.x - box.x) / box.w;
    const v0 = 1 - (shown.y + shown.h - box.y) / box.h;
    sub.texture.repeat.set(shown.w / box.w, shown.h / box.h);
    sub.texture.offset.set(u0, v0);
  }

  private dropSub(el: Element, sub: Sub) {
    sub.mesh.removeFromParent();
    sub.mesh.material.dispose();
    sub.texture.dispose();
    this.subs.delete(el);
  }

  dispose(): void {
    this.cancel();
    this.unwatchAll();
    for (const [el, sub] of this.subs) this.dropSub(el, sub);
    this.mesh.removeFromParent();
    this.texture?.dispose();
    this.mesh.material.dispose();
  }
}
