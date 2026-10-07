/**
 * What the office is drawn on and with: the renderer on its canvas, the scene and its lights, the
 * camera, the office building, the sky and the holiday decorations.
 */
import * as THREE from 'three';
import { FastOutlineEffect } from './outline-effect';
// Matrices worked out again only for what's moved (see still-matrices.ts).
import './still-matrices';
import { store } from '../state';
import { Holiday } from '../world/holiday';
import { buildOffice } from '../world/office';
import type { Office } from '../world/types';
import { HAZE_MAX, Sky } from '../world/sky';
import type { Step } from '../ui/loading';
import type { Ctx } from './context';
import { noOutline } from './outline';

/** How far the camera sees in the office: as far as the haze ever is, from the top floor. */
export const FAR = HAZE_MAX + 20;
/** How wide the camera sees (degrees), unless what you're doing has it otherwise (see ctx.view). */
export const FOV = 55;

/** The renderer, the scene with its lights and camera, and what's always in it (see createScene). */
export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  /** Draws the scene with the toon outline (see drawFrame in core/loop.ts). */
  readonly effect: FastOutlineEffect;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  /** The sun by day and the moon by night; the sky moves it (world/sky.ts). */
  readonly sun: THREE.DirectionalLight;
  readonly office: Office;
  readonly sky: Sky;
  /** Christmas decorations, up while the building's dressed up for one (see dressUp in features/workers/views.ts). */
  readonly holiday: Holiday;
}

export function makeRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** No WebGL here (switched off, or no graphics for it): on to the 2D view, which does without. */
export function noWebGL(): Promise<never> {
  location.replace('/lite?why=webgl');
  return new Promise(() => {});
}

/** Sets up the renderer on `canvas`, and builds the scene: its lights, the camera, the office, the sky. */
export function createScene(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): Stage {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const effect = new FastOutlineEffect(renderer, { defaultThickness: 0.0032, defaultColor: [0.17, 0.18, 0.26] });

  const scene = new THREE.Scene();
  // The sky's color and the fog change with the time of day and the weather (world/sky.ts).
  scene.background = new THREE.Color('#bfe3ff');
  scene.fog = new THREE.Fog('#bfe3ff', 40, 90);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, FAR);

  const hemi = new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5);
  const ambient = new THREE.AmbientLight('#ffffff', 0.5);
  scene.add(hemi, ambient);
  // The sun by day and the moon by night; the sky moves it (world/sky.ts).
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  sun.position.set(-8, 18, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Wide enough for the office, the garage under it and the balcony and lot out front, from wherever the sun is.
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 30, bottom: -30, near: 1, far: 100 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const office = buildOffice();
  scene.add(office.group);
  const sky = new Sky(scene, { sun, hemi, ambient }, office.night, () => store.officeNow());
  // Christmas decorations, up while the building's dressed up for one (see dressUp).
  const holiday = new Holiday(office);
  scene.add(holiday.group);

  noOutline(office.group);
  noOutline(holiday.group);
  return { canvas, renderer, effect, scene, camera, hemi, ambient, sun, office, sky, holiday };
}

/** Whether the loading screen waits for the floor's shaders (see warmShadersOnLoad). */
let warming = false;
/** The longest it waits for them: a browser that never says they're done doesn't keep you out. */
const WARM_MAX_MS = 6000;

/**
 * Has the loading screen wait for the floor's shaders (warmingSteps). A headset's browser asks for it
 * as the page loads (features/vr/index.ts, before main.ts gives the loading screen its steps); a
 * laptop never does, and comes in exactly as it always has, each shader compiled as it first comes
 * into view.
 */
export function warmShadersOnLoad() {
  warming = true;
}

/** The loading screen's wait for warmShaders once `arrived` (the floor is here), where the page asked for it; none elsewhere. */
export function warmingSteps(ctx: Pick<Ctx, 'renderer' | 'scene' | 'camera' | 'hands'>, arrived: Promise<unknown>): Step[] {
  return warming ? [{ say: 'Warming up the lights', done: arrived.then(() => warmShaders(ctx)) }] : [];
}

/**
 * Every shader the floor you're on is drawn with, and your hands', compiled side by side where the
 * browser can (KHR_parallel_shader_compile): behind the loading screen, rather than each as it first
 * comes into view, which on a headset's CPU is a stall every few steps. The shaders are the ones the
 * office would have compiled anyway, so it looks the same once it's in.
 */
export function warmShaders(ctx: Pick<Ctx, 'renderer' | 'scene' | 'camera' | 'hands'>): Promise<void> {
  const { renderer, hands } = ctx;
  const compiled = Promise.all([renderer.compileAsync(ctx.scene, ctx.camera), renderer.compileAsync(hands.scene, hands.camera)]).then(
    () => {},
    () => {},
  );
  return Promise.race([compiled, new Promise<void>((resolve) => setTimeout(resolve, WARM_MAX_MS))]);
}

/** The sky follows the office's weather and time of day, and its thunder is heard. */
export function installSky(ctx: Ctx) {
  const { sky } = ctx;
  store.on('sky', () => store.sky && sky.set(store.sky));
  sky.onThunder = (delay, loud) => ctx.sound.thunder(delay, loud);
}

/** The canvas and the camera (and your hands' own camera) fit the window, and keep fitting it. */
export function fitWindow(ctx: Ctx) {
  function resize() {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    ctx.renderer.setSize(w, hgt, false);
    ctx.camera.aspect = w / hgt;
    ctx.camera.updateProjectionMatrix();
    ctx.hands.setAspect(w / hgt);
  }
  window.addEventListener('resize', resize);
  resize();
}
