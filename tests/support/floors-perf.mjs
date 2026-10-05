// What a frame of the office costs, floor by floor (docs/vr.md, "How hard it works the headset"): draw
// calls, triangles and the page's CPU time per frame, on a laptop and in VR (iwer's Quest 2, both eyes,
// the Quest 2 profile), at the desks and in the lounge of every floor, out on the street and up on the
// roof; how long the office takes to come up with the CPU throttled 4x (the Quest 2's CPU, roughly); and
// a census of what the draw calls are, by part of the scene and by the module that built them. From the
// repo root, after `npm run build:client`:
//
//   node --import tsx tests/support/floors-perf.mjs --building <dir>
//   node --import tsx tests/support/floors-perf.mjs --building <dir> --only desktop,vr --public <another build>
//
// --building is a folder with floors.json ([{ id, name, palette }]) and a folder per floor holding the
// floor's .agent-office (floorplan.json, studio.json, decor.json, media/…), copied into a throwaway office
// so nothing writes to it; without one, the office has the one floor a new office starts with.
// --public serves another client build (dist/public by default), --only picks the parts (desktop: a
// laptop's page; questpage: the Quest browser's flat page, by its user agent; vr; startup; census; shots),
// --spots picks the spots (`friday-labs:desks,content:desks,friday-labs:street,roof`), --rates the CPU
// throttling (1,4), and --seconds N (8) is how long each measurement runs. The census needs a build with source
// maps (`npx vite build --sourcemap`) to name modules; without them it names the chunk. Writes
// floors-perf.json and floors-perf.md to --out (VR_OUT, /tmp/vr-perf) and screenshots to shots/ there.
// The machine's load shows in the times: the counts are exact, the CPU times rough.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PASSWORD, ROOT, closeWindows, enterVr, face, frames, launch, openOffice, sleep, yawToward } from './vr-browser.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(arg('seconds', 8));
const BUILDING = arg('building', null);
const PUBLIC = path.resolve(arg('public', path.join(ROOT, 'dist/public')));
const OUT = path.resolve(arg('out', process.env.VR_OUT ?? '/tmp/vr-perf'));
const ONLY = new Set((arg('only', 'desktop,questpage,vr,startup,census,shots') ?? '').split(',').filter(Boolean));
/** The spots to measure, as `<floor> · <spot>` or `roof` (all of them by default), and the CPU throttling rates. */
const SPOTS = arg('spots', null)?.split(',').map((s) => s.trim().replace(/\s*:\s*/, ' · '));
const RATES = (arg('rates', '1,4') ?? '').split(',').map(Number).filter((n) => n > 0);
/** The Quest 2's browser, as it names itself. */
export const QUEST2_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0.4.65 SamsungBrowser/4.0 Chrome/128.0.6613.165 VR Safari/537.36';

// ---- The office, with the floors of --building ------------------------------------------------------

