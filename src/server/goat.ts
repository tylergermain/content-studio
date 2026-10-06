import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { seatingOf } from '../shared/table-seats.js';
import path from 'node:path';
import { dogAt, legSeconds, type DogState } from '../shared/dog.js';
import type { RoomOptions } from '../shared/floorplan.js';
import type { Piece } from '../shared/furniture.js';
import { ELEVATOR, ELEVATOR_CAR, ELEVATOR_FRONT, builtDesks } from '../shared/layout.js';
import { officeNav, type NavGrid, type Pt } from '../shared/nav.js';
import { layoutDesks, type DeskLayout } from '../shared/office-builder.js';
import { GOAT_BUTT, GOAT_DASH, GOAT_PET_MS, type GoatAct, type GoatState, type PeerInfo, type ServerMsg } from '../shared/protocol.js';
import { APART, ambleWay, asideFrom, bagsOf, buttAt, choose, dist, dogMeets, followSpot, goatNav, grazeAt, homeFloor, nibbleAt, plantsOf, rugsOf, staysPut, toward, walkAt, walkEnd, wayTo, type Errand, type GoatPlan } from './goat-plan.js';

// ---- His day ----------------------------------------------------------------------------------------

/** Meters a second: ambling about, tagging along after someone, catching them up, and stepping out of the dog's way. */
const AMBLE = 0.9;
const TAG_ALONG = 1.5;
const CATCH_UP = 2.6;
const SIDESTEP = 2.2;
/** With the dog on the move this near and getting nearer, he stops on his way to let it by. */
const NEAR = 1.4;
/** How near someone has to be for him to stop and look at them. */
const LOOK_REACH = 7;
/** How long he follows whoever petted him: about a minute. */
const FOLLOW_MS = [55_000, 70_000] as const;

