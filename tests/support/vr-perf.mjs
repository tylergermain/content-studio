// The VR numbers (docs/vr.md, "Measuring"): draw calls, triangles, programs, textures and the page's
// CPU time per frame, on a desktop and in VR (iwer's Quest 2, both eyes), at four spots, for VR's
// full quality and the Quest 2 profile, then each knob on its own; the draw calls by part of the
// scene; and how long the panels take to paint. From the repo root, after `npm run build:client`:
//
//   node --import tsx tests/support/vr-perf.mjs
//   node --import tsx tests/support/vr-perf.mjs --base http://127.0.0.1:14672   the desktop against another build too
//
// --seconds N (5) is how long each measurement runs; --base-password (vr-check) signs in to --base.
// Writes VR_OUT/vr-perf.json and vr-perf.md (VR_OUT is /tmp/vr-perf) and prints the Markdown. Draw
// calls and triangles carry over to the headset; CPU time only roughly (4x CPU throttling stands in for
// the Quest 2's CPU), and software rendering's GPU time says nothing about the Quest's.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PASSWORD, aim, clickOn, closeWindows, enterVr, find, frames, goTo, launch, openOffice, press, sleep, startOffice } from './vr-browser.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SECONDS = Number(arg('seconds', 5));
const BASE = arg('base', null);
const BASE_PASSWORD = arg('base-password', PASSWORD);
const OUT = process.env.VR_OUT ?? '/tmp/vr-perf';

