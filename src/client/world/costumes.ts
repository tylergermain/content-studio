import * as THREE from 'three';
import { mesh, toon, toonUnique } from './toon';

/*
 * Holiday costumes (see world/holiday.ts for the decorations): at Christmas the workers go as elves,
 * people wear a Santa hat, and the dog gets antlers, a scarf and a glowing red nose. Each piece is
 * built here and hung on the model that wears it.
 */

const details = new Map<string, THREE.MeshToonMaterial>();
/** A material for small bits (bells, buckles), drawn without the cartoon outline, which would swallow them. */
function detail(color: string): THREE.MeshToonMaterial {
  let m = details.get(color);
  if (!m) {
    m = toonUnique(color);
    m.userData.outlineParameters = { visible: false };
    details.set(color, m);
  }
  return m;
}

const Z = new THREE.Vector3(0, 0, 1);

// ---- The workers --------------------------------------------------------------------------------

/** The worker's bean-shaped body (see Worker): a capsule standing at y 0.4..0.7, 0.28 round. */
const BEAN = { y: 0.55, half: 0.15, r: 0.28 } as const;

/** A point on the bean at height `y`, `a` round from the front (+z; +x is positive), `out` off its surface, and which way is out there. */
function onBean(y: number, a: number, out = 0): { at: THREE.Vector3; normal: THREE.Vector3 } {
  const c = THREE.MathUtils.clamp(y, BEAN.y - BEAN.half, BEAN.y + BEAN.half);
  const dy = y - c;
  const rr = Math.sqrt(Math.max(0, BEAN.r * BEAN.r - dy * dy));
  const normal = new THREE.Vector3(Math.sin(a) * rr, dy, Math.cos(a) * rr).normalize();
  return { at: new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr).addScaledVector(normal, out), normal };
}

/** Lays `m` on the bean at (y, a), its +z pointing out of the surface. */
function stick<T extends THREE.Object3D>(m: T, y: number, a: number, out = 0): T {
  const { at, normal } = onBean(y, a, out);
  m.position.copy(at);
  m.quaternion.setFromUnitVectors(Z, normal);
  return m;
}

/** An elf's hat, whose pom-pom is the worker's status bulb (it sits right on the tip). */
export function elfHat(): THREE.Group {
  const g = new THREE.Group();
  const brim = mesh(new THREE.TorusGeometry(0.205, 0.05, 8, 28), toon('#fffaf3'), 0, 0.9, 0);
  brim.rotation.x = Math.PI / 2;
  g.add(brim);
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.3, 24), toon('#2e9e48'), 0, 1.05, 0));
  const band = mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 24), toon('#d62828'), 0, 1.0, 0, false);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  return g;
}

/** An elf's pointy ears (in the worker's own color), a jester's collar with bells, and a belt. */
export function elfWorker(skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.045, 0.17, 10), skin, sx * 0.27, 0.85, 0.0);
    ear.rotation.set(0, 0, -sx * 1.05);
    g.add(ear);
  }
  const flap = new THREE.ConeGeometry(0.075, 0.15, 4).rotateX(Math.PI).scale(1, 1, 0.35).translate(0, -0.07, 0.01);
  const red = toon('#d62828');
  const green = toon('#2e9e48');
  const gold = detail('#ffc233');
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const f = stick(mesh(flap, i % 2 ? green : red, 0, 0, 0, false), 0.57, a, 0.012);
    f.rotateX(-0.3);
    g.add(f);
    if (i % 2 === 0) g.add(stick(mesh(new THREE.SphereGeometry(0.022, 8, 6), gold, 0, 0, 0, false), 0.43, a, 0.045));
  }
  const belt = mesh(new THREE.TorusGeometry(0.273, 0.03, 6, 28), toon('#2b2d42'), 0, 0.3, 0, false);
  belt.rotation.x = Math.PI / 2;
  g.add(belt);
  g.add(stick(mesh(new THREE.BoxGeometry(0.1, 0.075, 0.02), detail('#ffc233'), 0, 0, 0, false), 0.3, 0, 0.03));
  g.add(stick(mesh(new THREE.BoxGeometry(0.055, 0.035, 0.02), detail('#2b2d42'), 0, 0, 0, false), 0.3, 0, 0.037));
  return g;
}

