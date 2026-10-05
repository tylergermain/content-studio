// Friday One, the helicopter (see protocol/heli.ts): one for the building, reached through heliOf(ctx),
// so the office's core knows nothing of it. Street admins fly it and up to three others ride along,
// getting in and out only while it's down, at one of its doors. The pilot's page flies it
// (shared/heli.ts) and says where it is; the office checks every pose against the same solids and
// ground, tells everyone else, and has the last word on setting down: never over anyone at street level
// on any floor, nor any floor's car. Where it was last parked is kept in the office's data folder's
// heli.json (store.ts); with none, it's on its pad in Friday Park. A pilot who goes mid-flight sends it
// flying itself home (home.ts), passengers and all; a trip home that gets nowhere ends with it set down
// where it is, if it may land there, or else back on its pad.
import { BODY, FLIGHT, HELI, bodyHit, doorDistance, groundUnder, heliFootprint, parkedHeli, tailOf } from '../../shared/heli.js';
import { heliSolids, heliTerrain, heliTerrainOver, onPad, whyNotLand } from '../../shared/heli-world.js';
import { overlaps } from '../../shared/garage.js';
import { roofDrop } from '../../shared/layout.js';
import type { Solid } from '../../shared/mainstreet.js';
import type { BusinessCard, HeliCrew, HeliPose, HeliState } from '../../shared/protocol.js';
import { TOWER } from '../../shared/tower.js';
import { throttle, type Client } from '../office/client.js';
import type { Ctx } from '../office/context.js';
import { isStreetAdmin } from '../street/admins.js';
import { streetPeople, streetSpot } from '../street/people.js';
import { streetOf } from '../street/registry.js';
import { STEP, cleanPose, stepWhy } from './checks.js';
import { homeStep, startTrip, type HomeWorld, type Trip } from './home.js';
import { HeliFile } from './store.js';

/** Friday One as the office keeps it. */
export interface Heli {
  /** Where it is, whether it's down, and who's aboard (FloorView.heli, and `heli`). */
  state(): HeliState;
  /** `c` gets in, at the controls or in a passenger's seat (heli.board). */
  board(c: Client, seat: unknown): void;
  /** `c` gets out (heli.leave). */
  leave(c: Client): void;
  /** The pilot's page says where it is now, and whether it's setting down there (heli.fly). */
  fly(c: Client, pose: unknown, landed: unknown): void;
  /** `c` went to another floor, or out of the office: out of it if it's down; a pilot leaving mid-flight sends it home, and a passenger is put off. */
  gone(c: Client): void;
}

export interface HeliOptions {
  /** The office's clock (ms). */
  now?: () => number;
  /** Whether it ticks along by itself to fly home and spin down (tests step it with `step`). */
  timers?: boolean;
  /** What's on Main Street: streetOf(ctx)'s cards, unless a test says otherwise. */
  cards?: () => readonly BusinessCard[];
}

/** How often it steps when it flies itself (ms); the pilot's poses taken at most this often (ms); getting in or out at most this often (ms). */
const TICK = 100;
const FLY_EVERY = 40;
const BOARD_EVERY = 250;
/** How far over the roof the mast's light is: the tower's top, for flying home over it. */
const MAST = 21.7;
/** How high over the ground the pilot's page may say it's down. */
const DOWN = 0.6;
/** How far past its tail's sides and end someone counts as under it. */
const UNDER_TAIL = 1;

/** What everyone's told while it hovers over someone, on its pad or a spot by it. */
const WAITING = { pad: '🚁 Friday One is waiting to land: please step off the pad', spot: '🚁 Friday One is waiting to land: please step out from under it' } as const;

export class Helicopter implements Heli {
  private heli: HeliState;
  private readonly file: HeliFile;
  private readonly clock: () => number;
  private readonly cards: () => readonly BusinessCard[];
  private readonly timers: boolean;
  /** When the pose it has now was taken (ms), and how many seconds of flying the pilot's page had left in hand then (see fly). */
  private lastAt = 0;
  private credit = 0;
  /** Its way home, while it's flying itself there. */
  private trip: Trip | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** heliSolids for the building and the street as they were last asked about. */
  private solids: { key: string; list: Solid[] } = { key: '', list: [] };

  constructor(
    private readonly ctx: Ctx,
    opts: HeliOptions = {},
  ) {
    this.clock = opts.now ?? Date.now;
    this.timers = opts.timers ?? true;
    this.cards = opts.cards ?? (() => streetOf(ctx).cards());
    this.file = new HeliFile(ctx.cfg.dataDir);
    this.heli = this.restore();
  }

