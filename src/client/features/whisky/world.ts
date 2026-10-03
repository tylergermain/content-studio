/**
 * The whisky cabinets on your floor, as the office builder stood them (world/office/furniture-whisky.ts
 * builds each from whisky.glb): what you use one by, and a pour at one, which everyone on the floor
 * sees. The stopper comes off, the decanter lifts and tips over the next glass on the tray, the whisky
 * runs into it and fills it, and the decanter goes back; the glass is then in whoever poured it's hand,
 * and the tray has one fewer until it comes back.
 */
import * as THREE from 'three';
import { kindDef, pieceY } from '../../../shared/furniture';
import { GLASSES, WHISKY_KIND, pourSpot } from '../../../shared/whisky';
import type { PieceView } from '../../world/office/furnish';
import { WHISKY_PARTS, WHISKY_SIZES } from '../../world/office/furniture-whisky';
import { toon } from '../../world/toon';
import type { Interactable } from '../../world/types';

/** How long a pour takes, start to finish, in seconds, and when in it the glass is full and taken. */
export const POUR_SECONDS = 2.1;
export const POURED_AT = 1.6;
/** How far up the decanter its middle is (what it's lifted and tipped about), how high it's lifted, and how far it tips. */
const MID = 0.11;
const LIFT = 0.07;
const TIP = 1.2;

/** A smooth step from 0 at `a` to 1 at `b`. */
const ease = (t: number, a: number, b: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

interface Pour {
  /** When it started (seconds), and which glass on the tray it fills. */
  from: number;
  glass: number;
}

/** A whisky cabinet standing on your floor. */
export interface Cabinet {
  id: string;
  /** The piece's group as it was built (a new one when it's built again: a new colour). */
  group: THREE.Group;
  use: Interactable;
  /** The decanter hangs from a pivot at its middle, which lifts and tips it. */
  pivot: THREE.Object3D;
  pivotRest: THREE.Vector3;
  stopper: THREE.Object3D;
  stopperRest: THREE.Vector3;
  glasses: THREE.Object3D[];
  drams: THREE.Object3D[];
  /** The whisky running from the decanter's lip into the glass. */
  stream: THREE.Mesh;
  /** The pour under way, then any waiting their turn (two people pouring at once take turns). */
  pours: Pour[];
}

const STREAM = toon('#c8701c', { emissive: '#4a2208' });

/** Takes a built cabinet's moving parts in hand: the decanter on its pivot, the stopper on its own, the glasses and the stream. */
function adopt(v: PieceView, use: Interactable): Cabinet | null {
  const g = v.group;
  const decanter = g.getObjectByName(WHISKY_PARTS.decanter);
  const stopper = g.getObjectByName(WHISKY_PARTS.stopper);
  const glasses = Array.from({ length: GLASSES }, (_, i) => g.getObjectByName(WHISKY_PARTS.glass(i)));
  const drams = Array.from({ length: GLASSES }, (_, i) => g.getObjectByName(WHISKY_PARTS.dram(i)));
  const root = decanter?.parent;
  if (!decanter || !stopper || !root || glasses.some((x) => !x) || drams.some((x) => !x)) return null;
  // The stopper comes off on its own, so it hangs from the cabinet rather than the decanter.
  root.updateWorldMatrix(true, true);
  root.attach(stopper);
  const pivot = new THREE.Object3D();
  pivot.position.copy(decanter.position).add(new THREE.Vector3(0, MID, 0));
  root.add(pivot);
  pivot.attach(decanter);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 1, 6).translate(0, 0.5, 0), STREAM);
  stream.visible = false;
  stream.castShadow = false;
  root.add(stream);
  g.userData.interact = use;
  return { id: v.piece.id, group: g, use, pivot, pivotRest: pivot.position.clone(), stopper, stopperRest: stopper.position.clone(), glasses: glasses as THREE.Object3D[], drams: drams as THREE.Object3D[], stream, pours: [] };
}

const up = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const axis = new THREE.Vector3();