/** Counts WebGL draw calls a browser frame (window.__draws), before the office's code runs: the same on any build. */
function countDraws() {
  const n = { draws: 0, frames: [], last: performance.now() };
  for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!C) continue;
    for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const was = C.prototype[f];
      if (!was) continue;
      C.prototype[f] = function (...a) {
        n.draws++;
        return was.apply(this, a);
      };
    }
  }
  const tick = (t) => {
    n.frames.push({ at: t, dt: t - n.last, draws: n.draws });
    if (n.frames.length > 3000) n.frames.splice(0, 1000);
    n.draws = 0;
    n.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__draws = n;
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

/** The spots measured: [name, the interactable they're by, how far out from it, the hour]. */
const SPOTS = [
  ['lounge by day', 'jukebox', 2.6, 13],
  ['desks at night', 'desk', 1.4, 22],
  ['balcony at night', 'golf', 1.2, 22],
  ['garage at night', 'car', 3, 22],
];

/** Where to stand for a spot, and what to look at, on the page's floor; null if the floor hasn't one. */
async function spotOf(page, kind, out) {
  const at = await find(page, kind);
  if (!at) return null;
  const room = await page.evaluate(() => ({ ...window.__office.player.room }));
  const mid = [(room.minX + room.maxX) / 2, at[1], (room.minZ + room.maxZ) / 2];
  const dx = mid[0] - at[0];
  const dz = mid[2] - at[2];
  const n = Math.hypot(dx, dz) || 1;
  return { stand: [at[0] + (dx / n) * out, at[1], at[2] + (dz / n) * out], look: at };
}

/** On a desktop: stands you at a spot (the player's own position, there's no rig), at an hour. */
async function deskSpot(page, spot, hour) {
  await page.evaluate(([s, l, h]) => {
    const o = window.__office;
    o.player.pos.set(...s);
    o.player.vy = 0;
    o.player.camYaw = Math.atan2(-(l[0] - s[0]), -(l[2] - s[2]));
    o.player.lookPitch = -0.05;
    o.sky.show({ hour: h });
  }, [spot.stand, spot.look, hour]);
  await sleep(2500);
}

/** The draw calls and frame times of the last `secs` seconds (window.__draws), on any build. */
async function browserFrames(page, secs) {
  const t0 = await page.evaluate(() => performance.now());
  await sleep(secs * 1000);
  const fs = await page.evaluate((since) => window.__draws.frames.filter((f) => f.at >= since), t0);
  return { draws: median(fs.map((f) => f.draws)), frameMs: r1(median(fs.map((f) => f.dt))), frameP95: r1(p95(fs.map((f) => f.dt))), frames: fs.length };
}

/** In VR: VR's own counters over `secs` seconds (both eyes, the whole frame), and WebGL's draw count. */
async function vrFrames(page, secs) {
  const t0 = await page.evaluate(() => performance.now());
  const draws = await browserFrames(page, secs);
  const m = await page.evaluate((since) => {
    const p = window.__vr.perf;
    const fs = p.frames.filter((f) => f.at >= since);
    const last = p.samples.at(-1);
    const r = window.__office.renderer.info;
    return { cpu: fs.map((f) => f.cpuMs), calls: fs.map((f) => f.calls), tris: fs.map((f) => f.triangles), programs: r.programs?.length ?? 0, textures: r.memory.textures, geometries: r.memory.geometries, paint: last?.paintMs ?? 0 };
  }, t0);
  return {
    calls: median(m.calls),
    triangles: median(m.tris),
    cpuMs: r1(median(m.cpu)),
    cpuP95: r1(p95(m.cpu)),
    programs: m.programs,
    textures: m.textures,
    geometries: m.geometries,
    webglDraws: draws.draws,
    frameMs: draws.frameMs,
  };
}

/** VR's full quality: everything the Quest 2 profile turns down, back up (the resolution only changes with a new session). */
const FULL = { outline: true, shadows: 'on', shadowMapSize: 2048, halos: true, hotTextureEveryMs: 0, sceneryReach: 1, maxLamps: 24 };
const QUEST2 = { outline: false, shadows: 'throttled', shadowMapSize: 1024, halos: false, hotTextureEveryMs: 100, sceneryReach: 0.6, maxLamps: 24 };

async function knobs(page, values) {
  await page.evaluate((v) => {
    for (const [k, x] of Object.entries(v)) window.__vr.knobs.set(k, x);
  }, values);
  await frames(page, 6);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const office = await startOffice();
  const browser = await launch();
  const result = { at: new Date().toISOString(), seconds: SECONDS, desktop: {}, vr: {}, ablations: {}, census: {}, panels: {}, compare: null };
  try {
    // ---- The desktop, as it is (and against --base) ----
    {
      const { page, context } = await openOffice(browser, office.base, { vr: false, name: 'Desk', init: [countDraws] });
      for (const [name, kind, out, hour] of SPOTS) {
        const spot = await spotOf(page, kind, out);
        if (!spot) continue;
        await deskSpot(page, spot, hour);
        result.desktop[name] = await browserFrames(page, SECONDS);
        console.log(`desktop · ${name}: ${JSON.stringify(result.desktop[name])}`);
      }
      if (BASE) result.compare = await compare(browser, page, office.base);
      await context.close();
    }

    // ---- VR ----
    const { page, context } = await openOffice(browser, office.base, { vr: true, name: 'Visor', init: [countDraws] });
    await enterVr(page);
    const cdp = await context.newCDPSession(page);
    const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });

    for (const [name, kind, out, hour] of SPOTS) {
      const spot = await spotOf(page, kind, out);
      if (!spot) continue;
      await goTo(page, spot.stand, spot.look);
      await page.evaluate((h) => window.__office.sky.show({ hour: h }), hour);
      for (const [profile, values] of [['full', FULL], ['quest2', QUEST2]]) {
        await knobs(page, values);
        await sleep(1500);
        for (const rate of name === 'lounge by day' ? [1, 4] : [1]) {
          await throttle(rate);
          const m = await vrFrames(page, SECONDS);
          (result.vr[name] ??= {})[`${profile} ${rate}x`] = m;
          console.log(`vr · ${name} · ${profile} ${rate}x: ${JSON.stringify(m)}`);
        }
        await throttle(1);
      }
      result.census[name] = (await page.evaluate(() => window.__vr.perf.census())).slice(0, 15);
    }

    // ---- Each knob on its own, from the Quest 2 profile, in the lounge ----
    const lounge = await spotOf(page, 'jukebox', 2.6);
    if (lounge) {
      await goTo(page, lounge.stand, lounge.look);
      await page.evaluate(() => window.__office.sky.show({ hour: 13 }));
      await knobs(page, QUEST2);
      await sleep(1500);
      result.ablations['quest2'] = await vrFrames(page, SECONDS);
      for (const k of Object.keys(FULL)) {
        if (FULL[k] === QUEST2[k]) continue;
        await knobs(page, { [k]: FULL[k] });
        await sleep(1000);
        result.ablations[`${k} → ${FULL[k]}`] = await vrFrames(page, SECONDS);
        await knobs(page, { [k]: QUEST2[k] });
        console.log(`ablation · ${k}: ${JSON.stringify(result.ablations[`${k} → ${FULL[k]}`])}`);
      }
    }

    // ---- How long the panels take to paint ----
    const paint = async (name, open) => {
      try {
        if (!(await open())) return;
        const xs = [];
        for (let i = 0; i < SECONDS * 5; i++) {
          await sleep(200);
          xs.push(await page.evaluate(() => window.__vr.panels?.lastPaintMs ?? 0));
        }
        result.panels[name] = { medianMs: r1(median(xs)), maxMs: r1(Math.max(...xs)) };
        console.log(`panel · ${name}: ${JSON.stringify(result.panels[name])}`);
      } catch (err) {
        result.panels[name] = { error: err.message };
      }
    };
    await paint('HUD sheet', async () => (await press(page, 'left', 'x-button'), true));
    await paint('settings', async () => {
      await clickOn(page, 'hud', '.dock-menu');
      await frames(page, 10);
      const item = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button, [role="menuitem"], a')].find((x) => /settings/i.test(x.textContent ?? '') && x.getBoundingClientRect().width > 0);
        if (b) b.click();
        return !!b;
      });
      return item;
    });
    await closeWindows(page);
    await press(page, 'left', 'x-button');
    await paint('terminal streaming', async () => {
      const desk = await spotOf(page, 'desk', 1.2);
      if (!desk) return false;
      await goTo(page, desk.stand, desk.look);
      await aim(page, 'right', [desk.look[0], 0.8, desk.look[2]]);
      await page.keyboard.press('b');
      const open = await page.waitForFunction(() => !!document.querySelector('#modal-root .xterm'), null, { timeout: 15_000 }).then(() => true, () => false);
      if (!open) return false;
      await page.evaluate(() => document.querySelector('#modal-root .xterm-helper-textarea')?.focus());
      await page.keyboard.type('for i in $(seq 1 4000); do echo "line $i of a terminal streaming in VR"; sleep 0.002; done\n');
      return true;
    });
    await closeWindows(page);
    await paint('office builder sheet', async () => {
      await page.keyboard.press('u');
      return page.waitForFunction(() => !!document.querySelector('#modal-root .backdrop'), null, { timeout: 10_000 }).then(() => true, () => false);
    });
    await closeWindows(page);
  } finally {
    await browser.close();
    office.stop();
  }
  writeFileSync(path.join(OUT, 'vr-perf.json'), JSON.stringify(result, null, 2));
  const md = markdown(result);
  writeFileSync(path.join(OUT, 'vr-perf.md'), md);
  console.log(`\n${md}\nWritten to ${OUT}`);
}