/** This checkout's server on `port`, serving `publicDir`, in a throwaway folder with the floors of `building` (if any). */
export async function startBuilding({ port = Number(process.env.VR_PORT ?? 14711), publicDir = PUBLIC, building = BUILDING } = {}) {
  if (port === 4600 || port === 5173) throw new Error(`Port ${port} is the dev office's: pick another (VR_PORT)`);
  if (!existsSync(path.join(publicDir, 'index.html'))) throw new Error(`No client build in ${publicDir}: run \`npm run build:client\` first`);
  const { loadConfig } = await import(pathToFileURL(path.join(ROOT, 'src/server/config.ts')).href);
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'src/server/server.ts')).href);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'floors-perf-'));
  const dir = (...p) => {
    const d = path.join(tmp, ...p);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const project = dir('project');
  writeFileSync(path.join(project, 'README.md'), '# Floors perf\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=perf', '-c', 'user.email=perf@example.com', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  let floors = [];
  if (building) {
    const data = dir('project', '.agent-office');
    const listed = JSON.parse(readFileSync(path.join(building, 'floors.json'), 'utf8'));
    const defs = listed.map((f, i) => {
      const at = path.join(tmp, 'floors', f.id);
      cpSync(path.join(building, f.id), at, { recursive: true });
      return { id: f.id, name: f.name ?? f.id, dir: at, palette: f.palette ?? i, addedBy: 'perf', addedAt: Date.now() };
    });
    floors = defs.map((d) => d.id);
    writeFileSync(path.join(data, 'floors.json'), JSON.stringify(defs, null, 2));
    // The checkout the office runs in isn't a floor of its own.
    writeFileSync(path.join(data, 'local-floor.json'), JSON.stringify({ dir: project, by: 'perf', at: Date.now() }));
  }
  // A stand-in for Claude Code, so nothing runs the real one.
  const claude = path.join(dir('bin'), 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n');
  chmodSync(claude, 0o755);
  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];
  const cfg = loadConfig([project, '--home', dir('home'), '--projects', dir('projects'), '--port', String(port), '--password', PASSWORD, '--no-open', '--weather', 'clear', '--agent', claude]);
  const office = await startServer(cfg, { publicDir });
  return {
    base: `http://127.0.0.1:${port}`,
    floors,
    stop() {
      office.shutdown();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

// ---- What the page draws ----------------------------------------------------------------------------

/**
 * Before the page's own code: every WebGL draw call and its triangles, the CPU time of each browser
 * frame's callbacks (the office's frame, and anything else drawing), when the first draw came and when
 * the loading screen went (window.__perf).
 */
function instrument() {
  const n = { draws: 0, tris: 0, cpu: 0, frames: [], last: performance.now(), firstDraw: null, readyAt: null };
  const count = (mode, verts, inst = 1) => {
    n.draws++;
    // gl.TRIANGLES; the office draws nothing else that has any area.
    if (mode === 4) n.tris += Math.floor(verts / 3) * inst;
  };
  for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!C) continue;
    const p = C.prototype;
    const wrap = (name, fn) => {
      const was = p[name];
      if (was) p[name] = function (...a) {
        fn(a);
        return was.apply(this, a);
      };
    };
    wrap('drawArrays', (a) => count(a[0], a[2]));
    wrap('drawElements', (a) => count(a[0], a[1]));
    wrap('drawArraysInstanced', (a) => count(a[0], a[2], a[3]));
    wrap('drawElementsInstanced', (a) => count(a[0], a[1], a[4]));
    wrap('drawRangeElements', (a) => count(a[0], a[3]));
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const t0 = performance.now();
      try {
        cb(t);
      } finally {
        n.cpu += performance.now() - t0;
      }
    });
  const tick = (t) => {
    if (n.draws && n.firstDraw === null) n.firstDraw = performance.now();
    n.frames.push({ at: t, dt: t - n.last, draws: n.draws, tris: n.tris, cpu: n.cpu });
    if (n.frames.length > 6000) n.frames.splice(0, 2000);
    n.draws = n.tris = n.cpu = 0;
    n.last = t;
    raf(tick);
  };
  raf(tick);
  const gone = () => {
    if (n.readyAt !== null) return true;
    const el = document.getElementById('loading');
    if (document.readyState !== 'loading' && (!el || el.classList.contains('gone'))) {
      n.readyAt = performance.now();
      return true;
    }
    return false;
  };
  const watch = setInterval(() => gone() && clearInterval(watch), 20);
  window.__perf = n;
}

/**
 * The census's hook, before the page's own code: the stack each mesh, line, point cloud or sprite was
 * made with (three sets isMesh and the like as it makes one), for naming the module that built it.
 */
function madeWith() {
  Error.stackTraceLimit = 40;
  const made = new WeakMap();
  window.__made = made;
  for (const flag of ['isMesh', 'isLine', 'isPoints', 'isSprite']) {
    Object.defineProperty(Object.prototype, flag, {
      configurable: true,
      get() {
        return undefined;
      },
      set(v) {
        if (!made.has(this)) made.set(this, new Error().stack);
        Object.defineProperty(this, flag, { value: v, writable: true, enumerable: true, configurable: true });
      },
    });
  }
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const p95 = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round(0.95 * (s.length - 1)))];
};
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Once the batcher (a headset's profile, see world/batch) has batched what's here: what's measured is
 * then what stays. Only on a headset's page (its user agent says so), which has one once its profile
 * has loaded; a laptop's never does.
 */
async function batched(page) {
  if (!(await page.evaluate(() => /\bQuest\b|OculusBrowser/i.test(navigator.userAgent)))) return;
  // A build from before batching never has one.
  if (!(await page.waitForFunction(() => !!window.__batcher, null, { timeout: 15_000 }).then(() => true, () => false))) return;
  await page.waitForFunction(() => window.__batcher?.stats().state === 'ready', null, { timeout: 300_000 }).catch(() => console.log('(the batcher never got ready)'));
}

/** The draw calls, triangles and CPU per browser frame over the last `secs` seconds (window.__perf). */
async function pageFrames(page, secs) {
  await batched(page);
  const t0 = await page.evaluate(() => performance.now());
  await sleep(secs * 1000);
  const fs = await page.evaluate((since) => window.__perf.frames.filter((f) => f.at >= since && f.draws > 0), t0);
  const r = await page.evaluate(() => {
    const i = window.__office.renderer.info;
    return { programs: i.programs?.length ?? 0, textures: i.memory.textures, geometries: i.memory.geometries, heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
  });
  return { calls: median(fs.map((f) => f.draws)), triangles: median(fs.map((f) => f.tris)), cpuMs: r1(median(fs.map((f) => f.cpu))), cpuP95: r1(p95(fs.map((f) => f.cpu))), frameMs: r1(median(fs.map((f) => f.dt))), frames: fs.length, ...r };
}

/** In VR: VR's own counters (both eyes, the whole XR frame) over `secs` seconds. */
async function xrFrames(page, secs) {
  await batched(page);
  const t0 = await page.evaluate(() => performance.now());
  await sleep(secs * 1000);
  const m = await page.evaluate((since) => {
    const fs = window.__vr.perf.frames.filter((f) => f.at >= since);
    const i = window.__office.renderer.info;
    return { cpu: fs.map((f) => f.cpuMs), dt: fs.map((f) => f.dt), calls: fs.map((f) => f.calls), tris: fs.map((f) => f.triangles), programs: i.programs?.length ?? 0, textures: i.memory.textures, geometries: i.memory.geometries };
  }, t0);
  return { calls: median(m.calls), triangles: median(m.tris), cpuMs: r1(median(m.cpu)), cpuP95: r1(p95(m.cpu)), frameMs: r1(median(m.dt)), frames: m.cpu.length, programs: m.programs, textures: m.textures, geometries: m.geometries };
}

// ---- Where to stand ---------------------------------------------------------------------------------

/** The street's height under floor `index` (shared/layout.ts's streetBelow, STREET_Y and STOREY). */
const streetBelow = (index) => -3.6 - Math.max(0, index) * (6.8 + 0.3);

/**
 * The spots on the floor the page is on: at the desks (1.4 m out from the desk nearest the middle of the
 * room, looking across the room through its middle, as you do from there), in the lounge (2.6 m out from
 * the jukebox, looking at it) and on the street across the road from the door, looking up at it.
 * [name, where to stand, what to look at].
 */
async function floorSpots(page) {
  return page.evaluate(() => {
    const o = window.__office;
    const room = o.player.room;
    const mid = [(room.minX + room.maxX) / 2, 0, (room.minZ + room.maxZ) / 2];
    const out = (at, d) => {
      const dx = mid[0] - at[0];
      const dz = mid[2] - at[2];
      const n = Math.hypot(dx, dz) || 1;
      return [at[0] + (dx / n) * d, at[1], at[2] + (dz / n) * d];
    };
    const kinds = (k) => o.office.interactables.filter((i) => i.kind === k && Math.abs(i.y ?? 0) < 0.5).map((i) => [i.x, 0, i.z]);
    const desks = kinds('desk').sort((a, b) => Math.hypot(a[0] - mid[0], a[2] - mid[2]) - Math.hypot(b[0] - mid[0], b[2] - mid[2]));
    const juke = kinds('jukebox')[0];
    const floors = o.store.floors.map((f) => f.id);
    const street = -3.6 - Math.max(0, floors.indexOf(o.store.floor)) * 7.1;
    const spots = [];
    const across = (at) => [2 * mid[0] - at[0], 1.4, 2 * mid[2] - at[2]];
    if (desks[0]) spots.push(['desks', out(desks[0], 1.4), across(desks[0])]);
    if (juke) spots.push(['lounge', out(juke, 2.6), [juke[0], 1.2, juke[2]]]);
    spots.push(['street', [2, street, 33], [0, street + 4, 12]]);
    return spots;
  });
}

/** Up on the roof (the elevator, as anyone gets there): where to stand and what to look at, once there. */
async function toRoof(page) {
  await page.evaluate(() => window.__office.ride('@roof'));
  await page.waitForFunction(() => window.__office.store.floor === '@roof' && window.__office.player.enabled, null, { timeout: 180_000 });
  await sleep(1500);
  const y = await page.evaluate(() => window.__office.player.pos.y);
  return ['roof', [6, y, 6], [-3, y + 1.2, -11.3]];
}

/** Off the roof or onto floor `id`, the quick way (a blink) where there is one, and settled there. */
async function toFloor(page, id) {
  const now = await page.evaluate(() => window.__office.store.floor);
  if (now === id) return;
  await page.evaluate((f) => (window.__office.store.floor === '@roof' ? window.__office.ride(f) : window.__office.switchFloor(f)), id);
  await page.waitForFunction((f) => window.__office.store.floor === f && window.__office.player.enabled, id, { timeout: 180_000 });
  // The floor's furniture and pictures, built as it arrives.
  await sleep(2500);
}

/** On a page that isn't in VR: you, standing at `stand` looking at `look`, at `hour`. */
async function deskSpot(page, stand, look, hour) {
  await page.evaluate(([s, l, h]) => {
    const o = window.__office;
    if (o.player.seat) o.player.stand?.();
    o.player.pos.set(...s);
    o.player.vy = 0;
    o.player.camYaw = Math.atan2(-(l[0] - s[0]), -(l[2] - s[2]));
    o.player.lookPitch = Math.atan2(l[1] - (s[1] + 1.6), Math.hypot(l[0] - s[0], l[2] - s[2]));
    o.sky.show({ hour: h });
  }, [stand, look, hour]);
  await sleep(2500);
}

/** In VR: you, standing at `stand` (the rig takes the headset with you) looking at `look`, at `hour`. */
async function vrSpot(page, stand, look, hour) {
  await page.evaluate(([p]) => window.__vr.perf.goTo(...p), [stand]);
  await frames(page, 4);
  await face(page, yawToward(stand, look));
  await page.evaluate((h) => window.__office.sky.show({ hour: h }), hour);
  await sleep(2000);
}

// ---- The parts ----------------------------------------------------------------------------------------

/** Every floor's spots (and the roof) in turn, measured by `measure` at 1x and 4x CPU throttling. */
async function eachSpot(page, floors, { place, measure, cdp, label, shots, hour = 13, rates = RATES }) {
  const out = {};
  const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const visit = async (key, stand, look) => {
    await place(page, stand, look, hour);
    const row = {};
    for (const rate of rates) {
      await throttle(rate);
      // Whatever coming here built or compiled, out of the way first.
      await sleep(rate === 4 ? 2500 : 1500);
      row[`${rate}x`] = await measure(page, SECONDS);
    }
    await throttle(1);
    out[key] = row;
    if (shots) await page.screenshot({ path: path.join(shots, `${label}-${key.replace(/[^a-z0-9-]+/gi, '-')}.png`) });
    // (A census's rows are too many to print: their count and draw calls.)
    const brief = Object.fromEntries(Object.entries(row).map(([k, m]) => [k, m.rows ? { objects: m.rows.length, calls: m.rows.reduce((n, x) => n + x.main + x.outline + x.shadow, 0) } : m]));
    console.log(`${label} · ${key}: ${JSON.stringify(brief)}`);
  };
  const wanted = (key) => !SPOTS || SPOTS.includes(key);
  for (const id of floors.length ? floors : [null]) {
    if (id && SPOTS && !SPOTS.some((k) => k.startsWith(`${id} · `))) continue;
    if (id) await toFloor(page, id);
    const floor = id ?? (await page.evaluate(() => window.__office.store.floor));
    for (const [name, stand, look] of await floorSpots(page)) if (wanted(`${floor} · ${name}`)) await visit(`${floor} · ${name}`, stand, look);
  }
  if (wanted('roof')) {
    const [name, stand, look] = await toRoof(page);
    await visit(name, stand, look);
  }
  if (floors[0]) await toFloor(page, floors[0]);
  return out;
}

/** How long the office takes to come up with the CPU throttled `rate` times, and what it loaded. */
async function startup(browser, base, rate, ua) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(ua ? { userAgent: ua } : {}) });
  try {
    await context.addInitScript(instrument);
    await context.addInitScript(() => {
      try {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Startup', color: '#4f86f7', look: { skin: 1, hair: 2, style: 0 } }));
      } catch {
        // about:blank
      }
    });
    const login = await context.request.post(`${base}/api/login`, { data: { password: PASSWORD } });
    if (!login.ok()) throw new Error(`Signing in was refused (${login.status()})`);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(`${base}/`);
    await page.waitForFunction(() => window.__perf?.readyAt !== null && window.__office?.store?.floor, null, { timeout: 300_000 });
    await page.waitForFunction(() => window.__perf.firstDraw !== null, null, { timeout: 300_000 });
    // Watched for a while after: what's still being built or compiled shows as long frames.
    await sleep(25_000);
    return await page.evaluate(() => {
      const n = window.__perf;
      const fs = n.frames.filter((f) => f.draws > 0);
      const tail = fs.filter((f) => f.at > fs.at(-1).at - 5000);
      const steady = tail.map((f) => f.dt).sort((a, b) => a - b)[Math.floor(tail.length / 2)] ?? 0;
      // Settled: the end of the last frame that took more than three of the steady ones (and over 150 ms).
      const long = fs.filter((f) => f.dt > Math.max(3 * steady, 150));
      const scripts = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name));
      const before = scripts.filter((r) => r.startTime <= n.readyAt);
      const kb = (rs) => Math.round(rs.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024);
      const i = window.__office.renderer.info;
      return {
        firstFrameMs: Math.round(n.firstDraw),
        readyMs: Math.round(n.readyAt),
        settledMs: Math.round(long.length ? long.at(-1).at : n.firstDraw),
        longFramesAfterReady: long.filter((f) => f.at > n.readyAt).length,
        steadyFrameMs: Math.round(steady),
        jsBeforeReadyKb: kb(before),
        jsFilesBeforeReady: before.map((r) => r.name.split('/').pop()),
        jsAllKb: kb(scripts),
        programs: i.programs?.length ?? 0,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
        heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      };
    });
  } finally {
    await context.close();
  }
}

