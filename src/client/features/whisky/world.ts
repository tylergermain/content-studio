/**
 * The whisky cabinets on your floor, as the office builder stood them (world/office/furniture-whisky.ts
 * builds each from whisky.glb): what you use one by, and a pour at one, which everyone on the floor
 * sees. The stopper comes out and is laid on the tray, the decanter lifts and tips over the next glass
 * on the tray (the whisky in it hidden while it's tipped, a thin stream running from its lip instead),
 * the glass fills, the decanter goes back and the stopper goes back in; the glass is then in whoever
 * poured it's hand, and the tray has one fewer until it comes back.
 */
import * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import { GLASSES, WHISKY_KIND, pourSpot } from '../../../shared/whisky';
import type { PieceView } from '../../world/office/furnish';
import { WHISKY_PARTS, WHISKY_SIZES, whisky } from '../../world/office/furniture-whisky';
import type { Interactable } from '../../world/types';
import { PourQueue } from './queue';

/** When in a pour (seconds in) the glass is full and taken: it's in the pourer's hand from then. */
export const POURED_AT = 1.85;
/** How far up the decanter its middle is (what it's lifted and tipped about), how high it's lifted, and how far it tips. */
const MID = 0.11;
const LIFT = 0.07;
const TIP = 1.2;
/** How high the stopper comes up out of the neck, and how high it arcs on its way to the tray and back. */
const STOPPER_LIFT = 0.035;
const STOPPER_ARC = 0.03;

/** A smooth step from 0 at `a` to 1 at `b`. */
const ease = (t: number, a: number, b: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** A whisky cabinet standing on your floor. */
export interface Cabinet {
  id: string;
  /** The piece's group as it was built (a new one when it's built again: a new colour). */
  group: THREE.Group;
  use: Interactable;
  /** The decanter hangs from a pivot at its middle, which lifts and tips it; the whisky in it is hidden while it's tipped. */
  pivot: THREE.Object3D;
  pivotRest: THREE.Vector3;
  contents: THREE.Object3D;
  /** The stopper, in the neck at rest and laid on its side on the tray (`down`, where its origin is then) while it pours. */
  stopper: THREE.Object3D;
  stopperRest: THREE.Vector3;
  stopperRestQ: THREE.Quaternion;
  stopperDown: THREE.Vector3;
  glasses: THREE.Object3D[];
  drams: THREE.Object3D[];
  /** The whisky running from the decanter's lip into the glass. */
  stream: THREE.Mesh;
  /** The pour under way, then any waiting their turn. */
  queue: PourQueue;
  /** The last sync that found it on the floor (see Cabinets.sync). */
  seen: number;
}

/** The pouring stream: the cabinet's whisky, a shade lighter, with no line round it (it's only a few millimetres across). */
const STREAM = whisky('#c27c2e');
STREAM.userData.outlineParameters = { visible: false };

/** Takes a built cabinet's moving parts in hand: the decanter on its pivot, the stopper on its own, the glasses and the stream. */
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
  // A stream thicker at the lip than where it lands, a column one metre long from its foot.
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0017, 1, 8).translate(0, 0.5, 0), STREAM);
  stream.visible = false;
  stream.castShadow = false;
  root.add(stream);
  g.userData.interact = use;
  // Laid on its side, its ball toward the bottle: its origin is a ball's height over from the ball's middle.
  const [dx, dy, dz] = WHISKY_SIZES.stopperDown;
  const stopperDown = new THREE.Vector3(dx + WHISKY_SIZES.stopperBall, dy, dz);
  return {
    id: v.piece.id,
    group: g,
    use,
    pivot,
    pivotRest: pivot.position.clone(),
    contents,
    stopper,
    stopperRest: stopper.position.clone(),
    stopperRestQ: stopper.quaternion.clone(),
    stopperDown,
    glasses: glasses as THREE.Object3D[],
    drams: drams as THREE.Object3D[],
    stream,
    queue: new PourQueue(),
    seen: 0,
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const LAY = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const axis = new THREE.Vector3();
const turn = new THREE.Quaternion();

/** Cabinet `c` at rest: the decanter on the tray with its whisky in it, the stopper in its neck. */
function rest(c: Cabinet) {
  c.pivot.position.copy(c.pivotRest);
  c.pivot.quaternion.identity();
  c.contents.visible = true;
  c.stopper.position.copy(c.stopperRest);
  c.stopper.quaternion.copy(c.stopperRestQ);
  c.stream.visible = false;
}

/** Where a pour into glass `i` is `t` seconds in: the stopper, the decanter, the stream and the glass filling. */
function pose(c: Cabinet, i: number, t: number) {
  // Out of the neck, over to the tray and laid on its side; at the end, back up and into the neck.
  const out = ease(t, 0, 0.2) * (1 - ease(t, 2.45, 2.7));
  const laid = ease(t, 0.2, 0.5) * (1 - ease(t, 2.15, 2.45));
  const s = c.stopper.position.copy(c.stopperRest);
  s.y += STOPPER_LIFT * out;
  s.lerp(c.stopperDown, laid);
  s.y += STOPPER_ARC * Math.sin(Math.PI * laid);
  c.stopper.quaternion.copy(c.stopperRestQ).premultiply(turn.setFromAxisAngle(LAY, (Math.PI / 2) * laid));
  // Up and over to the glass, from the side it stands on; tipped toward it; then back the way it came.
  const glass = c.glasses[i];
  const go = ease(t, 0.45, 0.85) * (1 - ease(t, 1.9, 2.25));
  const tip = ease(t, 0.8, 1.1) * (1 - ease(t, 1.65, 1.95));
  const side = tmp2.copy(c.pivotRest).sub(glass.position).setY(0).normalize();
  const over = tmp.copy(glass.position).addScaledVector(side, MID).setY(c.pivotRest.y + LIFT);
  c.pivot.position.lerpVectors(c.pivotRest, over, go);
  c.pivot.position.y = c.pivotRest.y + LIFT * go;
  axis.crossVectors(side, UP).normalize();
  c.pivot.quaternion.setFromAxisAngle(axis, TIP * tip);
  // Tipped, the whisky in it would have to lie level: rather than a block of it leaning over, it's
  // hidden while the decanter's over, and what you see is the stream running from its lip.
  c.contents.visible = tip < 0.04;
  const running = t > 1.0 && t < 1.66;
  c.stream.visible = running;
  const fill = ease(t, 1.02, 1.65);
  const dram = c.drams[i];
  dram.visible = fill > 0.01;
  dram.scale.y = Math.max(0.01, fill);
  if (running) {
    const lip = tmp.set(0, WHISKY_SIZES.lip - MID, 0).applyQuaternion(c.pivot.quaternion).add(c.pivot.position);
    const surface = tmp2.copy(glass.position);
    surface.y += 0.016 + 0.032 * fill;
    c.stream.position.copy(surface);
    const run = lip.sub(surface);
    c.stream.scale.set(1, run.length(), 1);
    c.stream.quaternion.setFromUnitVectors(UP, run.normalize());
  }
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
   * people's hands (the first ones), but for the one a pour is filling.
   */
  update(now: number, taken: number) {
    for (const c of this.byId.values()) {
      const p = c.queue.current(now);
      if (p) pose(c, p.glass, now - p.from);
      else rest(c);
      for (let i = 0; i < GLASSES; i++) {
        // On the tray until it's full (or its pour's turn has yet to come): then it's in their hand.
        c.glasses[i].visible = i >= taken || c.queue.waiting(i, now, POURED_AT);
        if (p?.glass !== i) c.drams[i].visible = false;
      }
    }
  }
}
