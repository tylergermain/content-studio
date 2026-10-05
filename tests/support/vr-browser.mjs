// VR in a headless browser (docs/vr.md, "Measuring"): this checkout's office, served from its own
// client build by a server started in this process on a port of its own (never the dev office's 4600
// or 5173), in a throwaway folder, with Meta's WebXR emulator (iwer, pinned in devDependencies and
// loaded only by these scripts) standing in for a Quest 2. From the repo root:
//
//   npm run build:client
//   node --import tsx tests/support/vr-browser.mjs                 every scenario
//   node --import tsx tests/support/vr-browser.mjs enter walk      just those (see SCENARIOS)
//   VR_LAYERS=1 node --import tsx tests/support/vr-browser.mjs     with the WebXR layers polyfill
//
// Env: VR_PORT (14671), CHROME_PATH, IWER_JS (iwer's build/iwer.min.js when it isn't in node_modules),
// VR_SHOTS (screenshots, /tmp/vr-shots). Prints PASS, FAIL or SKIP per scenario; exits 1 on a FAIL.
// vr-perf.mjs uses the same helpers.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PASSWORD = 'vr-check';
export const SHOTS = process.env.VR_SHOTS ?? '/tmp/vr-shots';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- The office, the browser, the emulator ----------------------------------------------------------

/** iwer's browser bundle (it defines a global IWER). */
export function iwerScript() {
  const found = [process.env.IWER_JS, path.join(ROOT, 'node_modules/iwer/build/iwer.min.js')].find((f) => f && existsSync(f));
  if (!found) throw new Error('iwer is not installed: `npm install` (it is a pinned devDependency), or set IWER_JS to its build/iwer.min.js');
  return found;
}

