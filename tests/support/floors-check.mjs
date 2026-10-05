// The office still works with a headset's profile on (docs/vr.md, "How hard it works the headset"): on a
// laptop's page, and on the Quest 2 browser's own page outside VR, where world/batch merges the still
// office into a few hundred draw calls. At the desks of one floor of --building: E at a seat sits you
// down; E at the elevator opens its window; the office builder opens (the batches let go, so it can
// drag and cut away anything) and closes again (they come back); the basketball is picked up; and by
// day and by night, what the Quest page draws batched against the same with batching off, pixel by
// pixel. From the repo root, after `npm run build:client`:
//
//   node --import tsx tests/support/floors-check.mjs --building <dir> [--floor content]
//
// Prints PASS or FAIL per check and page; exits 1 on a FAIL. Screenshots go to --out (VR_SHOTS, /tmp/vr-shots).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeWindows, launch, openOffice, sleep } from './vr-browser.mjs';
import { QUEST2_UA, startBuilding } from './floors-perf.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BUILDING = arg('building', null);
const FLOOR = arg('floor', 'content');
const OUT = path.resolve(arg('out', process.env.VR_SHOTS ?? '/tmp/vr-shots'));

const results = [];
async function check(name, page, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}${note ? `: ${note}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${err.message}`);
    await page.screenshot({ path: path.join(OUT, `fail-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
  }
}
const expect = (ok, what) => {
  if (!ok) throw new Error(what);
};

/** You, at `stand`, looking at `look` (first person, by day unless `hour` says otherwise). */
async function stand(page, at, look) {
  await page.evaluate(([s, l]) => {
    const o = window.__office;
    if (o.player.seat) o.player.stand();
    o.player.pos.set(...s);
    o.player.vy = 0;
    o.player.camYaw = Math.atan2(-(l[0] - s[0]), -(l[2] - s[2]));
    o.player.lookPitch = Math.atan2(l[1] - (s[1] + 1.6), Math.hypot(l[0] - s[0], l[2] - s[2]));
  }, [at, look]);
  await sleep(1200);
}

/** The first interactable of `kind` on the office floor (not upstairs), and a spot `d` in front of it toward the middle of the room. */
async function near(page, kind, d) {
  return page.evaluate(([k, dist]) => {
    const o = window.__office;
    const room = o.player.room;
    const mid = [(room.minX + room.maxX) / 2, (room.minZ + room.maxZ) / 2];
    const it = o.office.interactables.filter((i) => i.kind === k && !i.off && Math.abs(i.y ?? 0) < 0.5).sort((a, b) => Math.hypot(a.x - mid[0], a.z - mid[1]) - Math.hypot(b.x - mid[0], b.z - mid[1]))[0];
    if (!it) return null;
    const dx = mid[0] - it.x;
    const dz = mid[1] - it.z;
    const n = Math.hypot(dx, dz) || 1;
    return { at: [it.x, 0, it.z], stand: [it.x + (dx / n) * dist, 0, it.z + (dz / n) * dist] };
  }, [kind, d]);
}

/** Once the page's batcher (a Quest page's) is batched; nothing on a laptop's. */
async function batched(page) {
  await page.waitForFunction(() => !/\bQuest\b|OculusBrowser/i.test(navigator.userAgent) || window.__batcher?.stats().state === 'ready', null, { timeout: 300_000 });
}

/** How many of two screenshots' pixels differ by more than a little (decoded in the page). */
function differ(page, a, b) {
  return page.evaluate(async ([x64, y64]) => {
    const img = async (s) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const [x, y] = await Promise.all([img(x64), img(y64)]);
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
  }, [a.toString('base64'), b.toString('base64')]);
}

/** The scene alone, with nothing of the page over it (the HUD, toasts, the hint), for comparing pictures. */
const bare = (page, on) => page.evaluate((hide) => document.documentElement.classList.toggle('floors-check-bare', hide), on);

async function pageChecks(browser, office, which, ua) {
  const { page, context } = await openOffice(browser, office.base, { vr: false, name: `Check ${which}`, userAgent: ua });
  try {
    await page.addStyleTag({ content: '.floors-check-bare #hud, .floors-check-bare #toasts, .floors-check-bare #hint, .floors-check-bare #crosshair, .floors-check-bare .toast { visibility: hidden !important; }' });
    await page.evaluate((f) => window.__office.switchFloor(f), FLOOR);
    await page.waitForFunction((f) => window.__office.store.floor === f && window.__office.player.enabled, FLOOR, { timeout: 60_000 });
    await page.evaluate(() => window.__office.sky.show({ hour: 13 }));
    await batched(page);

    await check(`${which}: E at a seat sits you down`, page, async () => {
      const s = await near(page, 'seat', 1.1);
      expect(s, 'no seat on the floor');
      await stand(page, s.stand, [s.at[0], 0.45, s.at[2]]);
      await page.keyboard.press('e');
      await page.waitForFunction(() => !!window.__office.player.seat, null, { timeout: 10_000 }).catch(() => {
        throw new Error('E at the seat didn\'t sit you down');
      });
      await page.evaluate(() => window.__office.player.stand());
      return 'sat, and stood';
    });

    await check(`${which}: E at the elevator opens its window`, page, async () => {
      const s = await near(page, 'elevator', 2);
      expect(s, 'no elevator');
      await stand(page, s.stand, [s.at[0], 1.2, s.at[2]]);
      await page.keyboard.press('e');
      await page.waitForFunction(() => !!document.querySelector('#modal-root .backdrop'), null, { timeout: 10_000 }).catch(() => {
        throw new Error('no window');
      });
      await closeWindows(page);
      return 'opened, closed by Esc';
    });

    await check(`${which}: the basketball, picked up and dropped`, page, async () => {
      const at = await page.evaluate(() => {
        const b = window.__office.ball;
        const p = b.group.getWorldPosition(new b.group.position.constructor());
        return [p.x, p.y, p.z];
      });
      await stand(page, [at[0] + 1.1, 0, at[2]], at);
      await page.keyboard.press('e');
      await page.waitForFunction(() => window.__office.ball.holder === window.__office.store.you, null, { timeout: 10_000 }).catch(() => {
        throw new Error('E at the ball didn\'t pick it up');
      });
      await page.keyboard.press('q');
      await page.waitForFunction(() => window.__office.ball.holder !== window.__office.store.you, null, { timeout: 10_000 }).catch(() => {
        throw new Error('Q didn\'t drop it');
      });
      return 'up with E, down with Q';
    });

    await check(`${which}: the office builder opens and closes${ua ? ', the batches letting go and coming back' : ''}`, page, async () => {
      const before = await page.evaluate(() => window.__batcher?.stats() ?? null);
      await page.keyboard.press('u');
      await page.waitForFunction(() => !!document.querySelector('#modal-root .backdrop'), null, { timeout: 15_000 }).catch(() => {
        throw new Error('U opened no builder');
      });
      await sleep(1500);
      const open = await page.evaluate(() => window.__batcher?.stats() ?? null);
      if (ua) expect(open && open.batches === 0, `still ${open?.batches} batches while the builder's open`);
      await closeWindows(page);
      if (!ua) return 'opened and closed';
      await batched(page);
      const after = await page.evaluate(() => window.__batcher.stats());
      expect(after.batches > 0 && after.resets > before.resets, `batches ${after.batches}, resets ${before.resets} → ${after.resets}`);
      return `${before.batches} batches, none while building, ${after.batches} after`;
    });

    // What the Quest page draws batched, against the same unbatched, by day and by night.
    if (ua) {
      for (const [when, hour] of [['day', 13], ['night', 22]]) {
        await check(`${which}: batched looks as unbatched, at the desks by ${when}`, page, async () => {
          const s = await near(page, 'desk', 1.4);
          const mid = await page.evaluate(() => {
            const r = window.__office.player.room;
            return [(r.minX + r.maxX) / 2, 1.4, (r.minZ + r.maxZ) / 2];
          });
          await page.evaluate((h) => window.__office.sky.show({ hour: h }), hour);
          await stand(page, s.stand, mid);
          await bare(page, true);
          await sleep(1500);
          const a = await page.screenshot();
          await page.evaluate(() => window.__flat.set('batching', false));
          await sleep(2500);
          const b = await page.screenshot();
          await page.evaluate(() => window.__flat.set('batching', true));
          await bare(page, false);
          writeFileSync(path.join(OUT, `check-${when}-batched.png`), a);
          writeFileSync(path.join(OUT, `check-${when}-unbatched.png`), b);
          const d = await differ(page, a, b);
          await batched(page);
          expect(d < 0.01, `${(d * 100).toFixed(2)}% of the pixels differ`);
          return `${(d * 100).toFixed(2)}% of the pixels differ (the ticker and anything else that moves between shots)`;
        });
      }
    }
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const office = await startBuilding({ building: BUILDING });
  const browser = await launch();
  try {
    await pageChecks(browser, office, 'laptop', undefined);
    await pageChecks(browser, office, 'quest page', QUEST2_UA);
  } finally {
    await browser.close();
    office.stop();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
