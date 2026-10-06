import { copyFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { layoutFurniture } from '../shared/office-builder.js';
import type { Floor } from './floor.js';
import { branchAt } from './git-read.js';
import type { Ctx } from './office/context.js';

// What each project room's TV shows (the wall screen in the room, media '@room'), and its panel's pictures of what's
// running on each branch (server/table-info.ts): its apps, as they are now. Every EVERY_MS, on each floor somebody's
// on, each of a room's apps is photographed in a headless Chromium (as the design canvas exports are, see
// canvas/export.ts): each running web server of a worker in the room, newest first, then the room's own app address
// (ProjectLink.url). The TV shows the first. The pictures are kept in <floor>/.agent-office/room-screens, the TV's as
// <room>.jpg and each app's as <room>--<key>.jpg, and served only to whoever's signed in
// (http/routes/room-screens.ts). Nothing runs until a TV or a panel first asks.

const EVERY_MS = 15_000;
const LOAD_MS = 10_000;
const VIEW = { width: 1280, height: 720 };
/** A browser nobody's used for this long is closed: it's started again next time. */
const IDLE_MS = 90_000;
/** The most apps of one room photographed a round. */
const MAX_APPS = 6;
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?(?:\/.*)?$/i;

export interface RoomShot {
  /** When it was taken. */
  at: number;
  /** What it's of: a worker's server's port, or the room's app address. */
  of: string;
  /** For the TV: whose server it is and the branch they're on (none for the room's app address), and how many more apps the room has running. */
  who?: string;
  branch?: string;
  also?: number;
}

/** Something running in a room to photograph: a worker's web server (key p<port>), or the room's app address (key url). */
export interface RoomApp {
  key: string;
  url: string;
  port?: number;
  workerId?: string;
}

const instances = new WeakMap<Ctx, RoomScreens>();
/** The office's room screens, started the first time a TV asks for them. */
export function roomScreensOf(ctx: Ctx): RoomScreens {
  let r = instances.get(ctx);
  if (!r) instances.set(ctx, (r = new RoomScreens(ctx)));
  return r;
}

/** What's running in a room: each web server a worker in it runs, newest first, then the room's own app address. */
export function roomApps(ctx: Ctx, floor: Floor, room: string): RoomApp[] {
  const out: RoomApp[] = ctx.services
    .list()
    .filter((s) => floor.workers.get(s.workerId)?.project?.room === room)
    .sort((a, b) => b.since - a.since)
    .map((s) => ({ key: `p${s.port}`, url: `http://127.0.0.1:${s.port}/`, port: s.port, workerId: s.workerId }));
  const piece = layoutFurniture(floor.plan.state()).find((p) => p.id === room && p.kind === 'project-room');
  const url = piece?.project?.url;
  const port = url ? Number(LOCAL.exec(url)?.[1] ?? NaN) : NaN;
  if (url && /^https?:\/\//.test(url) && !out.some((a) => a.port === port)) out.push({ key: 'url', url });
  return out;
}

/** The address a room's TV shows: the newest web server a worker in it runs, else the room's own app address. */
export function roomApp(ctx: Ctx, floor: Floor, room: string): string | undefined {
  return roomApps(ctx, floor, room)[0]?.url;
}

export class RoomScreens {
  /** The TVs' pictures, by floor:room, and each app's, by floor:room--key. */
  private shots = new Map<string, RoomShot>();
  private apps = new Map<string, RoomShot>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private browser: Browser | undefined;
  private usedAt = 0;
  private broken: string | undefined;

  constructor(private ctx: Ctx) {}

  private dir(floor: Floor) {
    return path.join(floor.dir, '.agent-office', 'room-screens');
  }

  /** The picture `name` on `floor`: a room's TV's (its id), or one of its apps' (<room>--<key>), when there is one. */
  file(floor: Floor, name: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(name)) return undefined;
    const file = path.join(this.dir(floor), `${name}.jpg`);
    try {
      return statSync(file).isFile() ? file : undefined;
    } catch {
      return undefined;
    }
  }

  /** What each room's TV on `floor` has to show, by room, and each of its apps, by <room>--<key>; it starts taking pictures, if it hadn't. */
  view(floor: Floor): { rooms: Record<string, RoomShot>; apps: Record<string, RoomShot>; broken?: string } {
    this.start();
    const mine = (shots: Map<string, RoomShot>) => {
      const out: Record<string, RoomShot> = {};
      for (const [key, shot] of shots) if (key.startsWith(`${floor.id}:`)) out[key.slice(floor.id.length + 1)] = shot;
      return out;
    };
    return { rooms: mine(this.shots), apps: mine(this.apps), ...(this.broken ? { broken: this.broken } : {}) };
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.round(), EVERY_MS);
    this.timer.unref();
    void this.round();
  }

  /** A picture of each app of every room, on every floor somebody's on; the first of a room's is its TV's. */
  private async round() {
    if (this.running) return;
    this.running = true;
    try {
      for (const floor of this.ctx.floors.values()) {
        if (!floor.info().people) continue;
        for (const p of layoutFurniture(floor.plan.state())) {
          if (p.kind !== 'project-room' || p.level) continue;
          await this.shootRoom(floor, p.id);
        }
      }
      if (this.browser && Date.now() - this.usedAt > IDLE_MS) {
        const b = this.browser;
        this.browser = undefined;
        await b.close().catch(() => {});
      }
    } finally {
      this.running = false;
    }
  }

  private async shootRoom(floor: Floor, room: string) {
    const apps = roomApps(this.ctx, floor, room).slice(0, MAX_APPS);
    const tv = `${floor.id}:${room}`;
    if (!apps.length) this.shots.delete(tv);
    const running = new Set(apps.map((a) => `${tv}--${a.key}`));
    for (const key of this.apps.keys()) if (key.startsWith(`${tv}--`) && !running.has(key)) this.apps.delete(key);
    for (const [i, app] of apps.entries()) {
      const name = `${room}--${app.key}`;
      if (!(await this.shoot(app.url, floor, name))) continue;
      const at = Date.now();
      this.apps.set(`${floor.id}:${name}`, { at, of: app.url });
      if (i > 0) continue;
      // The TV's is the first's.
      const shots = this.dir(floor);
      try {
        copyFileSync(path.join(shots, `${name}.jpg`), path.join(shots, `${room}.jpg.tmp`));
        renameSync(path.join(shots, `${room}.jpg.tmp`), path.join(shots, `${room}.jpg`));
      } catch {
        continue;
      }
      const worker = app.workerId ? floor.workers.get(app.workerId) : undefined;
      // The branch its folder is really on, which needn't be the one the office cut for it.
      const works = worker?.worktree ? path.join(worker.worktree.root ?? floor.dir, worker.worktree.path) : worker?.project?.dir;
      const branch = works ? await branchAt(works) : undefined;
      this.shots.set(tv, { at, of: app.url, ...(worker ? { who: worker.name } : {}), ...(branch ? { branch } : {}), ...(apps.length > 1 ? { also: apps.length - 1 } : {}) });
    }
  }

  private async launch(): Promise<Browser | undefined> {
    if (this.browser?.isConnected()) return this.browser;
    try {
      const { chromium } = await import('playwright-core');
      this.browser = await chromium.launch({ headless: true, ...(process.env.AGENT_OFFICE_CHROME ? { executablePath: process.env.AGENT_OFFICE_CHROME } : {}) });
      this.broken = undefined;
      return this.browser;
    } catch (e) {
      this.broken = `The rooms' TVs need a headless Chromium: run npx playwright install chromium on the office's computer (${e instanceof Error ? e.message.split('\n')[0] : 'it would not start'})`;
      return undefined;
    }
  }

  private async shoot(url: string, floor: Floor, name: string): Promise<boolean> {
    const browser = await this.launch();
    if (!browser) return false;
    this.usedAt = Date.now();
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, acceptDownloads: false }).catch(() => undefined);
    if (!context) return false;
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: LOAD_MS });
      await page.waitForTimeout(800);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 72 });
      const dir = this.dir(floor);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${name}.jpg`);
      writeFileSync(`${file}.tmp`, jpg, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return true;
    } catch {
      return false;
    } finally {
      await context.close().catch(() => {});
    }
  }
}