/** The desktop here against --base: the same spot, draw calls and how many pixels differ. */
async function compare(browser, page, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    await ctx.addInitScript(countDraws);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Desk', color: '#4f86f7', look: { skin: 1, hair: 2, style: 0 } }));
      } catch {
        // about:blank
      }
    });
    const login = await ctx.request.post(`${BASE}/api/login`, { data: { password: BASE_PASSWORD } });
    if (!login.ok()) return { error: `--base refused the password (${login.status()})` };
    const other = await ctx.newPage();
    await other.goto(`${BASE}/`);
    await other.waitForFunction(() => window.__office?.store?.floor && window.__draws && !document.querySelector('#loading:not(.gone)'), null, { timeout: 240_000 });
    await closeWindows(other);
    const spot = await spotOf(page, 'jukebox', 2.6);
    const shots = [];
    const draws = [];
    for (const p of [page, other]) {
      await deskSpot(p, spot, 13);
      draws.push((await browserFrames(p, SECONDS)).draws);
      shots.push((await p.screenshot()).toString('base64'));
    }
    // How many pixels differ by more than a little, decoded in the browser.
    const differ = await page.evaluate(async ([a, b]) => {
      const img = async (s) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const [x, y] = await Promise.all([img(a), img(b)]);
      const c = new OffscreenCanvas(x.width, x.height);
      const g = c.getContext('2d');
      g.drawImage(x, 0, 0);
      const da = g.getImageData(0, 0, x.width, x.height).data;
      g.clearRect(0, 0, x.width, x.height);
      g.drawImage(y, 0, 0);
      const db = g.getImageData(0, 0, x.width, x.height).data;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) n++;
      return n / (da.length / 4);
    }, shots);
    writeFileSync(path.join(OUT, 'desktop-branch.png'), Buffer.from(shots[0], 'base64'));
    writeFileSync(path.join(OUT, 'desktop-base.png'), Buffer.from(shots[1], 'base64'));
    return { branchDraws: draws[0], baseDraws: draws[1], pixelsDiffering: Math.round(differ * 10000) / 100 };
  } finally {
    await ctx.close();
  }
}