// ---- The census ---------------------------------------------------------------------------------------

/**
 * One frame's draw calls on this page, object by object (every pass: the scene, the outline, the sun's
 * shadow map; in VR both eyes), with where each object sits in the scene and the stack it was made with.
 */
async function censusFrame(page) {
  return page.evaluate(async () => {
    const o = window.__office;
    const r = o.renderer;
    const seen = new Map();
    const textures = new Map();
    const was = r.renderBufferDirect;
    const counting = function (camera, scene, geometry, material, object, group) {
      const pass = scene === null ? 'shadow' : material?.type === 'OutlineEffect' ? 'outline' : 'main';
      let row = seen.get(object);
      if (!row) seen.set(object, (row = { main: 0, outline: 0, shadow: 0, tris: 0 }));
      row[pass]++;
      if (pass === 'main') {
        const n = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
        const c = Math.min(n, group ? group.count : geometry.drawRange.count);
        row.tris += Math.floor(c / 3) * (object.isInstancedMesh ? object.count : 1);
        for (const k of ['map', 'emissiveMap', 'alphaMap']) {
          const t = material?.[k];
          const img = t?.image;
          if (img && !textures.has(t)) textures.set(t, { w: img.videoWidth || img.width || 0, h: img.videoHeight || img.height || 0, kind: img.constructor?.name ?? '?', name: object.name || object.parent?.name || '' });
        }
      }
      return was.call(this, camera, scene, geometry, material, object, group);
    };
    // One whole frame of the office's, the shadow map included (drawn every frame on a laptop): counting
    // starts after this browser frame's office frame and stops after the next one's.
    await new Promise((res) =>
      requestAnimationFrame(() => {
        r.renderBufferDirect = counting;
        requestAnimationFrame(() => {
          r.renderBufferDirect = was;
          res();
        });
      }),
    );
    const top = (obj) => {
      const chain = [];
      for (let p = obj; p; p = p.parent) chain.unshift(p);
      // [scene, child, grandchild, ...]
      const label = (p, i) => p?.name || (p ? `${p.type}#${p.parent ? p.parent.children.indexOf(p) : i}` : '?');
      if (chain[0] !== o.scene) return `(${label(chain[0], 0)})`;
      const c1 = chain[1];
      if (c1 === o.office.group) return `office/${label(chain[2], 0)}`;
      return label(c1, 0);
    };
    const rows = [...seen].map(([obj, row]) => ({
      ...row,
      top: top(obj),
      name: obj.name || '',
      type: obj.type,
      mat: Array.isArray(obj.material) ? 'multi' : `${obj.material?.type ?? '?'}${obj.material?.transparent ? '+t' : ''}`,
      stack: obj.name.startsWith('batch ') ? 'batch' : (window.__made?.get(obj) ?? ''),
    }));
    const tex = [...textures.values()].map((t) => ({ ...t, mp: (t.w * t.h) / 1e6 })).sort((a, b) => b.mp - a.mp);
    return { rows, textures: { count: tex.length, megapixels: Math.round(tex.reduce((n, t) => n + t.mp, 0) * 10) / 10, biggest: tex.slice(0, 12) } };
  });
}