  /** Where heli.json says it was parked, unless that's somewhere it can't be now (a plot claimed over it): then home on its pad. */
  private restore(): HeliState {
    const saved = this.file.load();
    if (!saved) return parkedHeli();
    const { pose } = saved;
    const world = this.world();
    if (world.whyNotLand(pose.x, pose.z, pose.yaw) || bodyHit(pose, world.solids)) return parkedHeli();
    pose.h = groundUnder(pose, world);
    return { pose, landed: true, stage: 'parked', pad: onPad(pose.x, pose.z) ? 'park' : null, crew: [] };
  }

  state(): HeliState {
    const s = this.heli;
    return { ...s, pose: { ...s.pose }, crew: s.crew.map((m) => ({ ...m })) };
  }

  private changed() {
    this.ctx.broadcast({ t: 'heli', heli: this.state() });
  }

  private pilot(): HeliCrew | undefined {
    return this.heli.crew.find((m) => m.seat === 'pilot');
  }

  /** What it flies in now: the building as tall as it is and the street as it is, the ground, and who's under where. */
  protected world(): HomeWorld {
    const cards = this.cards();
    const real = this.ctx.floors.size;
    const roofFloors = Math.max(TOWER.storeys, real);
    const key = `${roofFloors}:${real}:${JSON.stringify(cards)}`;
    if (key !== this.solids.key) this.solids = { key, list: heliSolids(roofFloors, cards, real) };
    return {
      solids: this.solids.list,
      terrain: heliTerrain,
      terrainOver: heliTerrainOver,
      whyNotLand: (x, z, yaw) => whyNotLand(x, z, yaw, cards),
      occupied: (x, z, yaw) => this.underneath(x, z, yaw) !== null,
      towerTop: roofDrop(roofFloors) + MAST,
    };
  }

  /**
   * Why it can't set down at (x, z) turned `yaw` for who and what's there: anyone at street level on
   * any floor (bar its own crew) within HELI.clear of its hub or under its tail, or any floor's car
   * under it. Null if there's nobody.
   */
  private underneath(x: number, z: number, yaw: number): string | null {
    const crew = this.heli.crew;
    const t = tailOf({ x, z, yaw }, { x: 0, z: 0, s: 0, c: 1 });
    const half = (BODY.tail.front - BODY.tail.back) / 2;
    for (const { c, at } of streetPeople(this.ctx)) {
      if (crew.some((m) => m.id === c.id)) continue;
      if (Math.hypot(at.x - x, at.z - z) < HELI.clear) return "Someone's underneath";
      // Under its tail: along it and across it, in its own frame.
      const dx = at.x - t.x;
      const dz = at.z - t.z;
      if (Math.abs(dx * t.c - dz * t.s) < BODY.tail.half + UNDER_TAIL && Math.abs(dx * t.s + dz * t.c) < half + UNDER_TAIL) return "Someone's underneath";
    }
    const foot = heliFootprint({ x, h: 0, z, yaw, pitch: 0, roll: 0, spin: 0 });
    for (const floor of this.ctx.floors.values()) for (const car of floor.garage.state()) if (overlaps(car, foot)) return "There's a car underneath";
    return null;
  }

  board(c: Client, seat: unknown): void {
    if (seat !== 'pilot' && seat !== 'passenger') return;
    if (!throttle(c, 'heli.board', BOARD_EVERY, this.clock())) return;
    const s = this.heli;
    const warn = (why: string) => this.ctx.warn(c, why);
    if (s.crew.some((m) => m.id === c.id)) return warn("🚁 You're already aboard");
    if (!s.landed) return warn("🚁 Wait till it's down");
    if (seat === 'pilot' && !isStreetAdmin(this.ctx, c)) return warn('🚁 Only street admins fly Friday One');
    if (seat === 'pilot' && this.pilot()) return warn("🚁 Someone's already at the controls");
    const at = streetSpot(this.ctx, c);
    if (!at || doorDistance(s.pose, at) > HELI.reach || Math.abs(at.h - s.pose.h) > 2) return warn('🚁 Walk up to one of its doors first');
    let place = 0;
    if (seat === 'passenger') {
      place = [1, 2, 3].find((p) => !s.crew.some((m) => m.place === p)) ?? 0;
      if (!place) return warn("🚁 It's full: three ride along at most");
    }
    s.crew.push({ id: c.id, name: c.peer.name, color: c.peer.color, seat, place, floor: c.peer.floor ?? null });
    if (seat === 'pilot') {
      s.stage = 'landed';
      this.lastAt = this.clock();
      this.credit = 0;
    }
    this.changed();
  }

