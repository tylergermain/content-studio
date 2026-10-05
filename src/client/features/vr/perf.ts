/**
 * Measuring VR, in the headset and in the headless checks (tests/support/vr-perf.mjs, docs/vr.md).
 * Every XR frame: how long it took the page (CPU ms, from before the ticks to after the frame is
 * drawn), the GPU's time where the browser can time it (EXT_disjoint_timer_query_webgl2, only while the
 * overlay is up), and what was drawn (renderer.info, kept for the whole frame rather than reset at each
 * render call). Each second becomes a VrPerfSample (`samples`, the last ten minutes), and the frames
 * themselves are kept a little while (`frames`) for medians and p95s.
 *
 * Both sticks clicked (interact.ts) brings up the overlay: the numbers, a button for each quality knob
 * (quality.ts) to flip for an A/B right there, and Leave VR.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { KNOB_STEPS, nextValue } from './quality-profile';
import { knobsOf } from './quality';
import { saveVrPrefs } from './prefs';
import type { Hand, PanelHost, VrDebug, VrPerf, VrPerfSample, VrQuality, VrSession } from './types';

/** One XR frame, measured. */
export interface VrFrameStat {
  at: number;
  /** ms since the frame before. */
  dt: number;
  cpuMs: number;
  calls: number;
  triangles: number;
}

/** What perf.ts gives the headless checks, beyond VrPerf. */
export interface VrPerfDebug extends VrPerf {
  /** The last few hundred frames. */
  readonly frames: readonly VrFrameStat[];
  /** GPU times (ms) as they come back from the timer queries. */
  readonly gpu: readonly number[];
  readonly shown: boolean;
  /** What's being drawn now, by part of the scene (see census). */
  census(): CensusRow[];
  /**
   * Puts you at (x, y, z) facing `facing` (a rotY), from inside the next frame's move, so the rig takes
   * the headset with you (a spot to measure from: the headless checks call it; window.__office has the rest).
   */
  goTo(x: number, y: number, z: number, facing?: number): void;
}

const KEEP_SAMPLES = 600;
const KEEP_FRAMES = 900;

/** The middle of `xs` (0 for none). */
export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** The value `q` of the way up `xs` once sorted (0 for none). */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** A second's frames as a sample: late frames are those that took over one and a half frames at `hz`. */
export function summarize(frames: readonly VrFrameStat[], hz: number, extra: Pick<VrPerfSample, 'gpuMs' | 'programs' | 'textures' | 'paintMs'>, at = frames.at(-1)?.at ?? 0): VrPerfSample {
  const span = frames.reduce((n, f) => n + f.dt, 0);
  const late = frames.filter((f) => f.dt > 1.5 * (1000 / hz)).length;
  return {
    at,
    fps: span > 0 ? (frames.length * 1000) / span : 0,
    late: frames.length ? (late * 100) / frames.length : 0,
    cpuMs: median(frames.map((f) => f.cpuMs)),
    calls: Math.round(median(frames.map((f) => f.calls))),
    triangles: Math.round(median(frames.map((f) => f.triangles))),
    ...extra,
  };
}