/** A Chromium to drive: CHROME_PATH, else Playwright's newest headless shell, else Chrome. */
export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const cache of [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(cache)) continue;
    const shells = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of shells) {
      for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
        const exe = path.join(cache, d, sub, 'chrome-headless-shell');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

export function launch() {
  return chromium.launch({ executablePath: chromePath(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
}

/** This checkout's office in this process (run with `node --import tsx`), a project of its own in a throwaway folder. */
export async function startOffice(port = Number(process.env.VR_PORT ?? 14671)) {
  if (port === 4600 || port === 5173) throw new Error(`Port ${port} is the dev office's: pick another (VR_PORT)`);
  const publicDir = path.join(ROOT, 'dist/public');
  if (!existsSync(path.join(publicDir, 'index.html'))) throw new Error('No client build: run `npm run build:client` first');
  const { loadConfig } = await import(pathToFileURL(path.join(ROOT, 'src/server/config.ts')).href);
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'src/server/server.ts')).href);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'vr-office-'));
  const dir = (...p) => {
    const d = path.join(tmp, ...p);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const project = dir('project');
  writeFileSync(path.join(project, 'README.md'), '# VR check\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=vr', '-c', 'user.email=vr@example.com', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  // A stand-in for Claude Code, so nothing runs the real one.
  const claude = path.join(dir('bin'), 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n');
  chmodSync(claude, 0o755);
  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];
  const cfg = loadConfig([project, '--home', dir('home'), '--projects', dir('projects'), '--port', String(port), '--password', PASSWORD, '--no-open', '--weather', 'clear', '--agent', claude]);
  const office = await startServer(cfg, { publicDir });
  return {
    base: `http://127.0.0.1:${port}`,
    stop() {
      office.shutdown();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/**
 * A browser page in the office, signed in and past the loading screen, as `name`. With `vr`, a Quest 2
 * (iwer, stereo) is installed before the page loads, over Chrome's own WebXR (which says no headset).
 * `init` are more scripts to run before the page's own. `wire` collects every message the page sends and gets.
 */
export async function openOffice(browser, base, { vr = true, name = 'Visor', layers = !!process.env.VR_LAYERS, viewport = { width: 1280, height: 720 }, init = [] } = {}) {
  const context = await browser.newContext({ viewport });
  for (const fn of init) await context.addInitScript(fn);
  await context.addInitScript((who) => {
    try {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: who, color: '#4f86f7', look: { skin: 1, hair: 2, style: 0 } }));
    } catch {
      // about:blank and friends
    }
  }, name);
  if (vr) {
    await context.addInitScript({ path: iwerScript() });
    await context.addInitScript((polyfillLayers) => {
      // iwer 2.5.0 copies getOffsetReferenceSpace's XRRigidTransform as if it were a matrix (NaNs), and
      // poses through that space then quietly come out in the room's own space: the rig (an offset
      // space) would never move you. Hand it the transform's matrix, as a headset's browser reads it.
      const space = IWER.XRReferenceSpace.prototype;
      const offset = space.getOffsetReferenceSpace;
      space.getOffsetReferenceSpace = function (t) {
        return offset.call(this, t?.matrix ?? t);
      };
      const d = new IWER.XRDevice(IWER.metaQuest2, { stereoEnabled: true });
      d.installRuntime({ forceInstall: true, polyfillLayers });
      d.position.set(0, 1.7, 0);
      window.__xr = d;
    }, layers);
  }
  const login = await context.request.post(`${base}/api/login`, { data: { password: PASSWORD } });
  if (!login.ok()) throw new Error(`Signing in was refused (${login.status()})`);
  const page = await context.newPage();
  const wire = { sent: [], got: [], errors: [] };
  page.on('pageerror', (e) => wire.errors.push(e.message));
  page.on('websocket', (ws) => {
    const keep = (list) => (f) => {
      try {
        list.push({ at: Date.now(), m: JSON.parse(f.payload) });
        if (list.length > 6000) list.splice(0, 2000);
      } catch {
        // not JSON
      }
    };
    ws.on('framesent', keep(wire.sent));
    ws.on('framereceived', keep(wire.got));
  });
  await page.goto(`${base}/`);
  await page.waitForFunction(() => window.__office?.store?.floor && !document.querySelector('#loading:not(.gone)'), null, { timeout: 240_000 });
  await closeWindows(page);
  return { context, page, wire };
}

/** Every window closed, by Esc (whatever greets a newcomer, or what a scenario left open). */
export async function closeWindows(page) {
  for (let i = 0; i < 6 && (await page.evaluate(() => !!document.querySelector('#modal-root .backdrop'))); i++) {
    await page.keyboard.press('Escape');
    await sleep(250);
  }
}

/** Presses 🥽 Enter VR (a real click, so the session may start) and waits for the headset's frames. */
export async function enterVr(page) {
  const button = page.locator('#vr-enter');
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await page.waitForFunction(() => window.__vr?.presenting && window.__vr.frames > 3, null, { timeout: 120_000 });
}

/** Leaves VR (the button reads Leave VR in a session; iwer's canvas covers it, so a DOM click). */
export async function leaveVr(page) {
  await page.evaluate(() => document.getElementById('vr-enter')?.click());
  await page.waitForFunction(() => !window.__vr?.presenting, null, { timeout: 30_000 });
}

// ---- Driving the headset and the controllers --------------------------------------------------------

/** A quaternion [x, y, z, w] turned `yaw` about the vertical, then `pitch` up (order YXZ, as the camera). */
export function quat(yaw = 0, pitch = 0) {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

export const yawOf = ([x, y, z, w]) => Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;

/** Waits for `n` more headset frames. */
export async function frames(page, n = 2, timeout = 60_000) {
  const start = await page.evaluate(() => window.__vr.frames);
  await page.waitForFunction(([s, k]) => window.__vr.frames >= s + k, [start, n], { timeout });
}

/** The headset: where (local-floor metres) and which way it looks. */
export async function head(page, { at, yaw, pitch = 0 } = {}) {
  await page.evaluate(([p, r]) => {
    if (p) window.__xr.position.set(...p);
    if (r) window.__xr.quaternion.set(...r);
  }, [at ?? null, yaw === undefined ? null : quat(yaw, pitch)]);
}

export async function button(page, hand, id, value) {
  await page.evaluate(([h, b, v]) => window.__xr.controllers[h].updateButtonValue(b, v), [hand, id, value]);
}

export async function stick(page, hand, x, y) {
  await page.evaluate(([h, sx, sy]) => window.__xr.controllers[h].updateAxes('thumbstick', sx, sy), [hand, x, y]);
}

/** A button pressed for a few frames and let go. */
export async function press(page, hand, id, hold = 3) {
  await button(page, hand, id, 1);
  await frames(page, hold);
  await button(page, hand, id, 0);
  await frames(page, 3);
}

/** Where you are, as the page has it: the camera (the head as drawn), your feet, which way you look and face. */
export async function where(page) {
  return page.evaluate(() => {
    const o = window.__office;
    const p = o.player;
    return {
      cam: o.camera.position.toArray(),
      feet: p.pos.toArray(),
      camYaw: p.camYaw,
      facing: p.facing,
      seat: !!p.seat,
      vy: p.vy,
      room: { ...p.room },
      local: { head: [window.__xr.position.x, window.__xr.position.y, window.__xr.position.z], quat: [window.__xr.quaternion.x, window.__xr.quaternion.y, window.__xr.quaternion.z, window.__xr.quaternion.w] },
      frames: window.__vr?.frames ?? 0,
    };
  });
}

/** Where the headset's floor space sits in the office (the rig), worked out from the head: world = R(yaw)·local + origin. */
export function rigOf(w) {
  const yaw = wrap(w.camYaw - yawOf(w.local.quat));
  const [lx, ly, lz] = w.local.head;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { yaw, origin: [w.cam[0] - (lx * c + lz * s), w.cam[1] - ly, w.cam[2] - (-lx * s + lz * c)] };
}

/** A point in the office, in the headset's floor space. */
export function toLocal(rig, [x, y, z]) {
  const dx = x - rig.origin[0];
  const dz = z - rig.origin[2];
  const c = Math.cos(-rig.yaw);
  const s = Math.sin(-rig.yaw);
  return [dx * c + dz * s, y - rig.origin[1], -dx * s + dz * c];
}

/** A quaternion turning -z (where a controller points) to `d`. */
function pointing([dx, dy, dz]) {
  const n = Math.hypot(dx, dy, dz) || 1;
  const d = [dx / n, dy / n, dz / n];
  const w = 1 - d[2];
  if (w < 1e-6) return [0, 1, 0, 0];
  const len = Math.hypot(d[1], d[0], w);
  return [d[1] / len, -d[0] / len, 0, w / len];
}

/** Points `hand`'s controller (held by the shoulder) at a point in the office. */
export async function aim(page, hand, target) {
  const w = await where(page);
  const rig = rigOf(w);
  const t = toLocal(rig, target);
  const [hx, hy, hz] = w.local.head;
  const yaw = yawOf(w.local.quat);
  const side = hand === 'right' ? 0.2 : -0.2;
  const from = [hx + side * Math.cos(yaw) - 0.25 * Math.sin(yaw), hy - 0.35, hz - side * Math.sin(yaw) - 0.25 * Math.cos(yaw)];
  const q = pointing([t[0] - from[0], t[1] - from[1], t[2] - from[2]]);
  await page.evaluate(([h, p, r]) => {
    window.__xr.controllers[h].position.set(...p);
    window.__xr.controllers[h].quaternion.set(...r);
  }, [hand, from, q]);
  await frames(page, 2);
}

/** Turns the headset (where it stands) so you look along `worldYaw` in the office. */
export async function face(page, worldYaw) {
  const w = await where(page);
  const rig = rigOf(w);
  await head(page, { yaw: wrap(worldYaw - rig.yaw) });
  await frames(page, 3);
}

/** The world yaw (camYaw's) that looks from `a` toward `b`. */
export const yawToward = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));