/** Where pour `p` is `t` seconds in (none: at rest): the stopper, the decanter, the stream and the glass filling. */
function pose(c: Cabinet, p: Pour | undefined, t: number) {
  if (!p) {
    c.pivot.position.copy(c.pivotRest);
    c.pivot.quaternion.identity();
    c.stopper.position.copy(c.stopperRest);
    c.stream.visible = false;
    return;
  }
  const glass = c.glasses[p.glass];
  // Off with the stopper first, and back on last.
  const off = ease(t, 0.05, 0.3) * (1 - ease(t, 1.85, 2.05));
  c.stopper.position.copy(c.stopperRest).add(tmp.set(0, 0.075 * off, 0));
  // Up and over to the glass, from the side it stands on; tipped toward it; then back the way it came.
  const go = ease(t, 0.2, 0.62) * (1 - ease(t, 1.55, 1.95));
  const tip = ease(t, 0.58, 0.9) * (1 - ease(t, 1.4, 1.7));
  const side = tmp2.copy(c.pivotRest).sub(glass.position).setY(0).normalize();
  const over = tmp.copy(glass.position).addScaledVector(side, MID).setY(c.pivotRest.y + LIFT);
  c.pivot.position.lerpVectors(c.pivotRest, over, go);
  c.pivot.position.y = c.pivotRest.y + LIFT * go;
  axis.crossVectors(side, up).normalize();
  c.pivot.quaternion.setFromAxisAngle(axis, TIP * tip);
  // The whisky runs while it's tipped right over, and the glass fills.
  const running = t > 0.78 && t < 1.42;
  c.stream.visible = running;
  const fill = ease(t, 0.8, 1.4);
  const dram = c.drams[p.glass];
  dram.visible = fill > 0.01;
  dram.scale.y = Math.max(0.01, fill);
  if (running) {
    const lip = tmp.set(0, WHISKY_SIZES.lip - MID, 0).applyQuaternion(c.pivot.quaternion).add(c.pivot.position);
    const surface = tmp2.copy(glass.position).add(new THREE.Vector3(0, 0.016 + 0.032 * fill, 0));
    c.stream.position.copy(surface);
    const run = lip.clone().sub(surface);
    c.stream.scale.set(1, run.length(), 1);
    c.stream.quaternion.setFromUnitVectors(up, run.normalize());
  }
}

/** Every whisky cabinet on your floor, kept up with the furniture as the office builder moves it. */
export class Cabinets {
  private byId = new Map<string, Cabinet>();
  private uses: Interactable[] = [];

  /** What you use each by, for the aim (see ctx.usables). */
  usable(): readonly Interactable[] {
    return this.uses;
  }

  get(id: string): Cabinet | undefined {
    return this.byId.get(id);
  }

  all(): IterableIterator<Cabinet> {
    return this.byId.values();
  }

  /** Finds the floor's cabinets among its furniture: new ones taken in hand, moved ones' spots moved, gone ones dropped. */
  sync(views: Iterable<PieceView>) {
    const seen = new Set<string>();
    for (const v of views) {
      if (v.piece.kind !== WHISKY_KIND) continue;
      seen.add(v.piece.id);
      let c = this.byId.get(v.piece.id);
      if (c && c.group !== v.group) {
        this.byId.delete(c.id);
        c = undefined;
      }
      const spot = pourSpot(v.piece);
      const radius = kindDef(v.piece.kind).use?.radius ?? 1.4;
      if (!c) {
        const use: Interactable = { kind: 'whisky', pieceId: v.piece.id, x: spot.x, y: pieceY(v.piece), z: spot.z, radius };
        const made = adopt(v, use);
        if (!made) continue;
        this.byId.set(made.id, (c = made));
      }
      Object.assign(c.use, { x: spot.x, y: spot.y, z: spot.z, radius, off: v.away });
    }
    for (const id of [...this.byId.keys()]) if (!seen.has(id)) this.byId.delete(id);
    this.uses = [...this.byId.values()].map((c) => c.use);
  }

  /**
   * A pour at cabinet `id` into glass `glass` on its tray: now (seconds), or once the one under way is
   * done. Returns when it starts.
   */
  pour(id: string, glass: number, now: number): number {
    const c = this.byId.get(id);
    if (!c) return now;
    const last = c.pours[c.pours.length - 1];
    const from = Math.max(now, last ? last.from + POUR_SECONDS : now);
    c.pours.push({ from, glass: Math.max(0, Math.min(GLASSES - 1, glass)) });
    return from;
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
      while (c.pours.length && now - c.pours[0].from > POUR_SECONDS) c.pours.shift();
      const p = c.pours[0] && c.pours[0].from <= now ? c.pours[0] : undefined;
      pose(c, p, p ? now - p.from : 0);
      c.glasses.forEach((g, i) => {
        // On the tray until it's full (or its pour's turn has yet to come): then it's in their hand.
        const waiting = c.pours.some((q) => q.glass === i && now - q.from < POURED_AT);
        g.visible = waiting || i >= taken;
        if (p?.glass !== i) c.drams[i].visible = false;
      });
    }
  }
}
