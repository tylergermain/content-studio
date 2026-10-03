/**
 * The whisky cabinets on your floor, as the office builder stood them (world/office/furniture-whisky.ts
 * builds each from whisky.glb): what you use one by, and a pour at one, which everyone on the floor
 * sees. The stopper comes out and is laid on the tray; the decanter is lifted over the next glass on
 * the tray and tipped till its neck points down past level, the whisky in it lying level all the while
 * (decanter.ts) and running toward the neck until it pours from the lip in a stream that curves down
 * into the glass (stream.ts); the glass fills, the decanter comes back up, over and down onto the tray,
 * and the stopper goes back in. The glass is then in whoever poured it's hand, and the tray has one
 * fewer until it comes back.
 */
import * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import { GLASSES, WHISKY_KIND, pourSpot } from '../../../shared/whisky';
import type { PieceView } from '../../world/office/furnish';
import { WHISKY_PARTS, WHISKY_SIZES } from '../../world/office/furniture-whisky';
import type { Interactable } from '../../world/types';
import { DecanterWhisky, REST_LEVEL } from './decanter';
import { PourQueue } from './queue';
import { Stream } from './stream';

/**
 * The pour, in seconds from its start (it's all over by POUR_SECONDS, shared/whisky.ts): the stopper
 * out and laid on the tray, the decanter up and over the glass, tipped till the whisky reaches its lip
 * and further as it runs out, the stream, the glass filling, and all of it back.
 */
export const POUR = {
  stopperOut: [0, 0.2],
  stopperDown: [0.2, 0.5],
  over: [0.4, 0.85],
  tip: [0.75, 1.08],
  pouring: [1.08, 1.55],
  untip: [1.55, 1.9],
  back: [1.85, 2.25],
  stopperUp: [2.25, 2.5],
  stopperIn: [2.5, 2.72],
  stream: [1.04, 1.58],
  fill: [1.1, 1.62],
} as const;
/** When in a pour (seconds in) the glass is full and taken: it's in the pourer's hand from then. */
export const POURED_AT = 1.85;
/** How far up the decanter its middle is (what it's lifted and tipped about), and how high it's lifted. */
const MID = 0.11;
const LIFT = 0.09;
/** How far the decanter is tipped past where its whisky reaches the lip, and the least and most it's tipped (past level, either way). */
const PAST_LIP = 0.04;
const TIP_LEAST = 1.72;
const TIP_MOST = 2.0;
/**
 * How much of what the decanter holds goes with each dram (a little less than a dram's worth: it's a
 * big decanter), how low it goes before it's filled again to where it stands on the tray (REST_LEVEL)
 * while nobody's looking, and how low before it's filled again as the next pour starts, looked at or not.
 */
const DRAM_SHARE = 0.06;
const LOW = 0.34;
const EMPTY = 0.2;
/** How high the stopper comes up out of the neck, and how high it arcs on its way to the tray and back. */
const STOPPER_LIFT = 0.035;
const STOPPER_ARC = 0.03;
/** How far the stream falls short of the glass's middle, and how quickly its head and tail run down it (seconds). */
const SHORT = 0.012;
const RUN = 0.08;