export function startPerf(ctx: Ctx, _parts: Pick<Parts, 'stage'>, s: VrSession, panels: PanelHost): VrPerfDebug {
  const { renderer, player } = ctx;
  const info = renderer.info;
  const wasAutoReset = info.autoReset;
  info.autoReset = false;
  const samples: VrPerfSample[] = [];
  const frames: VrFrameStat[] = [];
  const gpu: number[] = [];
  const timer = gpuTimer(renderer);
  let second: VrFrameStat[] = [];
  let secondAt = performance.now();
  let t0 = 0;
  let lastBefore = 0;

  const hz = () => s.xr.frameRate ?? s.quality.frameRate ?? 72;
  const paintMs = () => (window as unknown as { __vr?: VrDebug }).__vr?.panels?.lastPaintMs ?? 0;

  const overlay = makeOverlay(ctx, s, {
    latest: () => samples.at(-1) ?? null,
    p95: () => quantile(frames.slice(-120).map((f) => f.cpuMs), 0.95),
    gpuOn: () => !!timer,
  });
  s.around({
    before() {
      t0 = performance.now();
      info.reset();
      timer?.poll(gpu);
      if (overlay.shown) timer?.begin();
      if (lastBefore) {
        const f: VrFrameStat = { at: t0, dt: t0 - lastBefore, cpuMs: 0, calls: 0, triangles: 0 };
        second.push(f);
        frames.push(f);
        if (frames.length > KEEP_FRAMES) frames.shift();
      }
      lastBefore = t0;
    },
    after() {
      timer?.end();
      const f = second.at(-1);
      if (f && f.at === t0) {
        f.cpuMs = performance.now() - t0;
        f.calls = info.render.calls;
        f.triangles = info.render.triangles;
      }
      if (t0 - secondAt < 1000 || !second.length) return;
      const recent = gpu.slice(-second.length);
      samples.push(
        summarize(second, hz(), { gpuMs: recent.length ? median(recent) : null, programs: info.programs?.length ?? 0, textures: info.memory.textures, paintMs: paintMs() }, t0),
      );
      if (samples.length > KEEP_SAMPLES) samples.shift();
      if (gpu.length > KEEP_FRAMES) gpu.splice(0, gpu.length - KEEP_FRAMES);
      second = [];
      secondAt = t0;
      overlay.dirty = true;
    },
  });

  const offPanel = panels.add(overlay.panel);
  if (s.prefs.perf) overlay.show(true);

  let going: { x: number; y: number; z: number; facing?: number } | null = null;
  s.tick('move', () => {
    if (!going) return;
    if (player.seat) player.stand();
    player.pos.set(going.x, going.y, going.z);
    player.vy = 0;
    if (going.facing !== undefined) player.facing = going.facing;
    going = null;
  });
  s.tick('hud', ({ now }) => overlay.update(now));
  s.onEnd(() => {
    offPanel();
    overlay.dispose();
    timer?.dispose();
    info.autoReset = wasAutoReset;
  });

  return {
    samples,
    frames,
    gpu,
    get shown() {
      return overlay.shown;
    },
    toggle() {
      overlay.show(!overlay.shown);
      saveVrPrefs({ perf: overlay.shown });
    },
    census: () => census(ctx, renderer.xr.isPresenting ? renderer.xr.getCamera() : ctx.camera),
    goTo(x, y, z, facing) {
      going = { x, y, z, facing };
    },
  };
}

