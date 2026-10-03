/**
 * What people do with a dram, as everyone sees it: the glass in their right hand (yours too, in third
 * person), kept upright however their arm swings, and the "🥃 Cheers" that pops up over each head when
 * glasses clink.
 */
import * as THREE from 'three';
import type { Person } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import { heldGlass, type HeldGlass } from './glass';

/** A glass in someone's hand: hung at their fist, on an anchor that's kept upright. */
interface InHand {
  person: Person;
  anchor: THREE.Group;
  glass: HeldGlass;
  /** Seconds into raising it in a toast, or -1. */
  toastT: number;
}

/** Who has a glass in hand, and how full it looks: the person, and 0 to 1. */
export type Holding = ReadonlyMap<string, { person: Person; level: number }>;

/** A toast: the glass goes up and out toward whoever it's raised to, stays there a moment, and comes back down. */
export const TOAST_SECONDS = 1.4;
function toastCurve(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.2) return 1 - (1 - p / 0.2) ** 3;
  if (p < 0.6) return 1;
  const u = (p - 0.6) / 0.4;
  return 1 - u * u * (3 - 2 * u);
}

/** The glasses in people's hands. */
export class Glasses {
  private held = new Map<string, InHand>();

  /** Nobody has a glass in hand. */
  get idle(): boolean {
    return this.held.size === 0;
  }

  /** `id` raises their glass (once it's in their hand). */
  toast(id: string) {
    const h = this.held.get(id);
    if (h) h.toastT = 0;
  }

  /**
   * Puts a glass in the hand of everyone in `who` and keeps it upright, and takes it out of everyone
   * else's. Runs after each person has been posed this frame, so a toast's arm is this one's.
   */
  update(who: Holding, dt: number) {
    for (const [id, h] of this.held) {
      if (who.get(id)?.person === h.person) continue;
      h.glass.dispose();
      h.anchor.removeFromParent();
      this.held.delete(id);
    }
    for (const [id, w] of who) {
      let h = this.held.get(id);
      if (!h) {
        // At the fist of the arm that reaches (see Person.reach), so raising a glass is a reach.
        const anchor = new THREE.Group();
        anchor.position.set(0, -0.38, 0);
        const glass = heldGlass(1.4);
        glass.group.position.set(0, -0.06, 0.09);
        anchor.add(glass.group);
        w.person.wear(anchor, 'hand');
        anchor.traverse((o) => ((o as THREE.Mesh).castShadow = false));
        this.held.set(id, (h = { person: w.person, anchor, glass, toastT: -1 }));
      }
      h.glass.fill(w.level);
      const arm = h.anchor.parent;
      if (!arm) continue;
      if (h.toastT >= 0) {
        // Up and out in front, the way Person.reach goes, held a moment longer.
        h.toastT += dt;
        const k = toastCurve(h.toastT / TOAST_SECONDS);
        arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -1.5, k);
        arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, 0.32, k);
        if (h.toastT >= TOAST_SECONDS) h.toastT = -1;
      }
      // Upright, as the mug is: undo whatever the arm is turned by.
      h.anchor.quaternion.copy(arm.quaternion).invert();
    }
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
