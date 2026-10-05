/**
 * The Touch controllers, hand by hand: where each points (a ray) and where it's held (a grip, which
 * your hands sit on, see hands.ts), its buttons with the frame they went down or up, its stick through
 * the dead zone, and a buzz. Read straight from the session's input sources by handedness (so nothing
 * hangs on which index three gave a controller): the buttons and sticks in 'pre', before anything
 * moves; the poses then and again in 'me', once the rig has settled where you are this frame (rig.ts),
 * so the hands and the rays are where the picture is drawn from. Also draws each hand's pointer: a
 * thin beam and, on a panel, a dot where it lands (see beam, set by interact.ts).
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { IDLE, deadzone2, readButton } from './input-map';
import type { Btn, Hand, VrControllers, VrHand, VrSession } from './types';

/** The 'xr-standard' gamepad's buttons, as a Touch controller has them (WebXR Gamepads Module). */
const TRIGGER = 0;
const SQUEEZE = 1;
const STICK_PRESS = 3;
/** A on the right, X on the left; and B / Y. */
const PRIMARY = 4;
const SECONDARY = 5;

const FORWARD = new THREE.Vector3(0, 0, -1);
/** The pointer's colour pointing at nothing, and at something it would use (or a panel). */
const COLD = new THREE.Color('#ffffff');
const HOT = new THREE.Color('#ffd166');
/** Drawn after the panels (renderOrder 1000+, see panels/), so a pointer's never under one. */
const ON_TOP = 1500;

/** What a buzz asks of the gamepad: WebXR's pulse, or the Gamepad API's rumble where that's all there is. */
interface Rumble {
  hapticActuators?: readonly ({ pulse?(value: number, ms: number): Promise<unknown> } | undefined)[];
  vibrationActuator?: { playEffect?(kind: string, p: object): Promise<unknown> } | null;
}

class Pad implements VrHand {
  connected = false;
  readonly ray = new THREE.Ray();
  readonly grip = new THREE.Group();
  trigger: Btn = IDLE;
  squeeze: Btn = IDLE;
  stickPress: Btn = IDLE;
  primary: Btn = IDLE;
  secondary: Btn = IDLE;
  readonly stick = { x: 0, y: 0 };
  source: XRInputSource | null = null;
  /** The ray's pose, which the pointer is drawn along. */
  readonly aim = new THREE.Group();
  readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly dot: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  constructor(
    readonly hand: Hand,
    beamGeo: THREE.BufferGeometry,
    dotGeo: THREE.BufferGeometry,
  ) {
    this.beam = new THREE.Mesh(beamGeo, overlay(true));
    this.dot = new THREE.Mesh(dotGeo, overlay(false));
    for (const m of [this.beam, this.dot]) {
      m.renderOrder = ON_TOP;
      m.frustumCulled = false;
      this.aim.add(m);
    }
    this.dot.visible = false;
    this.aim.visible = this.grip.visible = false;
  }

  /** This frame's buttons and stick, from its input source (null: it's gone, and whatever it held is let go). */
  read(src: XRInputSource | null) {
    this.source = src;
    const g = src?.gamepad;
    const b = g?.buttons;
    this.trigger = readButton(this.trigger, b?.[TRIGGER]);
    this.squeeze = readButton(this.squeeze, b?.[SQUEEZE]);
    this.stickPress = readButton(this.stickPress, b?.[STICK_PRESS]);
    this.primary = readButton(this.primary, b?.[PRIMARY]);
    this.secondary = readButton(this.secondary, b?.[SECONDARY]);
    // The thumbstick is axes 2 and 3 (0 and 1 are a touchpad Touch controllers don't have); IWER gives those as null.
    const ax = g?.axes ?? [];
    const at = ax.length >= 4 ? 2 : 0;
    deadzone2(ax[at], ax[at + 1], undefined, this.stick);
    if (!src) this.connected = false;
  }

  /** Where it points and where it's held this frame, in the office's world. */
  pose(frame: XRFrame, space: XRReferenceSpace) {
    const src = this.source;
    const rp = src ? frame.getPose(src.targetRaySpace, space) : undefined;
    const gp = src?.gripSpace ? frame.getPose(src.gripSpace, space) : undefined;
    this.connected = !!rp;
    if (rp) {
      place(this.aim, rp.transform);
      this.ray.origin.copy(this.aim.position);
      this.ray.direction.copy(FORWARD).applyQuaternion(this.aim.quaternion);
    }
    if (gp) place(this.grip, gp.transform);
    this.aim.visible = !!rp;
    this.grip.visible = !!gp;
    this.aim.updateMatrixWorld(true);
    this.grip.updateMatrixWorld(true);
  }