  leave(c: Client): void {
    const s = this.heli;
    const i = s.crew.findIndex((m) => m.id === c.id);
    if (i < 0 || !throttle(c, 'heli.board', BOARD_EVERY, this.clock())) return;
    if (!s.landed) return this.ctx.warn(c, "🚁 Wait till it's down");
    const [m] = s.crew.splice(i, 1);
    if (m.seat === 'pilot') s.stage = 'parked';
    this.park();
    this.changed();
  }

  gone(c: Client): void {
    const s = this.heli;
    const i = s.crew.findIndex((m) => m.id === c.id);
    if (i < 0) return;
    const [m] = s.crew.splice(i, 1);
    if (m.seat === 'pilot') {
      if (s.landed) {
        s.stage = 'parked';
        this.park();
      } else this.goHome();
    }
    this.changed();
  }

  fly(c: Client, raw: unknown, rawLanded: unknown): void {
    const s = this.heli;
    if (this.pilot()?.id !== c.id || s.stage === 'home') return;
    const landed = rawLanded === true;
    // Setting down or taking off always goes through; a pose like the last, at most every FLY_EVERY ms.
    if (landed === s.landed && !throttle(c, 'heli.fly', FLY_EVERY, this.clock())) return;
    // Asked fresh: a pilot who's no longer a street admin hands it over to its autopilot.
    if (!isStreetAdmin(this.ctx, c)) return this.unseat(c);
    const now = this.clock();
    const pose = cleanPose(raw);
    if (typeof pose === 'string') return this.snap(c, pose);
    if (s.landed && landed) {
      // Still down: only its rotor has changed.
      s.pose.spin = pose.spin;
      this.ctx.broadcast({ t: 'heli.move', pose: s.pose, at: now }, c.id, true);
      return;
    }
    const world = this.world();
    // How far it could have flown since the pose before: the time since, on the office's clock, and
    // whatever the page had left in hand then, at most STEP.gap. Poses the network bunched up or the
    // throttle dropped leave some in hand, so the next one to come on time isn't too far for it.
    const hand = Math.min(STEP.gap, this.credit + (now - this.lastAt) / 1000);
    const why = stepWhy(s.pose, pose, hand, world);
    if (why) return this.snap(c, why);
    this.credit = hand - Math.hypot(pose.x - s.pose.x, pose.h - s.pose.h, pose.z - s.pose.z) / FLIGHT.maxSpeed;
    if (s.landed) {
      // Off the ground.
      Object.assign(s, { pose, landed: false, stage: 'flying', pad: null });
      this.lastAt = now;
      this.changed();
      return;
    }
    if (landed) return this.setDown(c, pose, world, now);
    s.pose = pose;
    this.lastAt = now;
    this.ctx.broadcast({ t: 'heli.move', pose, at: now }, c.id, true);
  }

  /** The pilot's page has it down at `pose`: down it is, unless it may not land there, or someone's underneath; then it holds 3 m up. */
  private setDown(c: Client, pose: HeliPose, world: HomeWorld, now: number) {
    const s = this.heli;
    const ground = groundUnder(pose, world);
    const why = pose.h - ground > DOWN ? "Can't land here" : (world.whyNotLand(pose.x, pose.z, pose.yaw) ?? this.underneath(pose.x, pose.z, pose.yaw));
    this.lastAt = now;
    if (why) {
      s.pose = { ...pose, h: Math.min(FLIGHT.ceiling, pose.h + 3) };
      this.ctx.sendTo(c, { t: 'heli.snap', pose: { ...s.pose }, landed: false, why });
      this.ctx.broadcast({ t: 'heli.move', pose: s.pose, at: now }, c.id, true);
      return;
    }
    s.pose = { ...pose, h: ground, pitch: 0, roll: 0 };
    s.landed = true;
    s.stage = 'landed';
    s.pad = onPad(pose.x, pose.z) ? 'park' : null;
    this.file.save({ pose: s.pose, pad: s.pad });
    this.changed();
  }

  /** Tells the pilot's page to go back to the last pose the office took, and why. */
  private snap(c: Client, why: string) {
    this.ctx.sendTo(c, { t: 'heli.snap', pose: { ...this.heli.pose }, landed: this.heli.landed, why });
  }