/** Puts you at a spot from inside a frame (perf.goTo: the rig carries the headset along), and waits. */
export async function goTo(page, [x, y, z], lookAt) {
  await page.evaluate(([p]) => window.__vr.perf.goTo(...p), [[x, y, z]]);
  await frames(page, 4);
  if (lookAt) await face(page, yawToward([x, y, z], lookAt));
}

/** The first interactable of `kind` on this floor: where it is (x, y, z). */
export async function find(page, kind) {
  return page.evaluate((k) => {
    const i = window.__office.office.interactables.find((it) => it.kind === k);
    return i ? [i.x, i.y ?? 0, i.z] : null;
  }, kind);
}

/** A spot `d` metres out from `at` toward the middle of the room, at floor height. */
export async function infront(page, at, d = 1.6) {
  const { room } = await where(page);
  const mid = [(room.minX + room.maxX) / 2, 0, (room.minZ + room.maxZ) / 2];
  const dx = mid[0] - at[0];
  const dz = mid[2] - at[2];
  const n = Math.hypot(dx, dz) || 1;
  return [at[0] + (dx / n) * d, at[1] ?? 0, at[2] + (dz / n) * d];
}

// ---- Panels ------------------------------------------------------------------------------------------

/** Whether the panel `id` (its mesh is named vr-panel-<id>: window, sheet, hud, hint, keyboard) is showing. */
export function panelUp(page, id) {
  return page.evaluate((key) => {
    let up = false;
    window.__office.scene.traverse((o) => {
      if (up || !o.isMesh || o.renderOrder < 1000) return;
      if (o.name !== `vr-panel-${key}`) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      up = true;
    });
    return up;
  }, id);
}

/** The office point at uv (u, v) (0,0 bottom-left) on the panel `id`, or null if it isn't up. */
export function panelPoint(page, id, u, v) {
  return page.evaluate(([key, pu, pv]) => {
    let mesh = null;
    window.__office.scene.traverse((o) => {
      if (mesh || !o.isMesh || o.renderOrder < 1000) return;
      if (o.name === `vr-panel-${key}`) mesh = o;
    });
    if (!mesh) return null;
    const g = mesh.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox;
    mesh.updateWorldMatrix(true, false);
    const V = mesh.position.constructor;
    const p = mesh.localToWorld(new V(b.min.x + pu * (b.max.x - b.min.x), b.min.y + pv * (b.max.y - b.min.y), 0));
    return [p.x, p.y, p.z];
  }, [id, u, v]);
}

/**
 * The uv on panel `id` of the middle of the element `selector`, from the client rect the panel shows
 * (panels/host.ts): the top window's content on 'window' (or on 'sheet', a window as big as the
 * screen), the whole page on 'hud' (the HUD sheet X brings up).
 */