/** In front of the elevator's doors, inside its car, and out past the floor the doors are kept clear by. */
const DOORSTEP: Pt = [ELEVATOR.x, ELEVATOR_FRONT + 0.7];
const CAR: Pt = [ELEVATOR.x, (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2];
const OUT_OF_CAR: Pt = [ELEVATOR.x, ELEVATOR_FRONT + 1.8];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
function shuffled<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/** On the office floor itself: not up in the loft, down in the garage, or on the 2D view (in the office, but standing nowhere in it). */
const onFloor = (p: PeerInfo) => !p.lite && Math.abs(p.y) < 1;

/** What Marc needs of the floor he's on. */
export interface GoatEnv {
  /** Everyone on this floor, where they stand now. */
  people(): PeerInfo[];
  /** To everyone on this floor: what he's up to now, or null once he has left it. */
  send(goat: GoatState | null): void;
  /** How many rows the floor's back office is built out. */
  wing(): number;
  /** How the floor's arranged and the room it's in: `revision` changes whenever either does. */
  layout(): { desks: DeskLayout; furniture: readonly Piece[]; room?: RoomOptions; revision: number };
  /** The floor's dog, as it is now: they keep out of each other's way, which is Marc's to see to. */
  dog(): DogState | undefined;
}

/** What Marc needs of the building: where the elevator took whoever he's following. */
export interface GoatRides {
  /** The floor `personId` is on now, when it's another one of the building's. */
  whereIs(personId: string): GoatEnv | undefined;
  /** He lives on `env`'s floor from now on. */
  moved(env: GoatEnv): void;
}

type Leg = Omit<GoatState, 'elapsed' | 'pets'> & { start: number };
/** Who he's tagging along after, until when, and whether they may lead him onto another floor. */
type Following = { id: string; until: number; lead: boolean };
type Extra = Pick<GoatState, 'face' | 'watching' | 'following' | 'petBy' | 'piece' | 'riding'>;

/**
 * Marc, the office goat. He ambles round the floor he lives on, grazes on its plants, nibbles a rug's
 * corner, butts the punching bag where there is one, stops to look at whoever's about, lies down for a
 * rest and now and then gets the zoomies. A pat makes him bleat and wag (the browsers do that; see
 * client/features/goat), and for about a minute after he follows whoever gave it, at a polite distance:
 * into the elevator too, to live on whichever floor they got out at. He keeps out of doorways and off
 * the stairs, and out of the dog's way. What he decides is here; where to, in goat-plan.ts.
 */
export class Goat {
  private leg: Leg;
  /** What he last set about, so he doesn't keep at the one thing. */
  private was?: GoatPlan;
  private timer?: NodeJS.Timeout;
  /** Looks out for the dog several times a second (see mind). */
  private readonly watch: NodeJS.Timeout;
  private follow?: Following;
  private pets = 0;
  private lastPet = 0;
  /** In the middle of a pat, which nothing but another pat cuts short. */
  private petting = false;
  /** How far off the dog was when he last looked (see mind), and until when he's stepping out of its way. */
  private gap = Infinity;
  private dodging = 0;
  private stopped = false;
  private navKey = '';
  private base?: NavGrid;

  constructor(
    private env: GoatEnv,
    private rides: GoatRides,
  ) {
    // Standing about somewhere on the floor when the office opens, and off on his day a few seconds later.
    const nav = this.nav();
    const way = ambleWay(nav, OUT_OF_CAR, Math.random, 3);
    const at = way ? way[way.length - 1] : nav.nearestWalkable(OUT_OF_CAR);
    this.leg = { path: [at], speed: 0, act: 'stand', face: rand(-Math.PI, Math.PI), start: Date.now() - 60_000 };
    this.wake(rand(2000, 6000));
    this.watch = setInterval(() => this.mind(), 150);
    this.watch.unref();
  }

  view(): GoatState {
    const { start, ...leg } = this.leg;
    return { ...leg, elapsed: Date.now() - start, pets: this.pets };
  }

  /** Where he is right now. */
  here(): Pt {
    return walkAt(this.leg, (Date.now() - this.leg.start) / 1000);
  }

  /**
   * Someone on his floor gave him a pat: he stops, turns to them and wags for everyone to see, then tags
   * along with them. `lead`: they may take him to another floor (see ride), which only an admin may:
   * where he lives is the building's, for everyone.
   */
  pet(by: PeerInfo, lead = false): boolean {
    if (this.stopped || this.leg.riding || !onFloor(by)) return false;
    const now = Date.now();
    if (now - this.lastPet < 400) return false;
    const at = this.here();
    if (Math.hypot(by.x - at[0], by.z - at[1]) > 3.5) return false;
    this.lastPet = now;
    this.pets++;
    this.petting = true;
    this.follow = undefined;
    this.go([at], 0, 'pet', { face: toward(at, [by.x, by.z]), petBy: by.name, watching: by.id });
    this.wake(GOAT_PET_MS, () => {
      this.petting = false;
      this.was = undefined;
      this.follow = { id: by.id, until: Date.now() + rand(...FOLLOW_MS), lead };
      this.followStep();
    });
    return true;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.watch);
  }

  private wake(ms: number, fn: () => void = () => this.think()) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(fn, ms);
    this.timer.unref();
  }

  /** Starts a leg from where he is now, and tells the floor. Says how long the walk takes, in ms. */
  private go(pathPts: Pt[], speed: number, act: GoatAct, extra: Extra = {}): number {
    this.leg = { path: pathPts, speed, act, ...extra, start: Date.now() };
    this.env.send(this.view());
    return legSeconds(this.leg) * 1000;
  }

  /**
   * The floor's grid as he has it now (see goatNav): round the furniture as it's arranged, in the room
   * it has, out of the doorways, and round wherever the dog is settled or headed.
   */
  private nav(): NavGrid {
    const layout = this.env.layout();
    const wing = this.env.wing();
    const key = `${wing}:${layout.revision}`;
    if (key !== this.navKey || !this.base) {
      this.navKey = key;
      this.base = officeNav(wing, seatingOf(layout).only ? [] : [...layoutDesks(layout.desks), ...builtDesks(wing).filter((d) => d.wing)], layout.furniture, layout.room);
    }
    const dog = this.env.dog();
    return goatNav(this.base, layout.room, dog ? [walkEnd(dog)] : []);
  }

  /** The nearest of the people on the floor within `reach` of `at`. */
  private nearest(at: Pt, reach: number): PeerInfo | undefined {
    let best: PeerInfo | undefined;
    let bestD = reach;
    for (const p of this.env.people()) {
      const d = Math.hypot(p.x - at[0], p.z - at[1]);
      if (onFloor(p) && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Picks what to do next (see choose), and ambles when there's no way to it. */
  private think() {
    if (this.stopped) return;
    this.petting = false;
    this.follow = undefined;
    const { furniture } = this.env.layout();
    const wing = this.env.wing();
    const at = this.here();
    const nav = this.nav();
    const plants = plantsOf(furniture, wing);
    const rugs = rugsOf(furniture, wing);
    const bags = bagsOf(furniture, wing);
    const near = this.nearest(at, LOOK_REACH);
    const plan = choose(this.was, { plants: plants.length > 0, people: !!near, rugs: rugs.length > 0, bags: bags.length > 0 }, Math.random());
    this.was = plan;
    const nearby = (pieces: Piece[]) => shuffled([...pieces].sort((a, b) => dist([a.x, a.z], at) - dist([b.x, b.z], at)).slice(0, 4));
    const done =
      plan === 'graze'
        ? this.errand(nearby(plants).map((p) => grazeAt(nav, p, at)), 'graze', rand(5000, 9000))
        : plan === 'nibble'
          ? this.errand(nearby(rugs).map((p) => nibbleAt(nav, p, at)), 'nibble', rand(4000, 7000))
          : plan === 'butt'
            ? this.errand(nearby(bags).map((p) => buttAt(nav, p, at)), 'butt', (GOAT_BUTT.first + GOAT_BUTT.every * GOAT_BUTT.times) * 1000)
            : plan === 'look'
              ? this.lookAt(at, near)
              : plan === 'zoom'
                ? this.zoom(nav, at)
                : plan === 'lie'
                  ? this.lieDown(nav, at)
                  : false;
    if (!done) this.amble(nav, at);
  }

  /** Sets off on the first of `found` there is, to do `act` there for `ms`. */
  private errand(found: (Errand | undefined)[], act: GoatAct, ms: number): boolean {
    const e = found.find((f) => f);
    if (!e) return false;
    this.wake(this.go(e.path, AMBLE, act, { face: e.face, piece: e.piece }) + ms);
    return true;
  }

  private amble(nav: NavGrid, at: Pt) {
    const way = ambleWay(nav, at, Math.random);
    this.wake(this.go(way ?? [at], way ? AMBLE : 0, 'stand') + rand(2500, 6000));
  }

  /** Stands and looks at whoever's nearest. */
  private lookAt(at: Pt, p: PeerInfo | undefined): boolean {
    if (!p) return false;
    this.go([at], 0, 'look', { face: toward(at, [p.x, p.z]), watching: p.id });
    this.wake(rand(3000, 6000));
    return true;
  }

  /** The zoomies: a dash to one spot and on to another, hopping as he goes (the browsers do the hop). */
  private zoom(nav: NavGrid, at: Pt): boolean {
    const first = ambleWay(nav, at, Math.random, 3);
    if (!first) return false;
    const second = ambleWay(nav, first[first.length - 1], Math.random, 3);
    this.wake(this.go(second ? [...first, ...second.slice(1)] : first, GOAT_DASH, 'zoom') + rand(1500, 2500));
    return true;
  }

  private lieDown(nav: NavGrid, at: Pt): boolean {
    const way = ambleWay(nav, at, Math.random, 2);
    if (!way) return false;
    this.wake(this.go(way, AMBLE, 'lie', { face: rand(-Math.PI, Math.PI) }) + rand(20_000, 40_000));
    return true;
  }

  /** After the dog has gone by: back to whoever he was following, or on with his day. */
  private resume() {
    if (this.follow) this.followStep();
    else this.think();
  }

  /** Every second or so: keeps up with whoever he's following, a polite distance behind, and stands looking at them when they stop. */
  private followStep() {
    if (this.stopped) return;
    const f = this.follow;
    if (!f || Date.now() > f.until) return this.think();
    const p = this.env.people().find((q) => q.id === f.id);
    if (!p) {
      // They took the elevator. To another floor, he comes along with someone who may lead him there, and
      // sees anyone else off at the doors; up to the roof, or out of the office, he lets them go.
      const there = this.rides.whereIs(f.id);
      if (!there) return this.think();
      return f.lead ? this.ride(there, f) : this.seeOff();
    }
    // Up the stairs, or down to the garage: he doesn't do stairs.
    if (!onFloor(p)) return this.think();
    const nav = this.nav();
    const at = this.here();
    const person: Pt = [p.x, p.z];
    const dog = this.env.dog();
    const spot = followSpot(nav, p, dog && walkEnd(dog));
    const along = this.leg.following === p.id;
    const watching = { following: p.id, watching: p.id };
    // Fine where he is (beside whoever just petted him, say), or with nowhere nearer to go (they're behind a door he keeps out of): he waits there, watching them.
    const way = staysPut(walkEnd(this.leg), p, spot) || dist(at, spot) < 0.7 ? undefined : wayTo(nav, at, spot);
    if (way) this.go(way, dist(at, spot) > 4 ? CATCH_UP : TAG_ALONG, 'look', { face: toward(spot, person), ...watching });
    else if (!along || (this.leg.speed > 0 && !staysPut(walkEnd(this.leg), p, spot))) this.go([at], 0, 'look', { face: toward(at, person), ...watching });
    this.wake(900, () => this.followStep());
  }

  /**
   * Into the elevator after whoever he's following, and out of it on the floor they went to, where he
   * lives from then on. The floor he left sees him walk in and the doors have him; the one he arrives
   * on sees him walk out.
   */
  private ride(there: GoatEnv, f: Following) {
    const at = this.here();
    const way = wayTo(this.nav(), at, DOORSTEP) ?? [at];
    // The grid keeps him off the doors' floor, so the last of it is straight in from the doorstep.
    const ms = this.go([...way, DOORSTEP, CAR], CATCH_UP, 'stand', { face: 0, following: f.id, riding: true });
    this.wake(ms + 900, () => {
      this.env.send(null);
      this.env = there;
      this.navKey = '';
      this.rides.moved(there);
      // A little longer with them, for coming all this way.
      f.until = Math.max(f.until, Date.now() + 20_000);
      this.wake(this.go([CAR, DOORSTEP, OUT_OF_CAR], TAG_ALONG, 'look', { face: 0, following: f.id, watching: f.id }), () => this.followStep());
    });
  }

  /** Up to the elevator they left by, to stand a moment looking at its doors. */
  private seeOff() {
    this.follow = undefined;
    const at = this.here();
    const way = wayTo(this.nav(), at, OUT_OF_CAR) ?? [at];
    this.wake(this.go(way, TAG_ALONG, 'look', { face: Math.PI }) + rand(3000, 5000));
  }

  /**
   * He and the dog don't walk through each other, and the dog doesn't know he's there, so it's his to
   * see to: on his way somewhere he stops to let it by, and where he's standing (or lying, or grazing)
   * in its way he steps aside. Nobody about, there's nobody to see it, and he saves himself the trouble.
   */
  private mind() {
    if (this.stopped || this.leg.riding) return;
    const dog = this.env.dog();
    if (!dog || !this.env.people().length) return;
    const now = Date.now();
    // Already getting out of its way.
    if (now < this.dodging) return;
    const gt = (now - this.leg.start) / 1000;
    const dt = dog.elapsed / 1000;
    const g = dogAt(this.leg, gt);
    const d = dogAt(dog, dt);
    const at: Pt = [g.x, g.z];
    const dogNow: Pt = [d.x, d.z];
    // The dog changes its mind as it goes (it follows people too), so besides where its walk would take
    // it, it counts that it's near and getting nearer.
    const gap = dist(at, dogNow);
    const nearing = d.moving && gap < this.gap - 0.01;
    this.gap = gap;
    const following = this.leg.following;
    if (g.moving) {
      if (dogMeets(this.leg, gt, dog, dt, 1.2, true) === undefined && !(nearing && gap < NEAR)) return;
      this.go([at], 0, 'stand', { face: toward(at, dogNow), following });
      this.wake(rand(900, 1500), () => this.resume());
      return;
    }
    if (dogMeets(this.leg, gt, dog, dt, 1.2) === undefined && !(nearing && gap < APART + 0.15)) return;
    const aside = asideFrom(this.nav(), at, dog, dt, 2.4);
    if (!aside) return;
    // A pat goes on while he shuffles over, and ends when it would have.
    const ms = this.go([at, aside], SIDESTEP, this.petting ? 'pet' : 'stand', { face: toward(aside, dogNow), following, ...(this.petting ? { petBy: this.leg.petBy, watching: this.leg.watching } : {}) });
    this.dodging = now + ms;
    if (!this.petting) this.wake(ms + rand(900, 1600), () => this.resume());
  }
}

// ---- The building's one goat -------------------------------------------------------------------------

/** Where he's remembered: in the bottom floor's .agent-office, beside its dog's name. */
const FILE = 'goat.json';

/**
 * Marc and the floors he could be on. The building has the one goat: he lives on its bottom floor
 * (the first there is) until he follows someone into the elevator, and from then on wherever he got
 * out, which goat.json in the bottom floor's .agent-office remembers across restarts. A floor taken
 * off the building with him on it sends him back to the bottom one.
 */
class Herd implements GoatRides {
  /** `open`: whether the building has a floor by that id (one that didn't open isn't one he lives on). */
  constructor(private open: (floorId: string) => boolean) {}

  private readonly homes = new Map<string, GoatHome>();
  private goat?: Goat;
  /** The floor he's on. */
  private on?: string;
  private settling?: NodeJS.Timeout;

  join(home: GoatHome) {
    this.homes.set(home.floorId, home);
    this.settleSoon();
  }

  leave(home: GoatHome) {
    if (this.homes.get(home.floorId) !== home) return;
    this.homes.delete(home.floorId);
    if (this.on === home.floorId) {
      this.goat?.stop();
      this.goat = undefined;
      this.on = undefined;
      this.settleSoon();
    }
    if (!this.homes.size) {
      clearTimeout(this.settling);
      this.settling = undefined;
    }
  }

  /** Marc as he is now, if he's on `floorId`. He's moved in first, if he hasn't been yet. */
  viewOn(floorId: string): GoatState | null {
    this.settle();
    return this.on === floorId ? (this.goat?.view() ?? null) : null;
  }

  petOn(floorId: string, by: PeerInfo, lead: boolean): boolean {
    return this.on === floorId && by.floor === floorId && !!this.goat?.pet(by, lead);
  }

  whereIs(personId: string): GoatEnv | undefined {
    for (const h of this.homes.values()) if (h.floorId !== this.on && h.env.people().some((p) => p.id === personId)) return h.env;
    return undefined;
  }

  moved(env: GoatEnv) {
    const home = [...this.homes.values()].find((h) => h.env === env);
    if (!home) return;
    this.on = home.floorId;
    const file = this.file();
    if (!file) return;
    try {
      writeFileSync(file, JSON.stringify({ floor: home.floorId }, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save which floor the goat lives on: ${(err as Error).message}`);
    }
  }

  /** Once every floor that's opening has: the floors open one after another, and he may live on a later one. */
  private settleSoon() {
    if (this.goat || this.settling) return;
    this.settling = setTimeout(() => this.settle(), 0);
    this.settling.unref();
  }

  /** Moves him in on the floor he lives on (see homeFloor), where everyone there sees him turn up. */
  private settle() {
    clearTimeout(this.settling);
    this.settling = undefined;
    if (this.goat) return;
    const on = homeFloor([...this.homes.keys()].filter(this.open), this.saved());
    const home = on === undefined ? undefined : this.homes.get(on);
    if (!home) return;
    this.on = on;
    this.goat = new Goat(home.env, this);
    home.env.send(this.goat.view());
  }

  private file(): string | undefined {
    const first = this.homes.values().next().value;
    return first && path.join(first.dataDir, FILE);
  }

  private saved(): string | undefined {
    const file = this.file();
    if (!file || !existsSync(file)) return undefined;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { floor?: unknown };
      return typeof saved.floor === 'string' ? saved.floor : undefined;
    } catch {
      return undefined;
    }
  }
}

/** A floor's side of the goat: Marc while he's on it, nobody while he's on another. */
export class GoatHome {
  constructor(
    readonly floorId: string,
    /** The floor's .agent-office. */
    readonly dataDir: string,
    readonly env: GoatEnv,
    private herd: Herd,
  ) {
    herd.join(this);
  }

  /** What he's up to, for whoever arrives on this floor; null when he isn't on it. */
  view(): GoatState | null {
    return this.herd.viewOn(this.floorId);
  }

  /** Someone on this floor gave him a pat (see Goat.pet); `lead`, when they're an admin, who he follows onto other floors. */
  pet(by: PeerInfo, lead = false): boolean {
    return this.herd.petOn(this.floorId, by, lead);
  }

  /** The floor is closing: with him on it, he goes back to the building's bottom floor. */
  stop() {
    this.herd.leave(this);
  }
}

/** What a floor is to its goat. */
export interface GoatFloor {
  readonly id: string;
  readonly dog: { view(): DogState };
  readonly plan: { readonly wing: number; layoutNow(): ReturnType<GoatEnv['layout']> };
}

/** What the building is: who's on each floor, and a way to tell them (see FloorContext). */
export interface GoatBuilding<F> {
  peers(floor: F): PeerInfo[];
  emit(floor: F, msg: ServerMsg): void;
  /** The floor by that id, once it has opened. */
  floor?(id: string): unknown;
}

/** Each building's herd of one. */
const HERDS = new WeakMap<object, Herd>();

/** `floor`'s side of its building's goat, which `Floor` makes with the rest of what it keeps. */
export function goatHome<F extends GoatFloor>(floor: F, building: GoatBuilding<F>, dataDir: string): GoatHome {
  let herd = HERDS.get(building);
  if (!herd) HERDS.set(building, (herd = new Herd((id) => !building.floor || !!building.floor(id))));
  const env: GoatEnv = {
    people: () => building.peers(floor),
    send: (goat) => building.emit(floor, { t: 'goat', goat }),
    wing: () => floor.plan.wing,
    layout: () => floor.plan.layoutNow(),
    dog: () => floor.dog.view(),
  };
  return new GoatHome(floor.id, dataDir, env, herd);
}