/** Source maps for the chunks of `publicDir`, to name the module a stack frame is in. */
async function sourceMaps(publicDir) {
  const { SourceMapConsumer } = await import('source-map-js');
  const maps = new Map();
  const dir = path.join(publicDir, 'assets');
  for (const f of readdirSync(dir)) if (f.endsWith('.js.map')) maps.set(f.slice(0, -4), new SourceMapConsumer(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))));
  return maps;
}

/** Modules that make meshes for others: the module a mesh is counted under is the first caller past them. */
const HELPERS = /(^|\/)(world\/toon|world\/models|world\/office\/materials|world\/office\/furniture-kit|world\/scenic\/kit|world\/frames|world\/glass)\.ts$|node_modules|^three\//;

/** The module (src/client/...) that built an object, from the stack it was made with. */
function moduleOf(stack, maps) {
  if (stack === 'batch') return '(merged by world/batch)';
  const frames = [];
  for (const line of stack.split('\n').slice(1)) {
    const m = /\(?(https?:\/\/[^\s)]+?\/assets\/([^/:\s]+\.js)):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!m) continue;
    const map = maps.get(m[2]);
    if (!map) {
      frames.push(m[2]);
      continue;
    }
    const pos = map.originalPositionFor({ line: Number(m[3]), column: Number(m[4]) - 1 });
    if (!pos.source) continue;
    const src = pos.source.replace(/^.*?src\/client\//, '').replace(/^.*node_modules\//, 'node_modules/');
    frames.push(src);
  }
  return frames.find((f) => !HELPERS.test(f)) ?? frames[0] ?? '?';
}