export function uvOf(page, id, selector) {
  return page.evaluate(([key, sel]) => {
    const el = document.querySelector(sel);
    const root = key === 'hud' ? document.body : document.getElementById('modal-root')?.lastElementChild?.firstElementChild;
    if (!root || !el) return null;
    const r = key === 'hud' ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : root.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return [(e.x + e.width / 2 - r.x) / r.width, 1 - (e.y + e.height / 2 - r.y) / r.height];
  }, [id, selector]);
}

/** Points the right hand at `selector` on panel `id` and pulls the trigger there. */
export async function clickOn(page, id, selector, hand = 'right') {
  const uv = await uvOf(page, id, selector);
  if (!uv) throw new Error(`${selector} isn't on the ${id} panel`);
  const at = await panelPoint(page, id, uv[0], uv[1]);
  if (!at) throw new Error(`The ${id} panel isn't up`);
  await aim(page, hand, at);
  await press(page, hand, 'trigger');
}

/** Types `text` on the VR keyboard, key by key (keyboard-layout.ts's board), by pointing and pulling. */
export async function typeOnKeyboard(page, text, { terminal = false, hand = 'right' } = {}) {
  const { boardFor } = await import(pathToFileURL(path.join(ROOT, 'src/client/features/vr/panels/keyboard-layout.ts')).href);
  const board = boardFor('letters', false, terminal);
  const tap = async (id) => {
    const k = board.keys.find((p) => p.key.id === id);
    if (!k) throw new Error(`No ${id} key`);
    const at = await panelPoint(page, 'keyboard', k.x + k.w / 2, 1 - (k.y + k.h / 2));
    if (!at) throw new Error('The keyboard isn\'t up');
    await aim(page, hand, at);
    await press(page, hand, 'trigger', 2);
  };
  for (const ch of text) {
    if (ch === '\u0003') {
      // Ctrl+C: Ctrl (the terminal row's), then c.
      await tap('ctrl');
      await tap('c:c');
    } else await tap(ch === '\n' ? 'enter' : ch === ' ' ? 'space' : `c:${ch}`);
  }
}

// ---- The scenarios -----------------------------------------------------------------------------------

const results = [];
/** The scenarios asked for on the command line (none: all of them). Entering VR always runs: the rest need it. */
let wanted = new Set();

