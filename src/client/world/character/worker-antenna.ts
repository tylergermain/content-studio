import * as THREE from 'three';
import type { AgentProvider, WorkerStatus } from '../../../shared/protocol';
import { piece } from '../models';
import { mesh, toon, toonUnique } from '../toon';
import { DEFAULT_TOPPER, topperFor, topperLife, turnTopper, type Topper } from '../toppers';
import { STATUS_BULB } from './worker-badges';

// A worker's antenna: the stalk out of its head, its status light on the tip, and standing on that the
// emblem of what it runs on (world/toppers.ts says which, toppers.glb is what they're made of).

/** How high the light is over the worker's feet, how big it is, and where the emblem stands on it: under the name tag, with room to bob. */
const LIGHT = { y: 1.15, r: 0.042 };
const STAND = LIGHT.y + LIGHT.r - 0.004;

const stalk = new THREE.CylinderGeometry(0.015, 0.015, 0.17, 6);
const ball = new THREE.SphereGeometry(LIGHT.r, 12, 10);

/**
 * The emblems' own materials, one per color for every worker: lit a little from inside, so an emblem
 * reads across a dim room, and outlined thinner than the furniture, which would swamp something this small.
 */
const paints = new Map<string, THREE.Material>();
function paint(color: string): THREE.Material {
  let m = paints.get(color);
  if (!m) {
    const made = toonUnique(color);
    made.emissive = new THREE.Color(color).multiplyScalar(0.25);
    made.userData.outlineParameters = { thickness: 0.002 };
    paints.set(color, (m = made));
  }
  return m;
}

/** A painted copy of an emblem, or of the plain one if the model has no such part. */
function emblem(t: Topper): THREE.Object3D {
  const colors: Record<string, string> = t.colors;
  const made = piece('toppers', t.part, (name) => paint(colors[name] ?? '#ff00ff'), false);
  if (made.children.length || (made as THREE.Mesh).isMesh || t === DEFAULT_TOPPER) return made;
  return emblem(DEFAULT_TOPPER);
}

export class Antenna {
  /** The light's material: the color of its worker's status (and a disco ball's while it dances). */
  readonly bulb = toonUnique(STATUS_BULB.starting);
  /** The light itself, which swells while its worker needs you. */
  readonly light = mesh(ball, this.bulb, 0, LIGHT.y, 0, false);
  /** What the emblem hangs in: this is what turns, bobs and beats. */
  private mount = new THREE.Group();
  private worn: Topper | null = null;
  private spin = { angle: Math.random() * Math.PI * 2, speed: 0 };
  /** How far it's bobbing and how hard it's beating just now, eased from one status to the next, and where it is in its own bob. */
  private bob = 0;
  private pulse = 0;
  private phase = Math.random() * Math.PI * 2;

  constructor(body: THREE.Object3D) {
    this.bulb.emissive = new THREE.Color(STATUS_BULB.starting).multiplyScalar(0.6);
    this.mount.position.y = STAND;
    body.add(mesh(stalk, toon('#2b2d42'), 0, LIGHT.y - 0.105, 0, false), this.light, this.mount);
    this.wear(undefined);
  }

  /** Puts on the emblem of `provider` (the plain one for none) in place of the one it has. */
  wear(provider: AgentProvider | undefined) {
    const next = topperFor(provider);
    if (next === this.worn) return;
    this.worn = next;
    // The model's shapes and the emblems' materials are shared: the old one is only let go of.
    this.mount.clear();
    this.mount.add(emblem(next));
  }

  /** Its light in `status`'s color. */
  paint(status: WorkerStatus) {
    const c = STATUS_BULB[status] ?? '#adb5bd';
    this.bulb.color.set(c);
    this.bulb.emissive.set(c).multiplyScalar(0.7);
  }

  /** Its light out (sent home, locked up). */
  dark() {
    this.bulb.color.set(STATUS_BULB.exited);
    this.bulb.emissive.set('#000000');
  }

  /**
   * A frame of it, for a worker in `status`: the light swells while it needs you, and the emblem turns
   * slowly and bobs, spins and beats while it works, and stands still once it's asleep (see topperLife).
   */
  update(dt: number, t: number, status: WorkerStatus) {
    this.light.scale.setScalar(status === 'needs_input' ? 1 + Math.abs(Math.sin(t * 8)) * 0.5 : 1);
    const life = topperLife(status);
    const k = Math.min(1, dt * 4);
    this.bob += (life.bob - this.bob) * k;
    this.pulse += (life.pulse - this.pulse) * k;
    this.mount.rotation.y = turnTopper(this.spin, life, this.worn?.spin ?? 1, dt).angle;
    this.mount.position.y = STAND + this.bob * (1 + Math.sin(t * 2.4 + this.phase));
    this.mount.scale.setScalar((this.worn?.size ?? 1) * (1 + this.pulse * Math.abs(Math.sin(t * 6))));
  }
}