function markdown(r) {
  const rows = [];
  rows.push(`Measured ${r.at}, ${r.seconds} s a measurement, iwer's Quest 2 in headless Chrome (SwiftShader).`, '');
  rows.push('| Spot | Desktop draws | VR full: calls / tris / CPU ms | VR Quest 2: calls / tris / CPU ms |', '| --- | --- | --- | --- |');
  for (const name of Object.keys(r.vr)) {
    const d = r.desktop[name];
    const v = r.vr[name];
    const cell = (m) => (m ? `${m.calls} / ${Math.round(m.triangles / 1000)}k / ${m.cpuMs} (p95 ${m.cpuP95})` : '—');
    rows.push(`| ${name} | ${d ? d.draws : '—'} | ${cell(v['full 1x'])} | ${cell(v['quest2 1x'])} |`);
    if (v['quest2 4x']) rows.push(`| ${name}, 4x CPU throttle | | ${cell(v['full 4x'])} | ${cell(v['quest2 4x'])} |`);
  }
  rows.push('', '| Lounge, Quest 2 profile with one knob up | Calls | Triangles | CPU ms | Programs | Textures |', '| --- | --- | --- | --- | --- | --- |');
  for (const [k, m] of Object.entries(r.ablations)) rows.push(`| ${k} | ${m.calls} | ${Math.round(m.triangles / 1000)}k | ${m.cpuMs} | ${m.programs} | ${m.textures} |`);
  for (const [spot, census] of Object.entries(r.census)) {
    rows.push('', `Draw calls by part of the scene, ${spot} (one eye):`, '', '| Part | Calls | Triangles |', '| --- | --- | --- |');
    for (const c of census) rows.push(`| ${c.part} | ${c.calls} | ${Math.round(c.triangles / 1000)}k |`);
  }
  rows.push('', '| Panel | Paint ms (median) | Paint ms (max) |', '| --- | --- | --- |');
  for (const [k, m] of Object.entries(r.panels)) rows.push(m.error ? `| ${k} | ${m.error} | |` : `| ${k} | ${m.medianMs} | ${m.maxMs} |`);
  if (r.compare) rows.push('', `Desktop against --base, lounge by day: ${JSON.stringify(r.compare)}`);
  return `${rows.join('\n')}\n`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