// ---- The GPU's time ---------------------------------------------------------------------------------

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** The GPU's time for each frame, where the browser can time it: a query round the frame, read back a few frames on. */
function gpuTimer(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) return null;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  if (!ext) return null;
  const free: WebGLQuery[] = [];
  const flying: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;
  return {
    begin() {
      if (open) return;
      open = free.pop() ?? gl.createQuery();
      if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      flying.push(open);
      open = null;
    },
    /** The queries that have come back, oldest first, into `out` (ms); those spoilt by a disjoint are dropped. */
    poll(out: number[]) {
      while (flying.length && gl.getQueryParameter(flying[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = flying.shift()!;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
        if (!disjoint) out.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
        free.push(q);
      }
    },
    dispose() {
      if (open) gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (const q of [...free, ...flying]) gl.deleteQuery(q);
      if (open) gl.deleteQuery(open);
      open = null;
      free.length = flying.length = 0;
    },
  };
}

// ---- What's drawn, by part of the scene -------------------------------------------------------------

export interface CensusRow {
  /** The part of the scene: a child of the scene, or of the office's group (`office/…`). */
  part: string;
  /** Draw calls it makes per eye (a mesh per material it's drawn with), as far as what's visible and in view goes. */
  calls: number;
  triangles: number;
}

const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const sphere = new THREE.Sphere();

/** Whether `o` would be drawn from `camera`: shown all the way up, and (unless it says otherwise) in view. */
function drawn(o: THREE.Object3D): boolean {
  const m = o as THREE.Mesh;
  if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return false;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  if (!o.frustumCulled || !m.geometry) return true;
  if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
  sphere.copy(m.geometry.boundingSphere!).applyMatrix4(o.matrixWorld);
  return frustum.intersectsSphere(sphere);
}

function triangles(m: THREE.Mesh): number {
  const g = m.geometry;
  if (!g || !(m as THREE.Mesh).isMesh) return 0;
  const n = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
  const count = Math.min(n, g.drawRange.count);
  const instances = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
  return Math.floor(count / 3) * instances;
}

/**
 * Draw calls and triangles each part of the scene makes from `camera` (one eye's worth), biggest
 * first: the scene's own children, with the office's group split into its parts.
 */
export function census(ctx: Pick<Ctx, 'scene' | 'office'>, camera: THREE.Camera): CensusRow[] {
  camera.updateMatrixWorld();
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  const label = (o: THREE.Object3D, i: number) => o.name || `${o.type}#${i}`;
  const parts: [string, THREE.Object3D][] = [];
  ctx.scene.children.forEach((o, i) => {
    if (o === ctx.office.group) o.children.forEach((c, j) => parts.push([`office/${label(c, j)}`, c]));
    else parts.push([label(o, i), o]);
  });
  const rows = parts.map(([part, root]) => {
    let calls = 0;
    let tris = 0;
    root.traverse((o) => {
      if (!drawn(o)) return;
      const m = o as THREE.Mesh;
      const mats = Array.isArray(m.material) ? Math.max(1, m.geometry?.groups.length ?? 1) : 1;
      calls += mats;
      tris += triangles(m);
    });
    return { part, calls, triangles: tris };
  });
  return rows.filter((r) => r.calls > 0).sort((a, b) => b.calls - a.calls);
}

// ---- The overlay ------------------------------------------------------------------------------------

const W = 640;
const H = 820;
/** Metres a canvas pixel is in the headset: the panel is 48 cm across. */
const PX = 0.48 / W;

/** The knobs the overlay has a button for, and what each is called. */
const KNOBS: readonly [keyof VrQuality, string][] = [
  ['outline', 'Outline'],
  ['framebufferScale', 'Scale (next time)'],
  ['foveation', 'Foveation'],
  ['frameRate', 'Frame rate'],
  ['shadows', 'Shadows'],
  ['shadowMapSize', 'Shadow map'],
  ['halos', 'Night halos'],
  ['maxLamps', 'Lamps'],
  ['hotTextureEveryMs', 'Video cap (ms)'],
  ['sceneryReach', 'Scenery reach'],
];

interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  label: () => string;
  press: () => void;
}

const show = (v: unknown) => (v === true ? 'on' : v === false ? 'off' : v === null ? 'auto' : String(v));