function tally(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    const t = out.get(k) ?? { part: k, calls: 0, main: 0, outline: 0, shadow: 0, triangles: 0, objects: 0 };
    t.main += r.main;
    t.outline += r.outline;
    t.shadow += r.shadow;
    t.calls += r.main + r.outline + r.shadow;
    t.triangles += r.tris;
    t.objects++;
    out.set(k, t);
  }
  return [...out.values()].sort((a, b) => b.calls - a.calls);
}

/** The census at each spot of every floor, on a page (a laptop's, or with `ua` a Quest's) whose meshes say where they were made. */
async function census(browser, office, maps, { ua } = {}) {
  const { page, context } = await openOffice(browser, office.base, { vr: false, name: 'Census', init: [instrument, madeWith], userAgent: ua });
  const out = {};
  try {
    const cdp = await context.newCDPSession(page);
    await eachSpot(page, office.floors, {
      cdp,
      label: ua ? 'questcensus' : 'census',
      place: deskSpot,
      rates: [1],
      measure: async () => {
        await batched(page);
        return censusFrame(page);
      },
    }).then((spots) => {
      for (const [spot, m] of Object.entries(spots)) {
        const rows = m['1x'].rows.map((r) => ({ ...r, module: moduleOf(r.stack, maps) }));
        // A part of the scene is named by the module that made most of what it draws.
        const lead = new Map();
        for (const t of tally(rows, (r) => `${r.top}\t${r.module}`)) {
          const [top, module] = t.part.split('\t');
          if (!lead.has(top)) lead.set(top, module);
        }
        out[spot] = { byPart: tally(rows, (r) => `${r.top} (${lead.get(r.top)})`), byModule: tally(rows, (r) => r.module), byMaterial: tally(rows, (r) => r.mat), total: tally(rows, () => 'all')[0], textures: m['1x'].textures };
      }
    });
  } finally {
    await context.close();
  }
  return out;
}