/** A curly-toed elf boot with a bell on the toe, for a worker's foot (its capsule's middle is 0,0,0). */
export function elfBoot(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  const sole = mesh(new THREE.SphereGeometry(0.075, 12, 8), red, 0, -0.06, 0.02);
  sole.scale.set(1, 0.65, 1.3);
  g.add(sole);
  const toe = new THREE.Group();
  toe.position.set(0, -0.06, 0.09);
  toe.rotation.x = -0.75;
  toe.add(mesh(new THREE.ConeGeometry(0.04, 0.13, 8).rotateX(Math.PI / 2).translate(0, 0, 0.06), red, 0, 0, 0, false));
  toe.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), detail('#ffc233'), 0, 0, 0.135, false));
  g.add(toe);
  return g;
}

// ---- People -------------------------------------------------------------------------------------

/** A floppy Santa hat for a person's head (its middle is 0,0,0, 0.34 round; the face looks down +z). */
export function santaHat(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  const fur = toon('#fffaf3');
  const brim = mesh(new THREE.TorusGeometry(0.31, 0.075, 10, 30), fur, 0, 0.21, 0);
  brim.rotation.x = Math.PI / 2;
  g.add(brim);
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.31, 0.3, 24), red, 0, 0.36, 0));
  const flop = new THREE.Group();
  flop.position.set(0, 0.5, 0);
  flop.rotation.set(-0.35, 0, -1.05);
  flop.add(mesh(new THREE.ConeGeometry(0.17, 0.4, 20), red, 0, 0.18, 0));
  flop.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), fur, 0, 0.4, 0));
  g.add(flop);
  g.rotation.x = -0.15;
  return g;
}

// ---- The dog ------------------------------------------------------------------------------------

/** Reindeer antlers (head-local). */
export function dogAntlers(): THREE.Group {
  const g = new THREE.Group();
  const horn = toon('#8b5a2b');
  const tine = (len: number) => new THREE.CapsuleGeometry(0.012, len, 4, 6).translate(0, len / 2, 0);
  for (const sx of [-1, 1]) {
    const beam = new THREE.Group();
    beam.position.set(sx * 0.06, 0.11, -0.01);
    beam.rotation.set(-0.25, 0, -sx * 0.45);
    beam.add(mesh(tine(0.16), horn, 0, 0, 0));
    const front = mesh(tine(0.06), horn, 0, 0.07, 0);
    front.rotation.x = 0.95;
    beam.add(front);
    const out = mesh(tine(0.055), horn, 0, 0.13, 0);
    out.rotation.z = -sx * 0.8;
    beam.add(out);
    g.add(beam);
  }
  return g;
}

/** Rudolph's nose, which glows (head-local, over the dog's own). */
export function dogRedNose(): { nose: THREE.Mesh; glow: THREE.MeshToonMaterial } {
  const glow = toonUnique('#ff3030');
  glow.emissive.set('#ff1a1a');
  glow.emissiveIntensity = 0.8;
  return { nose: mesh(new THREE.SphereGeometry(0.04, 12, 10), glow, 0, -0.005, 0.225, false), glow };
}

/** A red scarf round the dog's neck, over its collar, one end hanging down its chest (head-local). */
export function dogScarf(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  // Where the collar is, and turned the way it is.
  const knit = mesh(new THREE.TorusGeometry(0.1, 0.042, 8, 20), red, 0, -0.11, -0.05);
  knit.rotation.x = Math.PI / 2 + 0.5;
  g.add(knit);
  const end = new THREE.Group();
  end.position.set(0.075, -0.15, 0.0);
  end.rotation.set(0.35, 0.5, 0.12);
  end.add(mesh(new THREE.BoxGeometry(0.055, 0.15, 0.025), red, 0, -0.07, 0));
  for (let i = 0; i < 2; i++) end.add(mesh(new THREE.BoxGeometry(0.057, 0.02, 0.027), toon('#fffaf3'), 0, -0.07 - i * 0.05, 0, false));
  g.add(end);
  return g;
}

// ---- Glows --------------------------------------------------------------------------------------

let glow: THREE.CanvasTexture | null = null;

/** Soft round blob, for glows: one texture, shared by everything that glows (so dressing up again doesn't make another). */
export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(c));
}