  pulse(strength: number, ms: number) {
    const g = this.source?.gamepad as unknown as Rumble | undefined;
    if (!g || !(ms > 0)) return;
    const v = Math.min(1, Math.max(0, strength));
    try {
      const h = g.hapticActuators?.[0];
      const done = h?.pulse ? h.pulse(v, ms) : g.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: v, weakMagnitude: v });
      done?.catch(() => {});
    } catch {
      // no buzz on this one
    }
  }
}

/** Unlit, untouched by fog, light or the outline, drawn over what's behind without hiding anything. */
function overlay(vertexColors: boolean): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: COLD, vertexColors, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  m.userData.outlineParameters = { visible: false };
  return m;
}

function place(o: THREE.Object3D, t: XRRigidTransform) {
  o.position.set(t.position.x, t.position.y, t.position.z);
  o.quaternion.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
}

/** A meter of thin beam along -z from the hand, fading toward its end (vertex alpha), stretched to length by its scale. */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 6, 4, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
  const pos = g.getAttribute('position');
  const rgba = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const along = -pos.getZ(i);
    rgba.set([1, 1, 1, 0.75 * (1 - 0.8 * along * along)], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return g;
}

/**
 * Shows `h`'s pointer `length` meters long: warm when it's on something (`hot`), with a dot where it
 * lands when `dot` (a panel, which the dot sits just in front of).
 */
export function beam(h: VrHand, length: number, hot: boolean, dot: boolean) {
  if (!(h instanceof Pad)) return;
  const len = Math.max(0.02, length);
  h.beam.scale.set(1, 1, len);
  h.beam.material.color.copy(hot ? HOT : COLD);
  h.dot.visible = dot;
  if (dot) {
    h.dot.position.set(0, 0, -(len - 0.003));
    h.dot.scale.setScalar(Math.max(1, len * 0.6));
    h.dot.material.color.copy(hot ? HOT : COLD);
  }
}

/** Reads the controllers every frame of the session (see the file's note), and takes them away at its end. */
export function startControllers(ctx: Ctx, s: VrSession): VrControllers {
  const beamGeo = beamGeometry();
  const dotGeo = new THREE.RingGeometry(0.0035, 0.007, 20);
  const left = new Pad('left', beamGeo, dotGeo);
  const right = new Pad('right', beamGeo, dotGeo);
  let dom: Hand = s.prefs.dominant;
  for (const p of [left, right]) ctx.scene.add(p.grip, p.aim);

  const pads: VrControllers = {
    left,
    right,
    /** The hand that pulled its trigger last (or the prefs' to start with), unless it's put down and the other isn't. */
    get dominant(): Hand {
      const other: Hand = dom === 'left' ? 'right' : 'left';
      return !pads.byHand(dom).connected && pads.byHand(other).connected ? other : dom;
    },
    byHand: (h) => (h === 'left' ? left : right),
  };

  s.tick('pre', () => {
    let l: XRInputSource | null = null;
    let r: XRInputSource | null = null;
    for (const src of s.xr.inputSources) {
      if (src.targetRayMode !== 'tracked-pointer') continue;
      if (src.handedness === 'left') l ??= src;
      else if (src.handedness === 'right') r ??= src;
    }
    left.read(l);
    right.read(r);
    const frame = s.frame();
    if (frame) for (const p of [left, right]) p.pose(frame, s.world());
    if (right.trigger.down) dom = 'right';
    else if (left.trigger.down) dom = 'left';
  });
  s.tick('me', () => {
    const frame = s.frame();
    if (frame) for (const p of [left, right]) p.pose(frame, s.world());
  });

  s.onEnd(() => {
    for (const p of [left, right]) {
      p.grip.removeFromParent();
      p.aim.removeFromParent();
      p.beam.material.dispose();
      p.dot.material.dispose();
    }
    beamGeo.dispose();
    dotGeo.dispose();
  });
  return pads;
}