// ---- Markdown ----------------------------------------------------------------------------------------

function markdown(r) {
  const rows = [`Measured ${r.at} from ${r.public}, ${r.seconds} s a measurement, headless Chrome (SwiftShader). The laptop is the page as a laptop's browser has it; the Quest page is the same page with the Quest 2 browser's user agent (its flat page); VR is iwer's Quest 2, both eyes. Each cell: draw calls / triangles / CPU ms a frame.`, ''];
  const cell = (m) => (m ? `${m.calls} / ${Math.round(m.triangles / 1000)}k / ${m.cpuMs}` : '—');
  const spots = new Set([...Object.keys(r.desktop), ...Object.keys(r.questpage ?? {}), ...Object.keys(r.vr)]);
  if (spots.size) {
    rows.push('| Spot | Laptop 1x | Laptop 4x | Quest page 1x | Quest page 4x | VR 1x | VR 4x |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const spot of spots) {
      const [d, q, v] = [r.desktop[spot] ?? {}, r.questpage?.[spot] ?? {}, r.vr[spot] ?? {}];
      rows.push(`| ${spot} | ${cell(d['1x'])} | ${cell(d['4x'])} | ${cell(q['1x'])} | ${cell(q['4x'])} | ${cell(v['1x'])} | ${cell(v['4x'])} |`);
    }
  }
  for (const [k, s] of Object.entries(r.startup)) {
    rows.push('', `Startup, ${k}: first frame ${s.firstFrameMs} ms, loading screen gone ${s.readyMs} ms, settled ${s.settledMs} ms (${s.longFramesAfterReady} long frames after), steady frame ${s.steadyFrameMs} ms; ${s.jsBeforeReadyKb} KB of JS before it was up (${s.jsFilesBeforeReady.length} files), ${s.jsAllKb} KB in all; ${s.programs} programs, ${s.textures} textures, ${s.geometries} geometries, ${s.heapMb} MB heap`);
  }
  for (const [which, census] of [['laptop', r.census], ['Quest page', r.questcensus ?? {}]]) {
    for (const [spot, c] of Object.entries(census)) {
      rows.push('', `Census (${which}), ${spot}: ${c.total.calls} calls (${c.total.main} scene, ${c.total.outline} outline, ${c.total.shadow} shadow), ${c.total.objects} objects; ${c.textures.count} textures in view, ${c.textures.megapixels} megapixels`, '', '| Module | Calls | Scene | Outline | Shadow | Objects | Triangles |', '| --- | --- | --- | --- | --- | --- | --- |');
      for (const m of c.byModule.slice(0, 20)) rows.push(`| ${m.part} | ${m.calls} | ${m.main} | ${m.outline} | ${m.shadow} | ${m.objects} | ${Math.round(m.triangles / 1000)}k |`);
      rows.push('', '| Part of the scene | Calls | Scene | Outline | Shadow | Objects |', '| --- | --- | --- | --- | --- | --- |');
      for (const m of c.byPart.slice(0, 12)) rows.push(`| ${m.part} | ${m.calls} | ${m.main} | ${m.outline} | ${m.shadow} | ${m.objects} |`);
      rows.push('', `Biggest textures in view: ${c.textures.biggest.slice(0, 8).map((t) => `${t.w}×${t.h} ${t.kind}${t.name ? ` (${t.name})` : ''}`).join(', ')}`);
    }
  }
  return `${rows.join('\n')}\n`;
}