/** Runs one scenario: PASS, FAIL (with a screenshot), or SKIP (what it needed wasn't there). */
async function scenario(name, page, fn) {
  if (wanted.size && !wanted.has(name) && name !== 'enter') return;
  const t0 = Date.now();
  try {
    const note = await fn();
    const skipped = typeof note === 'string' && note.startsWith('SKIP');
    results.push({ name, ok: true, skipped, note: skipped ? note.slice(5) : (note ?? '') });
    console.log(`${skipped ? 'SKIP' : 'PASS'} ${name}${note ? `: ${skipped ? note.slice(5) : note}` : ''} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, note: err.message });
    console.log(`FAIL ${name}: ${err.message}`);
    if (page) await page.screenshot({ path: path.join(SHOTS, `fail-${name}.png`) }).catch(() => {});
  }
}

const expect = (ok, what) => {
  if (!ok) throw new Error(what);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export const SCENARIOS = ['desktop', 'enter', 'height', 'walk', 'wall', 'stick', 'snap', 'grip', 'elevator', 'sheet', 'chat', 'terminal', 'seat', 'arcade', 'presence', 'fade', 'leave'];

async function main() {
  wanted = new Set(process.argv.slice(2).filter((a) => SCENARIOS.includes(a)));
  mkdirSync(SHOTS, { recursive: true });
  const office = await startOffice();
  const browser = await launch();
  try {
    // A computer with no headset: no button, nothing of VR loaded.
    if (!wanted.size || wanted.has('desktop')) {
      const { page, context } = await openOffice(browser, office.base, { vr: false, name: 'Desk' });
      await scenario('desktop', page, async () => {
        await sleep(2000);
        expect((await page.locator('#vr-enter').count()) === 0, 'an Enter VR button on a computer with no headset');
        const chunks = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /session|remote|perf|quality|panels/.test(n.split('/').pop() ?? '')));
        await page.screenshot({ path: path.join(SHOTS, 'desktop.png') });
        return chunks.length ? `loaded ${chunks.join(', ')}?` : 'no button, no VR chunks';
      });
      await context.close();
    }

    const { page, wire } = await openOffice(browser, office.base, { vr: true, name: 'Visor' });
    const before = await page.evaluate(() => {
      const o = window.__office;
      let tex = null;
      o.scene.traverse((m) => (tex ??= m.material?.map ?? null));
      let proto = tex && Object.getPrototypeOf(tex);
      while (proto && !Object.prototype.hasOwnProperty.call(proto, 'needsUpdate')) proto = Object.getPrototypeOf(proto);
      window.__vrCheck = { proto, set: proto && Object.getOwnPropertyDescriptor(proto, 'needsUpdate').set };
      return { children: o.scene.children.map((c) => c.name || c.type), autoUpdate: o.renderer.shadowMap.autoUpdate, autoReset: o.renderer.info.autoReset };
    });

    await scenario('enter', page, async () => {
      await enterVr(page);
      const profile = await page.evaluate(() => window.__vr.profile);
      expect(profile === 'quest2', `profile ${profile}, not quest2`);
      await frames(page, 5);
      await page.screenshot({ path: path.join(SHOTS, 'enter.png') });
      return `presenting, ${profile}`;
    });
    if (!(await page.evaluate(() => window.__vr?.presenting))) throw new Error('Not in VR: the rest needs a session');

    await scenario('height', page, async () => {
      await head(page, { at: [0, 1.7, 0], yaw: 0 });
      await frames(page, 6);
      const a = await where(page);
      const eyes = a.cam[1] - a.feet[1];
      expect(near(eyes, 1.7, 0.12), `eyes ${eyes.toFixed(3)} m over your feet, not 1.7`);
      await head(page, { yaw: 0.5 });
      await frames(page, 6);
      const b = await where(page);
      const turned = wrap(b.camYaw - a.camYaw);
      expect(near(turned, 0.5, 0.05), `looking 0.5 rad left turned camYaw ${turned.toFixed(3)}`);
      await head(page, { yaw: 0 });
      await frames(page, 4);
      return `eyes ${eyes.toFixed(2)} m, camYaw follows`;
    });

    await scenario('walk', page, async () => {
      const a = await where(page);
      const yaw = yawOf(a.local.quat);
      const [x, y, z] = a.local.head;
      // Half a metre the way the headset looks, for real.
      await head(page, { at: [x - 0.5 * Math.sin(yaw), y, z - 0.5 * Math.cos(yaw)] });
      await frames(page, 8);
      const b = await where(page);
      const moved = flat(a.feet, b.feet);
      expect(moved > 0.35 && moved < 0.65, `your feet moved ${moved.toFixed(2)} m for half a metre walked`);
      return `feet ${moved.toFixed(2)} m`;
    });

    await scenario('wall', page, async () => {
      const a = await where(page);
      const { room } = a;
      // The nearest wall, walked into for real.
      // How far each wall is, and the camYaw that faces it (you look along (-sin, -cos)).
      const walls = [
        [a.feet[0] - room.minX, Math.PI / 2],
        [room.maxX - a.feet[0], -Math.PI / 2],
        [a.feet[2] - room.minZ, 0],
        [room.maxZ - a.feet[2], Math.PI],
      ].sort((p, q) => p[0] - q[0]);
      await face(page, walls[0][1]);
      let last = (await where(page)).feet;
      let still = 0;
      for (let i = 0; i < 80 && still < 4; i++) {
        const w = await where(page);
        const yaw = yawOf(w.local.quat);
        const [x, y, z] = w.local.head;
        await head(page, { at: [x - 0.25 * Math.sin(yaw), y, z - 0.25 * Math.cos(yaw)] });
        await frames(page, 3);
        const now = (await where(page)).feet;
        still = flat(now, last) < 0.05 ? still + 1 : 0;
        last = now;
      }
      expect(still >= 4, 'walked 20 m and met nothing');
      const w = await where(page);
      const lean = flat(w.cam, w.feet);
      expect(lean < 0.4, `your head is ${lean.toFixed(2)} m from your feet, through what stopped them`);
      return `stopped, head ${lean.toFixed(2)} m over the feet`;
    });

    // Back into the middle of the room for the rest.
    const middle = async () => {
      const { room } = await where(page);
      await goTo(page, [(room.minX + room.maxX) / 2, 0, (room.minZ + room.maxZ) / 2]);
    };

    await scenario('stick', page, async () => {
      await middle();
      const a = await where(page);
      const t0 = await page.evaluate(() => performance.now());
      await stick(page, 'left', 0, -1);
      await sleep(1500);
      await stick(page, 'left', 0, 0);
      await frames(page, 3);
      const b = await where(page);
      // The frames it walked for, each at most 0.1 s (the office's own cap on a frame's time).
      const dts = await page.evaluate((since) => window.__vr.perf.frames.filter((f) => f.at >= since).map((f) => Math.min(f.dt, 100)), t0);
      const secs = dts.reduce((s, d) => s + d, 0) / 1000;
      const speed = flat(a.feet, b.feet) / Math.max(secs, 1e-3);
      expect(speed > 3.2 && speed < 6, `walked ${flat(a.feet, b.feet).toFixed(2)} m in ${secs.toFixed(2)} s of frames: ${speed.toFixed(2)} m/s, not about 4.6`);
      return `${speed.toFixed(2)} m/s (a walk is 4.6)`;
    });

    await scenario('snap', page, async () => {
      const a = await where(page);
      await stick(page, 'right', 1, 0);
      await sleep(600);
      await frames(page, 3);
      const b = await where(page);
      await stick(page, 'right', 0, 0);
      await frames(page, 3);
      await stick(page, 'right', 1, 0);
      await frames(page, 4);
      await stick(page, 'right', 0, 0);
      await frames(page, 3);
      const c = await where(page);
      const one = wrap(b.camYaw - a.camYaw) / DEG;
      const two = wrap(c.camYaw - a.camYaw) / DEG;
      expect(near(Math.abs(one), 30, 3) || near(Math.abs(one), 45, 3), `held right: turned ${one.toFixed(1)}°, not one snap`);
      expect(near(Math.abs(two), 2 * Math.abs(one), 3), `two flicks: ${two.toFixed(1)}°`);
      expect(one < 0, 'right turns clockwise (camYaw down)');
      return `${one.toFixed(0)}° a flick`;
    });

    await scenario('grip', page, async () => {
      await middle();
      const a = await where(page);
      await button(page, 'left', 'squeeze', 1);
      let top = a.feet[1];
      for (let i = 0; i < 6; i++) {
        await frames(page, 1);
        top = Math.max(top, (await where(page)).feet[1]);
      }
      await button(page, 'left', 'squeeze', 0);
      await frames(page, 10);
      expect(top > a.feet[1] + 0.05, `grip didn't jump (rose ${(top - a.feet[1]).toFixed(2)} m)`);
      return `jumped ${(top - a.feet[1]).toFixed(2)} m`;
    });

    await scenario('elevator', page, async () => {
      const lift = await find(page, 'elevator');
      if (!lift) return 'SKIP no elevator on this floor';
      await goTo(page, await infront(page, lift), lift);
      await aim(page, 'right', [lift[0], 1.2, lift[2]]);
      await press(page, 'right', 'trigger');
      await page.waitForFunction(() => !!document.querySelector('#modal-root .backdrop'), null, { timeout: 10_000 }).catch(() => {
        throw new Error('the trigger at the elevator opened no window');
      });
      await frames(page, 20);
      expect(await panelUp(page, 'window'), 'no window panel showing');
      const paint = await page.evaluate(() => window.__vr.panels?.lastPaintMs ?? 0);
      await page.screenshot({ path: path.join(SHOTS, 'elevator-panel.png') });
      // A ray click on one of its buttons, caught before it does anything.
      const target = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#modal-root .backdrop:last-child button')].find((x) => !x.classList.contains('close') && x.getBoundingClientRect().width > 0);
        if (!b) return null;
        b.id ||= 'vr-check-target';
        window.__vrClicks = 0;
        b.addEventListener('click', (e) => (window.__vrClicks++, e.stopImmediatePropagation(), e.preventDefault()), { capture: true });
        return `#${b.id}`;
      });
      if (target) {
        await clickOn(page, 'window', target);
        expect((await page.evaluate(() => window.__vrClicks)) === 1, `the ray's click didn't reach ${target}`);
      }
      // B: the window closes, as Esc closes it.
      await press(page, 'right', 'b-button');
      await page.waitForFunction(() => !document.querySelector('#modal-root .backdrop'), null, { timeout: 5000 }).catch(() => {
        throw new Error('B left the window open');
      });
      return `window painted (${paint.toFixed(1)} ms), clicked${target ? '' : ' (no button to click)'}, closed by B`;
    });

    await scenario('sheet', page, async () => {
      await press(page, 'left', 'x-button');
      await frames(page, 20);
      expect(await panelUp(page, 'hud'), 'X brought up no HUD sheet');
      await clickOn(page, 'hud', '.dock-menu');
      await frames(page, 15);
      const settings = await page.evaluate(() => {
        const item = [...document.querySelectorAll('button, [role="menuitem"], a')].find((b) => /settings/i.test(b.textContent ?? '') && b.getBoundingClientRect().width > 0);
        if (!item) return null;
        item.id ||= 'vr-check-settings';
        return `#${item.id}`;
      });
      expect(settings, 'the ☰ menu has no Settings');
      await clickOn(page, 'hud', settings);
      await page.waitForFunction(() => !!document.querySelector('#modal-root .backdrop input[type="checkbox"]'), null, { timeout: 8000 }).catch(() => {
        throw new Error('Settings didn\'t open');
      });
      await frames(page, 20);
      const box = await page.evaluate(() => {
        const c = [...document.querySelectorAll('#modal-root .backdrop:last-child input[type="checkbox"]')].find((x) => x.getBoundingClientRect().width > 0);
        c.id ||= 'vr-check-box';
        return { sel: `#${c.id}`, was: c.checked };
      });
      await clickOn(page, 'window', box.sel);
      const now = await page.evaluate((sel) => document.querySelector(sel).checked, box.sel);
      expect(now !== box.was, 'the checkbox didn\'t change');
      // Put it back, and close everything.
      await clickOn(page, 'window', box.sel);
      await press(page, 'right', 'b-button');
      await press(page, 'right', 'b-button');
      await closeWindows(page);
      return 'X → ☰ → Settings → a checkbox, by the ray';
    });

    await scenario('chat', page, async () => {
      const sent = wire.sent.length;
      // Into the chat box: by the ray on the HUD sheet if it's there, else T.
      if (!(await panelUp(page, 'hud'))) await press(page, 'left', 'x-button');
      await frames(page, 10);
      if (await page.evaluate(() => document.getElementById('chat-input').getBoundingClientRect().width > 0)) await clickOn(page, 'hud', '#chat-input');
      else await page.keyboard.press('t');
      await frames(page, 10);
      expect(await page.evaluate(() => document.activeElement?.id === 'chat-input'), 'the chat box didn\'t take the focus');
      expect(await panelUp(page, 'keyboard'), 'no keyboard came up');
      await typeOnKeyboard(page, 'hi\n');
      await sleep(500);
      const chat = wire.sent.slice(sent).find((f) => f.m.t === 'chat');
      expect(chat?.m.text === 'hi', `sent ${chat ? JSON.stringify(chat.m.text) : 'no chat'}`);
      await closeWindows(page);
      return 'typed "hi" on the VR keyboard and it went out';
    });

    await scenario('terminal', page, async () => {
      const desk = await page.evaluate(() => {
        const o = window.__office;
        const free = o.office.interactables.find((i) => i.kind === 'desk' && i.deskId && ![...o.store.workers.values()].some((w) => w.deskId === i.deskId));
        return free ? [free.x, 0, free.z] : null;
      });
      if (!desk) return 'SKIP no empty desk for a shell';
      await goTo(page, await infront(page, desk, 1.2), desk);
      await aim(page, 'right', [desk[0], 0.8, desk[2]]);
      await page.keyboard.press('b');
      const open = await page.waitForFunction(() => !!document.querySelector('#modal-root .xterm'), null, { timeout: 15_000 }).then(() => true, () => false);
      if (!open) return 'SKIP B at a desk opened no shell (the aim may have missed the desk)';
      await frames(page, 20);
      const sent = wire.sent.length;
      await clickOn(page, 'window', '#modal-root .xterm');
      await frames(page, 10);
      expect(await panelUp(page, 'keyboard'), 'no keyboard for the terminal');
      await typeOnKeyboard(page, 'echo vr\n\u0003', { terminal: true });
      await sleep(500);
      const typed = wire.sent.slice(sent).filter((f) => f.m.t === 'term.input').map((f) => f.m.data).join('');
      expect(typed.includes('echo vr'), `the terminal got ${JSON.stringify(typed)}`);
      expect(typed.includes('\u0003'), 'no Ctrl+C reached the terminal');
      await closeWindows(page);
      return 'typed into a shell, Ctrl+C included';
    });

    await scenario('seat', page, async () => {
      const seat = await find(page, 'seat');
      if (!seat) return 'SKIP nowhere to sit';
      await goTo(page, await infront(page, seat, 1.2), seat);
      await aim(page, 'right', [seat[0], 0.45, seat[2]]);
      await press(page, 'right', 'trigger');
      await frames(page, 10);
      if (!(await where(page)).seat) return 'SKIP the trigger at the seat didn\'t sit you (the aim may have missed)';
      await press(page, 'left', 'squeeze');
      await frames(page, 10);
      expect(!(await where(page)).seat, 'grip didn\'t get you up');
      return 'sat with the trigger, up with the grip';
    });

    await scenario('arcade', page, async () => {
      const cab = await find(page, 'cabinet');
      if (!cab) return 'SKIP no arcade cabinet';
      await goTo(page, await infront(page, cab, 1.3), cab);
      await aim(page, 'right', [cab[0], 1.3, cab[2]]);
      const a = await where(page);
      await press(page, 'right', 'trigger');
      let worst = 0;
      for (let i = 0; i < 12; i++) {
        await frames(page, 1);
        const b = await where(page);
        worst = Math.max(worst, Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1], b.cam[2] - a.cam[2]));
      }
      await closeWindows(page);
      expect(worst < 0.03, `the view moved ${worst.toFixed(3)} m: the cabinet flew the camera`);
      return `head held (${(worst * 1000).toFixed(0)} mm)`;
    });

    await scenario('presence', page, async () => {
      const other = await openOffice(browser, office.base, { vr: false, name: 'Watcher' });
      try {
        const me = await page.evaluate(() => window.__office.store.you);
        await other.page.waitForFunction((id) => window.__office.remotes.has(id), me, { timeout: 20_000 });
        await middle();
        await frames(page, 10);
        await sleep(1500);
        const seen = () => other.wire.got.filter((f) => f.m.t === 'peer.vr' && f.m.id === me).at(-1)?.m.pose ?? null;
        const was = seen();
        expect(was, 'the desktop got no head pose');
        // 0.6 rad, back toward the body's front, so the turn stays under the 50° the body waits for.
        const turn = was.yaw > 0 ? -0.6 : 0.6;
        const w = await where(page);
        await head(page, { yaw: yawOf(w.local.quat) + turn });
        await frames(page, 10);
        await sleep(1500);
        const now = seen();
        const d = wrap(now.yaw - was.yaw);
        expect(near(d, turn, 0.12), `the desktop saw the head turn ${d.toFixed(2)}, not ${turn}`);
        const worn = await other.page.evaluate((id) => !!window.__office.remotes.get(id)?.person.root.getObjectByName('vr-visor'), me);
        expect(worn, 'no headset on their character');
        await other.page.screenshot({ path: path.join(SHOTS, 'presence-desktop.png') });
        return `a ${turn} rad head turn seen on a desktop, headset on`;
      } finally {
        await other.context.close();
      }
    });

    await scenario('fade', page, async () => {
      if (!(await page.evaluate(() => typeof window.__office.ride === 'function'))) return 'SKIP no ride';
      const floor = await page.evaluate(() => window.__office.store.floor);
      // Up to the rooftop bar ('@roof', shared/rooftop.ts) and back, the darkest the sphere gets watched
      // from inside the page (a look between frames from here misses the moment it's fully down).
      await page.evaluate(() => {
        window.__vrDark = 0;
        window.__vrDarkTimer = setInterval(() => {
          window.__vrDark = Math.max(window.__vrDark, window.__office.scene.getObjectByName('vr-fade')?.material.opacity ?? 0);
        }, 5);
        window.__office.ride('@roof');
      });
      await page.waitForFunction(() => window.__vrDark >= 0.95, null, { timeout: 15_000 }).catch(() => {});
      const dark = await page.evaluate(() => (clearInterval(window.__vrDarkTimer), window.__vrDark));
      expect(dark >= 0.95, `the lights only went ${(dark * 100).toFixed(0)}% down on the ride`);
      await page.waitForFunction(() => !window.__office.scene.getObjectByName('vr-fade')?.visible, null, { timeout: 20_000 }).catch(() => {});
      await page.evaluate((f) => window.__office.ride(f), floor);
      await page.waitForFunction((f) => window.__office.store.floor === f, floor, { timeout: 30_000 }).catch(() => {});
      return 'dark mid-ride';
    });

    await scenario('leave', page, async () => {
      await leaveVr(page);
      const f0 = await page.evaluate(() => window.__office.renderer.info.render.frame);
      await sleep(1500);
      const after = await page.evaluate(() => {
        const o = window.__office;
        const { proto, set } = window.__vrCheck;
        return {
          frames: o.renderer.info.render.frame,
          children: o.scene.children.map((c) => c.name || c.type),
          // VR's own objects are all named vr-…: none may be left.
          leftover: (() => {
            const left = [];
            o.scene.traverse((m) => /^vr-/.test(m.name) && m.name !== 'vr-visor' && left.push(m.name));
            return left;
          })(),
          autoUpdate: o.renderer.shadowMap.autoUpdate,
          autoReset: o.renderer.info.autoReset,
          texture: !proto || Object.getOwnPropertyDescriptor(proto, 'needsUpdate').set === set,
          lock: !Object.prototype.hasOwnProperty.call(o.player, 'lock') && o.player.canLock,
          // An emulator that borrowed the canvas put it back where it was, under the HUD.
          button: (() => {
            const b = document.getElementById('vr-enter').getBoundingClientRect();
            return document.getElementById('vr-enter').contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
          })(),
        };
      });
      expect(after.frames > f0, 'the browser\'s frames didn\'t come back');
      // Everything that was there still is; the rooftop the fade scenario rode to stays loaded, as it does on a screen.
      const missing = [...before.children];
      for (const c of after.children) {
        const i = missing.indexOf(c);
        if (i >= 0) missing.splice(i, 1);
      }
      expect(!missing.length, `the scene lost ${missing.join(', ')}`);
      expect(!after.leftover.length, `VR left ${after.leftover.join(', ')} in the scene`);
      expect(after.autoUpdate === before.autoUpdate && after.autoReset === before.autoReset, 'the renderer\'s shadows or counters weren\'t put back');
      expect(after.texture, 'Texture.needsUpdate is still throttled');
      expect(after.lock, 'the mouse can\'t be captured for mouse-look again');
      expect(after.button, 'the canvas covers the HUD (Enter VR can\'t be clicked)');
      return 'frames back, scene and renderer as they were, mouse-look and the HUD back';
    });

    if (wire.errors.length) console.log(`Page errors:\n  ${[...new Set(wire.errors)].slice(0, 10).join('\n  ')}`);
  } finally {
    await browser.close();
    office.stop();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed (${results.filter((r) => r.skipped).length} skipped), ${failed.length} failed. Screenshots in ${SHOTS}`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