function makeOverlay(ctx: Ctx, s: VrSession, read: { latest(): VrPerfSample | null; p95(): number; gpuOn(): boolean }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // Its own few redraws a second: not a video for the quality throttle to hold back.
  texture.userData.vrHot = false;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  material.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * PX, H * PX), material);
  mesh.name = 'vr-perf';
  mesh.renderOrder = 1010;
  mesh.visible = false;
  ctx.scene.add(mesh);

  const buttons: Button[] = KNOBS.map(([k, name], i) => ({
    x: 24 + (i % 2) * 300,
    y: 330 + Math.floor(i / 2) * 76,
    w: 288,
    h: 64,
    label: () => `${name}: ${show(s.quality[k])}`,
    press: () => {
      const steps = KNOB_STEPS[k] as readonly VrQuality[typeof k][] | undefined;
      const knobs = knobsOf(s);
      if (steps && knobs) knobs.set(k, nextValue(steps, s.quality[k]));
    },
  }));
  buttons.push(
    { x: 24, y: H - 92, w: 288, h: 68, label: () => 'Hide', press: () => o.show(false) },
    { x: 324, y: H - 92, w: 288, h: 68, label: () => 'Leave VR', press: () => s.end() },
  );

  let hover = -1;
  let pressed = -1;
  let drawnAt = -Infinity;
  const at = (uv: THREE.Vector2) => {
    const x = uv.x * W;
    const y = (1 - uv.y) * H;
    return buttons.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  };
  const where = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  function place() {
    const head = s.head.position;
    ahead.set(-Math.sin(s.head.yaw), 0, -Math.cos(s.head.yaw));
    mesh.position.copy(head).addScaledVector(ahead, 0.75);
    mesh.position.y -= 0.12;
    mesh.lookAt(head);
  }

  function draw() {
    const q = s.quality;
    const p = read.latest();
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(18, 22, 34, 0.92)';
    roundRect(g, 0, 0, W, H, 28);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '600 32px system-ui, sans-serif';
    g.fillText(`VR perf · ${q.name}`, 28, 52);
    g.font = '400 22px system-ui, sans-serif';
    g.fillStyle = '#aab3c5';
    g.fillText(`scale ${q.framebufferScale} · foveation ${q.foveation} · ${s.xr.frameRate ?? q.frameRate ?? '?'} Hz`, 28, 86);
    g.font = '500 26px ui-monospace, Menlo, monospace';
    g.fillStyle = '#ffffff';
    const lines = p
      ? [
          `fps ${p.fps.toFixed(1)}   late ${p.late.toFixed(1)}%`,
          `CPU ${p.cpuMs.toFixed(1)} ms   p95 ${read.p95().toFixed(1)}`,
          `GPU ${p.gpuMs === null ? (read.gpuOn() ? '…' : 'n/a') : `${p.gpuMs.toFixed(1)} ms`}`,
          `calls ${p.calls}   tris ${(p.triangles / 1000).toFixed(0)}k`,
          `programs ${p.programs}   textures ${p.textures}`,
          `panel paint ${p.paintMs.toFixed(1)} ms`,
        ]
      : ['measuring…'];
    lines.forEach((l, i) => g.fillText(l, 28, 132 + i * 32));
    g.font = '500 22px system-ui, sans-serif';
    buttons.forEach((b, i) => {
      g.fillStyle = i === pressed ? '#5b8cff' : i === hover ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)';
      roundRect(g, b.x, b.y, b.w, b.h, 14);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(b.label(), b.x + 16, b.y + b.h / 2 + 8, b.w - 28);
    });
    texture.needsUpdate = true;
  }

  const o = {
    shown: false,
    dirty: true,
    panel: {
      id: 'vr-perf',
      mesh,
      visible: () => o.shown,
      point(kind: 'move' | 'down' | 'up' | 'leave', uv: THREE.Vector2, _hand: Hand) {
        const i = kind === 'leave' ? -1 : at(uv);
        if (kind === 'down') pressed = i;
        if (kind === 'up') {
          if (i >= 0 && i === pressed) buttons[i].press();
          pressed = -1;
        }
        if (i !== hover || kind !== 'move') o.dirty = true;
        hover = i;
      },
    },
    show(on: boolean) {
      o.shown = on;
      mesh.visible = on;
      if (on) {
        place();
        o.dirty = true;
      }
    },
    update(now: number) {
      if (!o.shown) return;
      // Left behind (the elevator, a seat across the room): back in front of you.
      if (mesh.position.distanceTo(where.copy(s.head.position)) > 2) place();
      if (!o.dirty && now - drawnAt < 500) return;
      o.dirty = false;
      drawnAt = now;
      draw();
    },
    dispose() {
      ctx.scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
  return o;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