/** A smooth step from 0 at `a` to 1 at `b`. */
const ease = (t: number, a: number, b: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const span = (t: number, [a, b]: readonly [number, number]) => ease(t, a, b);

/** A whisky cabinet standing on your floor. */
export interface Cabinet {
  id: string;
  /** The piece's group as it was built (a new one when it's built again: a new colour). */
  group: THREE.Group;
  use: Interactable;
  /** The decanter hangs from a pivot at its middle, which lifts and tips it, with the whisky in it lying level. */
  pivot: THREE.Object3D;
  pivotRest: THREE.Vector3;
  whisky: DecanterWhisky;
  /** How full the decanter is, of all it holds: a dram less after each pour, and how full it's filled again (to REST_LEVEL). */
  fill: number;
  full: number;
  /** The stopper, in the neck at rest and laid on its side on the tray (`down`, where its origin is then) while it pours. */
  stopper: THREE.Object3D;
  stopperRest: THREE.Vector3;
  stopperRestQ: THREE.Quaternion;
  stopperDown: THREE.Vector3;
  glasses: THREE.Object3D[];
  drams: THREE.Object3D[];
  /** The whisky running from the decanter's lip into the glass. */
  stream: Stream;
  /** The pour under way, then any waiting their turn. */
  queue: PourQueue;
  /** The pour being played: when it started, how full the decanter was then, and how far it's tipped as it starts to pour and as it ends. */
  playing: { from: number; fill: number; tipFrom: number; tipTo: number; reach: number } | null;
  /** The last sync that found it on the floor (see Cabinets.sync). */
  seen: number;
}

/** Takes a built cabinet's moving parts in hand: the decanter on its pivot with its own level whisky, the stopper on its own, the glasses and the stream. */
function adopt(v: PieceView, use: Interactable): Cabinet | null {
  const g = v.group;
  const decanter = g.getObjectByName(WHISKY_PARTS.decanter);
  const stopper = g.getObjectByName(WHISKY_PARTS.stopper);
  const contents = g.getObjectByName(WHISKY_PARTS.contents);
  const glasses = Array.from({ length: GLASSES }, (_, i) => g.getObjectByName(WHISKY_PARTS.glass(i)));
  const drams = Array.from({ length: GLASSES }, (_, i) => g.getObjectByName(WHISKY_PARTS.dram(i)));
  const root = decanter?.parent;
  if (!decanter || !stopper || !contents || !root || glasses.some((x) => !x) || drams.some((x) => !x)) return null;
  // The stopper comes off on its own, so it hangs from the cabinet rather than the decanter.
  root.updateWorldMatrix(true, true);
  root.attach(stopper);
  const pivot = new THREE.Object3D();
  pivot.position.copy(decanter.position).add(new THREE.Vector3(0, MID, 0));
  root.add(pivot);
  pivot.attach(decanter);
  // The model's whisky stands still in it: this one lies level however it's tipped.
  contents.visible = false;
  const whisky = new DecanterWhisky();
  decanter.add(whisky.mesh);
  const full = whisky.fillAt(REST_LEVEL);
  const stream = new Stream();
  root.add(stream.mesh);
  g.userData.interact = use;
  // Laid on its side, its ball toward the bottle: its origin is a ball's height over from the ball's middle.
  const [dx, dy, dz] = WHISKY_SIZES.stopperDown;
  const stopperDown = new THREE.Vector3(dx + WHISKY_SIZES.stopperBall, dy, dz);
  const c: Cabinet = {
    id: v.piece.id,
    group: g,
    use,
    pivot,
    pivotRest: pivot.position.clone(),
    whisky,
    fill: full,
    full,
    stopper,
    stopperRest: stopper.position.clone(),
    stopperRestQ: stopper.quaternion.clone(),
    stopperDown,
    glasses: glasses as THREE.Object3D[],
    drams: drams as THREE.Object3D[],
    stream,
    queue: new PourQueue(),
    playing: null,
    seen: 0,
  };
  rest(c);
  return c;
}

const UP = new THREE.Vector3(0, 1, 0);
const LAY = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();
const side = new THREE.Vector3();
const axis = new THREE.Vector3();
const up = new THREE.Vector3();
const lip = new THREE.Vector3();
const along = new THREE.Vector3();
const into = new THREE.Vector3();
const turn = new THREE.Quaternion();
const back = new THREE.Quaternion();

/** Cabinet `c` at rest: the decanter on the tray with its whisky in it, the stopper in its neck. */
function rest(c: Cabinet) {
  c.pivot.position.copy(c.pivotRest);
  c.pivot.quaternion.identity();
  c.whisky.lay(UP, c.fill);
  c.stopper.position.copy(c.stopperRest);
  c.stopper.quaternion.copy(c.stopperRestQ);
  c.stream.mesh.visible = false;
}

/** How far the decanter has to be tipped for its whisky, `fill` of all it holds, to reach the lip: about its middle, toward the lip's side. */
function lipTip(c: Cabinet, fill: number): number {
  let lo = 1.2;
  let hi = 2.4;
  for (let i = 0; i < 12; i++) {
    const tip = (lo + hi) / 2;
    // Tipped toward +x, the world's up is this in its own frame, and the lip's lowest point is the edge on that side.
    up.set(Math.sin(tip), Math.cos(tip), 0);
    const reached = c.whisky.level(up, fill) >= up.dot(lip.set(WHISKY_SIZES.lipRadius, WHISKY_SIZES.lip, 0));
    if (reached) hi = tip;
    else lo = tip;
  }
  return (lo + hi) / 2;
}

/** The lip's lowest point, tipped `tip` toward the glass along `side` (from the glass to the decanter), from the pivot: how far out and how far down. */
const lipOut = (tip: number) => (WHISKY_SIZES.lip - MID) * Math.sin(tip) + WHISKY_SIZES.lipRadius * Math.cos(tip);

/** Where a pour into glass `i` is `t` seconds in: the stopper, the decanter and its whisky, the stream and the glass filling. */
function pose(c: Cabinet, i: number, t: number) {
  const play = c.playing!;
  // Out of the neck, over to the tray and laid on its side; at the end, back up and into the neck.
  const out = span(t, POUR.stopperOut) * (1 - span(t, POUR.stopperIn));
  const laid = span(t, POUR.stopperDown) * (1 - span(t, POUR.stopperUp));
  const s = c.stopper.position.copy(c.stopperRest);
  s.y += STOPPER_LIFT * out;
  s.lerp(c.stopperDown, laid);
  s.y += STOPPER_ARC * Math.sin(Math.PI * laid);
  c.stopper.quaternion.copy(c.stopperRestQ).premultiply(turn.setFromAxisAngle(LAY, (Math.PI / 2) * laid));
  // Up and over the glass, from the side it stands on, its lip short of the glass's middle; tipped toward it; then back the way it came.
  const glass = c.glasses[i];
  const go = span(t, POUR.over) * (1 - span(t, POUR.back));
  side.copy(c.pivotRest).sub(glass.position).setY(0).normalize();
  tmp.copy(glass.position).addScaledVector(side, play.reach).setY(c.pivotRest.y + LIFT);
  c.pivot.position.lerpVectors(c.pivotRest, tmp, go);
  c.pivot.position.y = c.pivotRest.y + LIFT * go;
  const tip = play.tipFrom * span(t, POUR.tip) + (play.tipTo - play.tipFrom) * span(t, POUR.pouring);
  axis.crossVectors(side, UP).normalize();
  c.pivot.quaternion.setFromAxisAngle(axis, tip * (1 - span(t, POUR.untip)));
  // The whisky lies level, a dram less of it once it's poured.
  const poured = span(t, POUR.stream);
  c.fill = play.fill - DRAM_SHARE * poured;
  c.whisky.lay(up.copy(UP).applyQuaternion(back.copy(c.pivot.quaternion).invert()), c.fill);
  // The glass fills.
  const fill = span(t, POUR.fill);
  const dram = c.drams[i];
  dram.visible = fill > 0.01;
  dram.scale.y = Math.max(0.01, fill);
  // The stream, from the lip's lowest edge (the side toward the glass), leaving along the neck, to the
  // whisky's surface in the glass: its head runs down it as it starts, and its tail falls in at the end.
  const [a, b] = POUR.stream;
  const head = Math.min(1, Math.max(0, (t - a) / RUN));
  const tail = Math.min(1, Math.max(0, (t - b) / RUN));
  if (head <= tail) {
    c.stream.mesh.visible = false;
    return;
  }
  lip.copy(side).multiplyScalar(-WHISKY_SIZES.lipRadius).setY(WHISKY_SIZES.lip - MID).applyQuaternion(c.pivot.quaternion).add(c.pivot.position);
  along.copy(UP).applyQuaternion(c.pivot.quaternion);
  into.copy(glass.position);
  into.y += WHISKY_SIZES.glassFloor + WHISKY_SIZES.dram * fill;
  c.stream.set(lip, along, into, tail, head);
}

/** Every whisky cabinet on your floor, kept up with the furniture as the office builder moves it. */
export class Cabinets {
  private byId = new Map<string, Cabinet>();
  private uses: Interactable[] = [];
  private syncs = 0;

  /** What you use each by, for the aim (see ctx.usables). */
  usable(): readonly Interactable[] {
    return this.uses;
  }

  /** How many there are on the floor. */
  get size(): number {
    return this.byId.size;
  }

  get(id: string): Cabinet | undefined {
    return this.byId.get(id);
  }

  all(): IterableIterator<Cabinet> {
    return this.byId.values();
  }

  /**
   * Finds the floor's cabinets among its furniture: new ones taken in hand, moved ones' spots moved,
   * gone ones dropped. Every frame, so it makes nothing new unless a cabinet came or went.
   */
  sync(views: Iterable<PieceView>) {
    const now = ++this.syncs;
    let changed = false;
    for (const v of views) {
      if (v.piece.kind !== WHISKY_KIND) continue;
      let c = this.byId.get(v.piece.id);
      if (c && c.group !== v.group) {
        this.byId.delete(c.id);
        c = undefined;
      }
      if (!c) {
        const made = adopt(v, { kind: 'whisky', pieceId: v.piece.id, x: 0, y: 0, z: 0, radius: 1.4 });
        if (!made) continue;
        this.byId.set(made.id, (c = made));
        changed = true;
      }
      c.seen = now;
      pourSpot(v.piece, c.use);
      c.use.radius = kindDef(v.piece.kind).use?.radius ?? 1.4;
      c.use.off = v.away;
    }
    for (const c of this.byId.values()) {
      if (c.seen === now) continue;
      this.byId.delete(c.id);
      changed = true;
    }
    if (changed) this.uses = [...this.byId.values()].map((c) => c.use);
  }

  /**
   * A pour at cabinet `id` into glass `glass` on its tray: now (seconds), or once the ones before it
   * are done. Returns when it starts, or null when it won't play (no such cabinet, or too many waiting).
   */
  pour(id: string, glass: number, now: number): number | null {
    return this.byId.get(id)?.queue.add(glass, now) ?? null;
  }

  /** Where the decanter of cabinet `id` is, in the world: where a pour is heard from. */
  at(id: string): { x: number; y: number; z: number } | undefined {
    const c = this.byId.get(id);
    return c ? c.pivot.getWorldPosition(new THREE.Vector3()) : undefined;
  }

  /**
   * Every frame: each pour goes on, and each tray shows the glasses nobody has: `taken` of them are in
   * people's hands (the first ones), but for the one a pour is filling. A decanter at rest that's
   * running low is filled again while `unseen` says nobody's looking at it.
   */
  update(now: number, taken: number, unseen: (at: THREE.Vector3) => boolean) {
    for (const c of this.byId.values()) {
      const p = c.queue.current(now);
      if (p && c.playing?.from !== p.from) {
        // A new pour: how far it tips to pour, from how full it is now, and where it's held over the glass.
        if (c.fill < EMPTY) c.fill = c.full;
        const tipFrom = Math.min(TIP_MOST, Math.max(TIP_LEAST, lipTip(c, c.fill)));
        const tipTo = Math.min(TIP_MOST, Math.max(tipFrom + 0.05, lipTip(c, c.fill - DRAM_SHARE) + PAST_LIP));
        c.playing = { from: p.from, fill: c.fill, tipFrom, tipTo, reach: lipOut((tipFrom + tipTo) / 2) + SHORT };
      }
      if (p) pose(c, p.glass, now - p.from);
      else {
        if (c.playing) {
          c.playing = null;
          rest(c);
        }
        if (c.fill < LOW && unseen(c.pivot.getWorldPosition(tmp))) {
          c.fill = c.full;
          rest(c);
        }
      }
      for (let i = 0; i < GLASSES; i++) {
        // On the tray until it's full (or its pour's turn has yet to come): then it's in their hand.
        c.glasses[i].visible = i >= taken || c.queue.waiting(i, now, POURED_AT);
        if (p?.glass !== i) c.drams[i].visible = false;
      }
    }
  }
}
