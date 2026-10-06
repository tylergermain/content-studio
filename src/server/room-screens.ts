import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { layoutFurniture } from '../shared/office-builder.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';

// What each project room's TV shows (the wall screen in the room, media '@room'): its app, as it is now. Every
// EVERY_MS, on each floor somebody's on, each room's app is photographed in a headless Chromium (as the design
// canvas exports are, see canvas/export.ts): the running web server of a worker in the room, else the room's own
// app address (ProjectLink.url). The pictures are kept in <floor>/.agent-office/room-screens, one a room, and
// served only to whoever's signed in (http/routes/room-screens.ts). Nothing runs until a TV first asks.

const EVERY_MS = 15_000;
const LOAD_MS = 10_000;
const VIEW = { width: 1280, height: 720 };
/** A browser nobody's used for this long is closed: it's started again next time. */
const IDLE_MS = 90_000;

export interface RoomShot {
  /** When it was taken. */
  at: number;
  /** What it's of: a worker's server's port, or the room's app address. */
  of: string;
}

const instances = new WeakMap<Ctx, RoomScreens>();
/** The office's room screens, started the first time a TV asks for them. */
export function roomScreensOf(ctx: Ctx): RoomScreens {
  let r = instances.get(ctx);
  if (!r) instances.set(ctx, (r = new RoomScreens(ctx)));
  return r;
}

/** The address a room's TV shows: the newest web server a worker in it runs, else the room's own app address. */
export function roomApp(ctx: Ctx, floor: Floor, room: string): string | undefined {
  const mine = ctx.services
    .list()
    .filter((s) => floor.workers.get(s.workerId)?.project?.room === room)
    .sort((a, b) => b.since - a.since);
  if (mine[0]) return `http://127.0.0.1:${mine[0].port}/`;
  const piece = layoutFurniture(floor.plan.state()).find((p) => p.id === room && p.kind === 'project-room');
  const url = piece?.project?.url;
  return url && /^https?:\/\//.test(url) ? url : undefined;
}

export class RoomScreens {
  private shots = new Map<string, RoomShot>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private browser: Browser | undefined;
  private usedAt = 0;
  private broken: string | undefined;

  constructor(private ctx: Ctx) {}

  private dir(floor: Floor) {
    return path.join(floor.dir, '.agent-office', 'room-screens');
  }

  /** The picture of `room` on `floor`, when there is one. */
  file(floor: Floor, room: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) return undefined;
    const file = path.join(this.dir(floor), `${room}.jpg`);
    try {
      return statSync(file).isFile() ? file : undefined;
    } catch {
      return undefined;
    }
  }

  /** What each room's TV on `floor` has to show, by room; it starts taking pictures, if it hadn't. */
  view(floor: Floor): { rooms: Record<string, RoomShot>; broken?: string } {
    this.start();
    const rooms: Record<string, RoomShot> = {};
    for (const [key, shot] of this.shots) if (key.startsWith(`${floor.id}:`)) rooms[key.slice(floor.id.length + 1)] = shot;
    return { rooms, ...(this.broken ? { broken: this.broken } : {}) };
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.round(), EVERY_MS);
    this.timer.unref();
    void this.round();
  }

  /** One picture of every room with an app, on every floor somebody's on. */
  private async round() {
    if (this.running) return;
    this.running = true;
    try {
      for (const floor of this.ctx.floors.values()) {
        if (!floor.info().people) continue;
        for (const p of layoutFurniture(floor.plan.state())) {
          if (p.kind !== 'project-room' || p.level) continue;
          const app = roomApp(this.ctx, floor, p.id);
          const key = `${floor.id}:${p.id}`;
          if (!app) {
            this.shots.delete(key);
            continue;
          }
          const ok = await this.shoot(app, floor, p.id);
          if (ok) this.shots.set(key, { at: Date.now(), of: app });
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

  private async shoot(url: string, floor: Floor, room: string): Promise<boolean> {
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
      const file = path.join(dir, `${room}.jpg`);
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
