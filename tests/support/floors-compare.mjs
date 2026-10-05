// A laptop's office, before and after (docs/vr.md, "How hard it works the headset"): two builds of the
// client served side by side (this checkout's dist/public and --base's), each in a laptop's page, both
// stood at the same spots of every floor of --building at the same hour, and their screenshots compared
// pixel by pixel with nothing of the page over the scene. From the repo root, after `npm run build:client`:
//
//   node --import tsx tests/support/floors-compare.mjs --building <dir> --base <another build's dist/public>
//
// --spots picks where (`friday-labs:desks,content:desks,friday-labs:street,roof`; by default every floor's
// desks, lounge and street). Writes each pair and a picture of where they differ (red) to --out (VR_SHOTS, /tmp/vr-shots), and
// prints the share of pixels that differ by more than a little at each spot. What moves on its own (the
// ticker, a screen, the dog) differs between any two shots; the rest should not.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, closeWindows, launch, openOffice, sleep } from './vr-browser.mjs';
import { startBuilding } from './floors-perf.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BUILDING = arg('building', null);
const BASE = path.resolve(arg('base', ''));
const HERE = path.resolve(arg('public', path.join(ROOT, 'dist/public')));
const OUT = path.resolve(arg('out', process.env.VR_SHOTS ?? '/tmp/vr-shots'));
const PORT = Number(process.env.VR_PORT ?? 14721);
/** The spots to compare, as `<floor>:<spot>` or `roof` (every floor's desks, lounge and street by default, and not the roof). */
const SPOTS = arg('spots', null)?.split(',').map((s) => s.trim().replace(/\s*:\s*/, '-'));

const BARE = '.floors-bare #hud, .floors-bare #toasts, .floors-bare #hint, .floors-bare #crosshair, .floors-bare .toast, .floors-bare .lite-offer { visibility: hidden !important; }';

/** Where to stand on the floor a page is on, and what to look at: the desks and the lounge as floors-perf.mjs has them, and the street. */
function spotsOf(page) {
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
    const street = -3.6 - Math.max(0, o.store.floors.map((f) => f.id).indexOf(o.store.floor)) * 7.1;
    const spots = [];
    if (desks[0]) spots.push(['desks', out(desks[0], 1.4), [2 * mid[0] - desks[0][0], 1.4, 2 * mid[2] - desks[0][2]]]);
    if (juke) spots.push(['lounge', out(juke, 2.6), [juke[0], 1.2, juke[2]]]);
    spots.push(['street', [2, street, 33], [0, street + 4, 12]]);
    return spots;
  });
}

/** Both pages at `stand`, looking at `look`, at `hour`, a moment apart. */
async function pose(pages, stand, look, hour) {
  await Promise.all(
    pages.map((p) =>
      p.evaluate(([s, l, h]) => {
        const o = window.__office;
        if (o.player.seat) o.player.stand();
        o.player.pos.set(...s);
        o.player.vy = 0;
        o.player.camYaw = Math.atan2(-(l[0] - s[0]), -(l[2] - s[2]));
        o.player.lookPitch = Math.atan2(l[1] - (s[1] + 1.6), Math.hypot(l[0] - s[0], l[2] - s[2]));
        o.sky.show({ hour: h });
      }, [stand, look, hour]),
    ),
  );
  await sleep(3000);
}

/** How many of two screenshots' pixels differ by more than a little, and a picture of where (red). */
async function differ(page, a, b) {
  return page.evaluate(async ([x64, y64]) => {
    const img = async (s) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const [x, y] = await Promise.all([img(x64), img(y64)]);
    const c = new OffscreenCanvas(x.width, x.height);
    const g = c.getContext('2d');
    g.drawImage(x, 0, 0);
    const da = g.getImageData(0, 0, x.width, x.height).data;
    g.clearRect(0, 0, x.width, x.height);
    g.drawImage(y, 0, 0);
    const shown = g.getImageData(0, 0, x.width, x.height);
    const db = shown.data;
    let n = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > 24) {
        n++;
        db[i] = 255;
        db[i + 1] = 0;
        db[i + 2] = 0;
      } else {
        // The rest faded, to see where the red is.
        db[i] = 128 + db[i] / 2;
        db[i + 1] = 128 + db[i + 1] / 2;
        db[i + 2] = 128 + db[i + 2] / 2;
      }
    }
    g.putImageData(shown, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { share: n / (da.length / 4), diff: btoa(bin) };
  }, [a.toString('base64'), b.toString('base64')]);
}

async function main() {
  if (!BASE || BASE === path.resolve('')) throw new Error('--base: the other build\'s dist/public');
  mkdirSync(OUT, { recursive: true });
  const offices = [await startBuilding({ port: PORT, publicDir: HERE, building: BUILDING }), await startBuilding({ port: PORT + 1, publicDir: BASE, building: BUILDING })];
  const browser = await launch();
  const rows = [];
  try {
    const pages = [];
    for (const [i, o] of offices.entries()) {
      const { page } = await openOffice(browser, o.base, { vr: false, name: i ? 'Before' : 'After' });
      await page.addStyleTag({ content: BARE });
      await page.evaluate(() => document.documentElement.classList.add('floors-bare'));
      pages.push(page);
    }
    const floors = (offices[0].floors.length ? offices[0].floors : [null]).filter((f) => !SPOTS || !f || SPOTS.some((k) => k.startsWith(`${f}-`)));
    /** Both pages posed at a spot by day and by night, their screenshots compared. */
    const compare = async (name, spot, stand, look) => {
      for (const [when, hour] of [['day', 13], ['night', 22]]) {
        await pose(pages, stand, look, hour);
        const [after, before] = [await pages[0].screenshot(), await pages[1].screenshot()];
        const key = `${name}-${spot}-${when}`.replace(/^roof-roof/, 'roof');
        const d = await differ(pages[0], after, before);
        writeFileSync(path.join(OUT, `${key}-after.png`), after);
        writeFileSync(path.join(OUT, `${key}-before.png`), before);
        writeFileSync(path.join(OUT, `${key}-diff.png`), Buffer.from(d.diff, 'base64'));
        rows.push([key, d.share]);
        console.log(`${key}: ${(d.share * 100).toFixed(2)}% of the pixels differ`);
      }
    };
    for (const floor of floors) {
      if (floor) {
        for (const p of pages) await p.evaluate((f) => window.__office.switchFloor(f), floor);
        for (const p of pages) await p.waitForFunction((f) => window.__office.store.floor === f && window.__office.player.enabled, floor, { timeout: 60_000 });
        await sleep(2500);
        for (const p of pages) await closeWindows(p);
      }
      const name = floor ?? (await pages[0].evaluate(() => window.__office.store.floor));
      for (const [spot, stand, look] of await spotsOf(pages[0])) if (!SPOTS || SPOTS.includes(`${name}-${spot}`)) await compare(name, spot, stand, look);
    }
    // Up on the roof (the elevator, as anyone gets there), where floors-perf.mjs stands.
    if (SPOTS?.includes('roof')) {
      for (const p of pages) await p.evaluate(() => window.__office.ride('@roof'));
      for (const p of pages) await p.waitForFunction(() => window.__office.store.floor === '@roof' && window.__office.player.enabled, null, { timeout: 60_000 });
      await sleep(2500);
      const y = await pages[0].evaluate(() => window.__office.player.pos.y);
      await compare('roof', 'roof', [6, y, 6], [-3, y + 1.2, -11.3]);
    }
  } finally {
    await browser.close();
    for (const o of offices) o.stop();
  }
  writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(Object.fromEntries(rows), null, 2));
  console.log(`\nWritten to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
