import * as THREE from 'three';
import type { HeliPose } from '../../../shared/protocol';
import { CrewFigures } from './crew';
import { buildHeli, poseHeli, type HeliModel } from './model';

// Friday One seen from the roof bar. The roof is a world of its own (features/rooftop), with the street
// roofDrop below its deck, so the helicopter is drawn up there too: a second one in a group of its own
// in the scene, built the first time you go up and shown only while you're there. Nothing lands on the
// roof yet, so it gives nothing to bump into up there.

export class HeliRoof {
  private group: THREE.Group | null = null;
  private model: HeliModel | null = null;
  /** Who's aboard and not up on the roof with you, and the pilot's tag. */
  crew: CrewFigures | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Whether it's been built (you've been up there). */
  get built(): boolean {
    return !!this.group;
  }

  /**
   * Each frame: shown (`up` on the roof) at `pose`, its street `base` below the roof's deck, its rotor
   * turned to `angle` at `spin`, the lights at `t` seconds.
   */
  show(up: boolean, pose: HeliPose, base: number, angle: number, spin: number, t: number, dt: number) {
    if (!up) {
      if (this.group) this.group.visible = false;
      return;
    }
    if (!this.group) {
      this.group = new THREE.Group();
      this.model = buildHeli();
      this.group.add(this.model.root);
      this.crew = new CrewFigures(this.group);
      this.scene.add(this.group);
    }
    this.group.visible = true;
    poseHeli(this.model!, pose, base, angle, spin, t);
    this.crew!.place(pose, base, dt, t);
  }
}
