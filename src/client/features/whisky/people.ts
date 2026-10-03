/**
 * What people do with a dram, as everyone sees it: the glass in their right hand (yours too, in third
 * person), kept upright however their arm swings; in a toast, the glass reaching to where clink.ts
 * says it goes (to meet the others' between them, or raised toward them from a distance), the body
 * turning and leaning in to get it there and the arm reaching for it; and the "🥃 Cheers" that pops up
 * over each head when glasses clink.
 */
import * as THREE from 'three';
import type { Person } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import { toastStep, type Raised } from './clink';
import { GLASS, heldGlass, type HeldGlass } from './glass';

/**
 * How big the glass in someone's hand is, and where it is from their fist (upright, the way they face):
 * held a little below it and out in front of it, and in a toast gripped low and further out, so its rim
 * stands up over the hand to meet the other's.
 */
export const HAND_GLASS = 1.4;
const HUNG = new THREE.Vector3(0, -0.06, 0.09);
const RAISED = new THREE.Vector3(0, 0.015, 0.1);
/** From its foot to its middle, and its middle from the fist, raised in a toast. */
const HALF = new THREE.Vector3(0, (GLASS.h * HAND_GLASS) / 2, 0);
const MIDDLE = RAISED.clone().add(HALF);
/** How far a Person's fist is from their shoulder (see Person: the arm's pivot, and the fist at the end of it). */
const ARM = 0.38;
/**
 * How far an arm stretches to get a glass there; the most a body leans in for it (radians), as long as
 * the head (HEAD across where the glass is, and about its middle HEAD_UP over the feet) stays clear of
 * it; how far the glass may then be from the fist and still be in hand; and how far round a body turns
 * to bring the right shoulder in (toward someone, or toward someone across the way).
 */
const STRETCH = 1.2;
const LEAN = 0.24;
const HEAD = 0.36;
const HEAD_UP = 1.32;
const SLIP = 0.06;
const TURN = { touch: 0.4, raised: 0.15 } as const;

/** A glass in someone's hand: hung from their body, kept at their fist and upright. */
interface InHand {
  person: Person;
  /** At the fist of the arm that reaches (see Person.reach), worn on that hand: where the glass is held from. */
  fist: THREE.Object3D;
  anchor: THREE.Group;
  glass: HeldGlass;
  /** The arm was put where a toast wanted it, and wants putting back as it was. */
  posed: boolean;
}

/** Who has a glass in hand, and how full it looks: the person, and 0 to 1. */
export type Holding = ReadonlyMap<string, { person: Person; level: number }>;
/** Who's in a toast, by id: where their glass goes, and how far into the toast it is (seconds). */
export type Toasting = ReadonlyMap<string, { raised: Raised; t: number }>;

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const rootM = new THREE.Matrix4();
const bodyM = new THREE.Matrix4();
const inv = new THREE.Matrix4();
const target = new THREE.Vector3();
const reach = new THREE.Vector3();
const dir = new THREE.Vector3();
const lean = new THREE.Euler(0, 0, 0, 'YXZ');
const yawQ = new THREE.Quaternion();
const tiltQ = new THREE.Quaternion();
const baseQ = new THREE.Quaternion();
const aimQ = new THREE.Quaternion();
const toward = new THREE.Vector3();
const aimed = new THREE.Vector3();
const across = new THREE.Vector3();
const euler = new THREE.Euler();

/** The angle `a` brought round to between -π and π. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The glasses in people's hands. */
export class Glasses {
  private held = new Map<string, InHand>();

  /** Nobody has a glass in hand. */
  get idle(): boolean {
    return this.held.size === 0;
  }

  /**
   * Puts a glass in the hand of everyone in `who` and keeps it upright, and takes it out of everyone
   * else's; for everyone in a toast (`toasts`), reaches it where it goes. Runs after each person has
   * been posed this frame, so it poses over what they're doing.
   */
  update(who: Holding, toasts: Toasting) {
    for (const [id, h] of this.held) {
      if (who.get(id)?.person === h.person) continue;
      this.letGo(h);
      this.held.delete(id);
    }
    for (const [id, w] of who) {
      let h = this.held.get(id);
      if (!h) {
        // The fist, on the arm that reaches (so raising a glass is a reach), and the glass hung from the body and kept at it.
        const fist = new THREE.Object3D();
        fist.position.set(0, -ARM, 0);
        w.person.wear(fist, 'hand');
        const anchor = new THREE.Group();
        const glass = heldGlass(HAND_GLASS);
        glass.group.position.copy(HUNG);
        anchor.add(glass.group);
        w.person.wear(anchor, 'body');
        anchor.traverse((o) => ((o as THREE.Mesh).castShadow = false));
        this.held.set(id, (h = { person: w.person, fist, anchor, glass, posed: false }));
      }
      h.glass.fill(w.level);
      const arm = h.fist.parent;
      const body = arm?.parent;
      if (!arm || !body) continue;
      const toast = toasts.get(id);
      const step = toast ? toastStep(toast.t, toast.raised.touch) : null;
      let yaw = 0;
      const reaching = !!toast && !!step && step.k > 0;
      if (reaching) {
        yaw = this.reachFor(h.person, arm, body, toast.raised, step);
        h.posed = true;
      } else if (h.posed) {
        // Back as the arm was: straight, and only swinging as a walk swings it.
        arm.scale.y = 1;
        arm.rotation.y = 0;
        h.posed = false;
      }
      // At the fist, upright as they stand (and leaning toward the glass it meets, as they clink).
      arm.updateMatrix();
      h.anchor.position.copy(h.fist.position).applyMatrix4(arm.matrix);
      yawQ.setFromAxisAngle(UP, yaw);
      tiltQ.identity();
      if (toast && step && step.tilt > 0) {
        // Which way it leans, as it is from where they face: toward the other glass.
        toward.set(toast.raised.tx, 0, toast.raised.tz).applyAxisAngle(UP, -(h.person.root.rotation.y + yaw));
        across.crossVectors(UP, toward).normalize();
        tiltQ.setFromAxisAngle(across, step.tilt);
      }
      h.anchor.quaternion.copy(body.quaternion).invert().multiply(yawQ).multiply(tiltQ);
      h.glass.group.position.lerpVectors(HUNG, RAISED, reaching ? step!.k : 0);
      if (reaching) {
        // The rest of the way to where it goes, if the arm fell short of it: still in the hand.
        dir.copy(h.glass.group.position).add(HALF).applyQuaternion(h.anchor.quaternion).add(h.anchor.position);
        dir.subVectors(aimed, dir);
        if (dir.length() > SLIP) dir.setLength(SLIP);
        h.anchor.position.addScaledVector(dir, step!.k);
      }
    }
  }

