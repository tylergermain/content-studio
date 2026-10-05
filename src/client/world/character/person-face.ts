import * as THREE from 'three';
import { mesh, toon } from '../toon';

/**
 * The face drawn on a person's head (whose center is 0,0,0; the face looks down +z): the eyes, the
 * cheeks, the smile, and the mouth that opens and shuts with their voice. All one group, so something
 * else can take its place (their webcam, see Person.wearFace).
 */
export class DrawnFace {
  readonly group = new THREE.Group();
  private smile: THREE.Mesh;
  private mouth: THREE.Mesh;
  /** 0 = lips together, 1 = wide open. Follows the voice's loudness. */
  open = 0;
  /** Keep the talking mouth up through the short gaps between words. */
  private talkUntil = 0;

  constructor(ink: THREE.Material) {
    for (const sx of [-1, 1]) {
      this.group.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
      this.group.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#ff9f9f'), sx * 0.2, -0.08, 0.27, false));
    }
    this.smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.08, 0.32, false);
    this.smile.rotation.z = Math.PI;
    this.group.add(this.smile);
    // Talking mouth: a flattened ball pressed into the face, scaled open and shut with the voice.
    this.mouth = mesh(new THREE.SphereGeometry(1, 16, 12), toon('#7a2635'), 0, -0.1, 0.295, false);
    const tongue = mesh(new THREE.SphereGeometry(1, 12, 10), toon('#ff8fa3'), 0, -0.5, 0, false);
    tongue.scale.set(0.6, 0.45, 1.15);
    this.mouth.add(tongue);
    this.mouth.visible = false;
    this.group.add(this.mouth);
  }

  /** Lip flap at `level` loud (`speaking` and over counts as talking): pop open fast on each syllable, close a little slower. */
  talk(dt: number, t: number, level: number, speaking: number) {
    const want = THREE.MathUtils.clamp((level - 0.02) / 0.12, 0, 1);
    this.open += (want - this.open) * Math.min(1, dt * (want > this.open ? 35 : 15));
    if (level > speaking * 0.75) this.talkUntil = t + 0.4;
    const talking = t < this.talkUntil;
    this.smile.visible = !talking;
    this.mouth.visible = talking;
    if (talking) this.mouth.scale.set(0.07 * (1 - this.open * 0.2), 0.01 + this.open * 0.045, 0.05);
  }
}
