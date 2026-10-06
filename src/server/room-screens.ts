import { copyFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { layoutFurniture } from '../shared/office-builder.js';
import { isLocal, previewKey, type Deploy } from '../shared/table-info.js';
import { deploysOf, newestByBranch } from './deploys.js';
import type { Floor } from './floor.js';
import { branchAt } from './git-read.js';
import type { Ctx } from './office/context.js';

// What each project room's TV shows (the wall screen in the room, media '@room'), and its panel's pictures of each
// branch (server/table-info.ts), as they are now. Every EVERY_MS, on each floor somebody's on, a room's apps are
// photographed in a headless Chromium (as the design canvas exports are, see canvas/export.ts): first what's
// deployed (server/deploys.ts), the live site and each branch's newest ready preview, which are photographed once a
// minute; then what runs on this computer, an agent's web server on a branch with no preview, and the room's own app
// address there only when there's nothing else. The TV goes round what's deployed a round at a time (or what runs
// here, with nothing deployed), captioned. The pictures are kept in <floor>/.agent-office/room-screens, the TV's
// as <room>.jpg and each app's as <room>--<key>.jpg, and served only to whoever's signed in
// (http/routes/room-screens.ts). Nothing runs until a TV or a panel first asks.

const EVERY_MS = 15_000;
const LOAD_MS = 10_000;
const VIEW = { width: 1280, height: 720 };
/** A browser nobody's used for this long is closed: it's started again next time. */
const IDLE_MS = 90_000;
/** The most apps of one room photographed a round. */
const MAX_APPS = 6;
const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?(?:\/.*)?$/i;
/** How often a deployed site (which doesn't change till it's deployed again) is photographed again. */
const DEPLOYED_MS = 60_000;

export interface RoomShot {
  /** When it was taken. */
  at: number;
  /** What it's of: an address. */
  of: string;
  /** For the TV: the live site, a branch's preview, or something running on this computer (whose, and on what branch); and how many more there are. */
  kind?: 'live' | 'preview' | 'local';
  who?: string;
  branch?: string;
  also?: number;
  /** A preview behind Vercel's login: the picture is of that, so there's none (see server/deploys.ts, headersFor). */
  blocked?: true;
}

/** Something of a room's to photograph, and what it is. */
export interface ScreenApp {
  key: string;
  url: string;
  kind: 'live' | 'preview' | 'local';
  branch?: string;
  who?: string;
}

/**
 * What a room's screen has to go round, in order: the live site, each branch's newest ready preview, then
 * what runs on this computer on a branch with no preview, and the room's own address on this computer only
 * when there's nothing else. `deployed` is how many at the front are deployed (the TV goes round those).
 */
export function screenOrder(o: { live?: string; previews: Deploy[]; here: ScreenApp[]; url?: string }): { apps: ScreenApp[]; deployed: number } {
  const previews = [...newestByBranch(o.previews.filter((x) => x.state === 'ready')).values()].slice(0, 4);
  const deployed: ScreenApp[] = [
    ...(o.live ? [{ key: 'live', url: o.live, kind: 'live' as const }] : []),
    ...previews.map((p) => ({ key: previewKey(p.branch!), url: p.url, kind: 'preview' as const, branch: p.branch })),
  ];
  const here = o.here.filter((a) => !a.branch || !previews.some((p) => p.branch === a.branch));
  const apps = [...deployed, ...here, ...(!deployed.length && !here.length && o.url ? [{ key: 'url', url: o.url, kind: 'local' as const }] : [])];
  return { apps: apps.slice(0, MAX_APPS), deployed: Math.min(deployed.length, MAX_APPS) };
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
  /** How many rounds each TV has been round its apps. */
  private turns = new Map<string, number>();
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

  /** What a room has to photograph: what's deployed first, then what runs here (see the top). */
  private async screenApps(floor: Floor, room: string): Promise<{ apps: ScreenApp[]; deployed: number }> {
    const project = layoutFurniture(floor.plan.state()).find((p) => p.id === room && p.kind === 'project-room')?.project;
    const local = roomApps(this.ctx, floor, room);
    const d = project?.repo || project?.vercel ? await deploysOf(this.ctx.cfg.dataDir).of(project.repo, project.vercel, project.dir ?? this.ctx.cfg.dataDir).catch(() => undefined) : undefined;
    const live = d?.live ?? (project?.url && !isLocal(project.url) ? project.url : undefined);
    const here: ScreenApp[] = [];
    for (const a of local) {
      if (a.key === 'url') continue;
      const w = a.workerId ? floor.workers.get(a.workerId) : undefined;
      // The branch its folder is really on, which needn't be the one the office cut for it.
      const works = w?.worktree ? path.join(w.worktree.root ?? floor.dir, w.worktree.path) : w?.project?.dir;
      const branch = works ? await branchAt(works) : undefined;
      here.push({ key: a.key, url: a.url, kind: 'local', ...(branch ? { branch } : {}), ...(w ? { who: w.name } : {}) });
    }
    return screenOrder({ live, previews: d?.list ?? [], here, url: local.find((a) => a.key === 'url')?.url });
  }

  private async shootRoom(floor: Floor, room: string) {
    const { apps, deployed } = await this.screenApps(floor, room);
    const tv = `${floor.id}:${room}`;
    if (!apps.length) this.shots.delete(tv);
    const running = new Set(apps.map((a) => `${tv}--${a.key}`));
    for (const key of this.apps.keys()) if (key.startsWith(`${tv}--`) && !running.has(key)) this.apps.delete(key);
    for (const app of apps) {
      const name = `${room}--${app.key}`;
      const had = this.apps.get(`${floor.id}:${name}`);
      // A deployed site is the same till it's deployed again: once a minute is plenty.
      if (app.kind !== 'local' && had?.of === app.url && Date.now() - had.at < DEPLOYED_MS) continue;
      const shot = await this.shoot(app.url, floor, name);
      if (shot === 'failed') continue;
      this.apps.set(`${floor.id}:${name}`, { at: Date.now(), of: app.url, ...(shot === 'blocked' ? { blocked: true as const } : {}) });
    }
    // The TV: round what's deployed a round at a time (with nothing deployed, round what runs here).
    const turn = (this.turns.get(tv) ?? -1) + 1;
    this.turns.set(tv, turn);
    const ring = (deployed ? apps.slice(0, deployed) : apps).filter((a) => {
      const shot = this.apps.get(`${floor.id}:${room}--${a.key}`);
      return shot && !shot.blocked;
    });
    const on = ring[turn % Math.max(1, ring.length)];
    if (!on) return;
    const shots = this.dir(floor);
    try {
      copyFileSync(path.join(shots, `${room}--${on.key}.jpg`), path.join(shots, `${room}.jpg.tmp`));
      renameSync(path.join(shots, `${room}.jpg.tmp`), path.join(shots, `${room}.jpg`));
    } catch {
      return;
    }
    const at = this.apps.get(`${floor.id}:${room}--${on.key}`)?.at ?? Date.now();
    // A new picture for the TV every turn, even of a site it photographed a minute ago.
    this.shots.set(tv, { at: Math.max(at, (this.shots.get(tv)?.at ?? 0) + 1), of: on.url, kind: on.kind, ...(on.who ? { who: on.who } : {}), ...(on.branch ? { branch: on.branch } : {}), ...(apps.length > 1 ? { also: apps.length - 1 } : {}) });
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

  /** A picture of `url` as `name`: taken, failed, or `blocked` (a preview behind Vercel's login, whose picture isn't kept). */
  private async shoot(url: string, floor: Floor, name: string): Promise<'ok' | 'failed' | 'blocked'> {
    const browser = await this.launch();
    if (!browser) return 'failed';
    this.usedAt = Date.now();
    const headers = deploysOf(this.ctx.cfg.dataDir).headersFor(url);
    const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, acceptDownloads: false, extraHTTPHeaders: headers }).catch(() => undefined);
    if (!context) return 'failed';
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: LOAD_MS });
      // Sent to Vercel's login: the preview's protected, and the office has no way past it.
      if (/(^|\.)vercel\.com$/.test(new URL(page.url()).hostname)) return 'blocked';
      await page.waitForTimeout(800);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 72 });
      const dir = this.dir(floor);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${name}.jpg`);
      writeFileSync(`${file}.tmp`, jpg, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return 'ok';
    } catch {
      return 'failed';
    } finally {
      await context.close().catch(() => {});
    }
  }
}