  /**
   * Turns `person` toward where their glass goes, leans them in if it's far, and reaches their arm for
   * it, as far into the toast as `step` says. Returns how far round their body turned (radians).
   */
  private reachFor(person: Person, arm: THREE.Object3D, body: THREE.Object3D, raised: Raised, step: ReturnType<typeof toastStep>): number {
    const { k } = step;
    const root = person.root;
    const sitting = person.pose === 'sit';
    // Turned to face where the glasses meet, the right shoulder brought round toward it.
    const face = Math.atan2(raised.faceX - root.position.x, raised.faceZ - root.position.z);
    const yaw = sitting ? 0 : wrap(face + (raised.touch ? TURN.touch : TURN.raised) - root.rotation.y) * k;
    // Where the glass's middle goes (short of meeting by the gap, and by as much as leaning in brings
    // its rim over, so it's the rims that touch), and so where the fist goes.
    const short = step.gap + (raised.touch ? ((GLASS.h * HAND_GLASS) / 2) * Math.sin(step.tilt) : 0);
    target.set(raised.x - raised.tx * short, raised.y + step.lift, raised.z - raised.tz * short);
    // How far out in front of them it is, and so how far they can lean in before their head's in the way.
    const out = Math.hypot(target.x - root.position.x, target.z - root.position.z);
    const room = (out - GLASS.r * HAND_GLASS - HEAD) / HEAD_UP;
    const most = Math.min(LEAN, Math.asin(Math.min(1, Math.max(0, room))));
    reach.copy(MIDDLE).applyAxisAngle(UP, root.rotation.y + yaw);
    target.sub(reach);
    root.updateMatrix();
    rootM.copy(root.matrix);
    if (root.parent) rootM.premultiply(root.parent.matrixWorld);
    const ahead = body.rotation.x;
    const fistAt = (tilt: number) => {
      body.quaternion.setFromEuler(lean.set(ahead + tilt, yaw, 0, 'YXZ'));
      body.updateMatrix();
      bodyM.multiplyMatrices(rootM, body.matrix);
      return dir.copy(target).applyMatrix4(inv.copy(bodyM).invert()).sub(arm.position);
    };
    // Leaning in as far as it takes for the arm to reach (only on their feet, and only to meet another glass).
    const far = fistAt(0).length();
    const tilt = sitting || !raised.touch ? 0 : Math.min(most, Math.max(0, (far - ARM) / 0.75)) * k;
    fistAt(tilt);
    // Where the glass's middle goes, as their body is now (for the last of the way, see update).
    aimed.copy(target).add(reach).applyMatrix4(inv);
    const length = dir.length();
    // The arm pointed at it from the shoulder, stretched a little if it's still short of it.
    baseQ.setFromEuler(euler.set(arm.rotation.x, 0, arm.rotation.z));
    aimQ.setFromUnitVectors(DOWN, dir.divideScalar(length));
    arm.quaternion.slerpQuaternions(baseQ, aimQ, k);
    arm.scale.y = 1 + (Math.min(STRETCH, Math.max(1, length / ARM)) - 1) * k;
    return yaw;
  }

  private letGo(h: InHand) {
    const arm = h.fist.parent;
    if (h.posed && arm) {
      arm.scale.y = 1;
      arm.rotation.y = 0;
    }
    h.glass.dispose();
    h.anchor.removeFromParent();
    h.fist.removeFromParent();
  }
}

/** How long a "🥃 Cheers" stays up, in seconds, and how far it rises. */
const POP_SECONDS = 2.6;
const POP_RISE = 0.35;

/** The "🥃 Cheers" over the heads of whoever clinked glasses. */
export class Pops {
  private pops: { sprite: THREE.Sprite; t: number; y: number }[] = [];

  /** None up. */
  get idle(): boolean {
    return this.pops.length === 0;
  }

  /** Pops one up over `person`'s head. */
  add(person: Person) {
    const sprite = textSprite('🥃 Cheers', { bg: '#ffffff', size: 34 });
    const y = person.bubbleY + 0.15;
    sprite.position.y = y;
    person.root.add(sprite);
    this.pops.push({ sprite, t: 0, y });
  }

  update(dt: number) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      p.sprite.position.y = p.y + POP_RISE * Math.min(1, p.t / POP_SECONDS);
      p.sprite.material.opacity = Math.min(1, (POP_SECONDS - p.t) / 0.6);
      if (p.t < POP_SECONDS) continue;
      p.sprite.removeFromParent();
      disposeSprite(p.sprite);
      this.pops.splice(i, 1);
    }
  }
}