  /** A pilot who's no longer a street admin: a passenger from here (or off, if every seat's taken), and it flies itself home if it's up. */
  private unseat(c: Client) {
    const s = this.heli;
    const m = this.pilot()!;
    const place = [1, 2, 3].find((p) => !s.crew.some((o) => o.place === p));
    if (place) Object.assign(m, { seat: 'passenger', place });
    else s.crew.splice(s.crew.indexOf(m), 1);
    this.ctx.warn(c, s.landed ? '🚁 Only street admins fly Friday One' : '🚁 Only street admins fly Friday One: it’s flying itself home');
    if (s.landed) {
      s.stage = 'parked';
      this.park();
    } else this.goHome();
    this.changed();
  }

  /** Parked where it is: kept in heli.json, and its rotor spun down. */
  private park() {
    const s = this.heli;
    this.file.save({ pose: s.pose, pad: s.pad });
    this.ticking();
  }

  /** Its pilot's gone mid-flight: it flies itself home. */
  private goHome() {
    const s = this.heli;
    Object.assign(s, { stage: 'home', landed: false, pad: null });
    this.trip = startTrip(s.pose, this.world(), this.clock());
    this.ticking();
  }

  /**
   * Its trip home got nowhere (home.ts): down where it is, if it may land there with nothing in the way
   * below it and nobody under it; else back on its pad. Either way it's parked, kept in heli.json, and
   * its passengers get out (their pages put them by a door), as at the end of any trip home.
   */
  private giveUp(world: HomeWorld) {
    const p = this.heli.pose;
    const ground = groundUnder(p, world);
    const down: HeliPose = { ...p, h: ground, pitch: 0, roll: 0 };
    const here = !world.whyNotLand(p.x, p.z, p.yaw) && !world.occupied(p.x, p.z, p.yaw) && !bodyHit(down, world.solids, p.h - ground);
    console.warn(`agent-office: Friday One got nowhere flying itself home from (${p.x.toFixed(1)}, ${p.h.toFixed(1)}, ${p.z.toFixed(1)}), so it's ${here ? 'set down there' : 'back on its pad'}`);
    this.heli = here ? { pose: down, landed: true, stage: 'parked', pad: onPad(p.x, p.z) ? 'park' : null, crew: [] } : parkedHeli();
    this.trip = null;
    this.file.save({ pose: this.heli.pose, pad: this.heli.pad });
    this.changed();
  }

  private ticking() {
    if (!this.timers || this.timer) return;
    this.timer = setInterval(() => this.step(TICK / 1000), TICK);
    this.timer.unref();
  }

  /**
   * One step of its own flying, `dt` s: home, with everyone told where it is (and asked to step off
   * the pad, if they're on it), or given up on when it's getting nowhere; or, parked with nobody at the
   * controls, its rotor spinning down. Stops ticking when there's nothing to do.
   */
  step(dt: number): void {
    const s = this.heli;
    const now = this.clock();
    if (s.stage === 'home' && this.trip) {
      const world = this.world();
      const leg = homeStep(s.pose, this.trip, dt, now, world);
      if (leg === 'stuck') return this.giveUp(world);
      if (leg === 'waiting') this.ctx.toastAll(this.trip.to.pad ? WAITING.pad : WAITING.spot);
      if (leg !== 'landed') {
        this.ctx.broadcast({ t: 'heli.move', pose: s.pose, at: now }, undefined, true);
        return;
      }
      // Down: its passengers get out (their pages put them by a door), and it's parked there.
      Object.assign(s, { landed: true, stage: 'parked', pad: this.trip.to.pad ? 'park' : null, crew: [] });
      this.trip = null;
      this.file.save({ pose: s.pose, pad: s.pad });
      this.changed();
      return;
    }
    if (s.landed && !this.pilot() && s.pose.spin > 0) {
      s.pose.spin = Math.max(0, s.pose.spin - dt / FLIGHT.spoolDown);
      this.ctx.broadcast({ t: 'heli.move', pose: s.pose, at: now }, undefined, true);
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Each office's helicopter. */
const FLEET = new WeakMap<Ctx, Helicopter>();

/** The office's Friday One, made the first time it's asked for. */
export function heliOf(ctx: Ctx): Heli {
  let heli = FLEET.get(ctx);
  if (!heli) FLEET.set(ctx, (heli = new Helicopter(ctx)));
  return heli;
}

/** The office's Friday One if it's been made: nobody can be aboard one that hasn't. */
export const heliIfAny = (ctx: Ctx): Heli | undefined => FLEET.get(ctx);