// ---- The run -------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  const shots = path.join(OUT, 'shots');
  mkdirSync(shots, { recursive: true });
  const office = await startBuilding();
  const browser = await launch();
  const result = { at: new Date().toISOString(), public: PUBLIC, seconds: SECONDS, floors: office.floors, desktop: {}, questpage: {}, vr: {}, startup: {}, census: {}, questcensus: {} };
  const save = () => {
    writeFileSync(path.join(OUT, 'floors-perf.json'), JSON.stringify(result, null, 2));
    writeFileSync(path.join(OUT, 'floors-perf.md'), markdown(result));
  };
  try {
    if (ONLY.has('startup')) {
      result.startup['laptop 4x'] = await startup(browser, office.base, 4);
      console.log(`startup · laptop 4x: ${JSON.stringify(result.startup['laptop 4x'])}`);
      result.startup['quest page 4x'] = await startup(browser, office.base, 4, QUEST2_UA);
      console.log(`startup · quest page 4x: ${JSON.stringify(result.startup['quest page 4x'])}`);
      save();
    }
    // A laptop, and the Quest's own browser outside VR (its flat page), each at every spot.
    for (const [part, ua, label] of [['desktop', undefined, 'laptop'], ['questpage', QUEST2_UA, 'questpage']]) {
      if (!ONLY.has(part)) continue;
      const { page, context } = await openOffice(browser, office.base, { vr: false, name: 'Laptop', init: [instrument], userAgent: ua });
      const cdp = await context.newCDPSession(page);
      result[part] = await eachSpot(page, office.floors, { cdp, label, place: deskSpot, measure: pageFrames, shots: ONLY.has('shots') ? shots : null });
      await context.close();
      save();
    }
    if (ONLY.has('vr')) {
      const { page, context } = await openOffice(browser, office.base, { vr: true, name: 'Visor', init: [instrument] });
      await enterVr(page);
      const cdp = await context.newCDPSession(page);
      result.vr = await eachSpot(page, office.floors, { cdp, label: 'vr', place: vrSpot, measure: xrFrames, shots: ONLY.has('shots') ? shots : null });
      await context.close();
      save();
    }
    for (const [part, ua] of [['census', undefined], ['questcensus', QUEST2_UA]]) {
      if (!ONLY.has(part)) continue;
      const maps = await sourceMaps(PUBLIC);
      result[part] = await census(browser, office, maps, { ua });
      save();
    }
  } finally {
    await browser.close();
    office.stop();
  }
  save();
  console.log(`\n${markdown(result)}\nWritten to ${OUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { instrument, closeWindows };
