import * as THREE from 'three';
import { dogAt, legSeconds } from '../../../shared/dog';
import { GOAT_NAME, GOAT_PET_MS, type GoatState } from '../../../shared/protocol';
import { loadModel } from '../../world/models';
import { disposeSprite, textSprite, toon } from '../../world/toon';
import type { Interactable } from '../../world/types';
import { DASH_FROM, DROP, LEGS, POSES, REAR, STRIDE, buck, buttAt, buttsBy, ease, gait, grazing, lunge, restPose, type Doing } from './pose';

/** What Marc needs of the office around him. */
export interface GoatDeps {
  /** His "maaa", from where he is. */
  bleat(x: number, z: number): void;
  /** His head on the punching bag, from where the bag is. */
  thud(x: number, z: number): void;
  /** The punching bag that piece of furniture `id` is: the part of it that swings, where it stands and how it's turned. */
  bag(id: string): { swing: THREE.Object3D; x: number; z: number; rotY: number } | undefined;
  /** How high the rim of the pot of plant `id` is: what he lowers his head to. */
  rim(id: string): number | undefined;
  /** Where someone on your floor is now (you included). */
  person(id: string): { x: number; z: number } | undefined;
}

/**
 * What each part of the model is painted with, by its material's name in goat.glb (COLORS in
 * blender/scripts/build_goat.py has the same). Only his coat and horns cast a shadow, not the little bits.
 */
const PAINT: Record<string, string> = {
  Coat: '#f7f1e3',
  Patch: '#c98d52',
  Beard: '#e2d3b4',
  Horn: '#b9a58a',
  Hoof: '#4a3d36',
  Muzzle: '#f0a59c',
  Eye: '#f2b441',
  Ink: '#1d1d1d',
  Shine: '#ffffff',
  Collar: '#3a86ff',
  Bell: '#e9b949',
};
const SHADOWED = new Set(['Coat', 'Patch', 'Horn']);

/** The model's parts that the code turns, by name (see build_goat.py): tests/goat-model.test.ts holds the model to them. */
export const GOAT_PARTS = ['goat', 'goat_neck', 'goat_head', 'goat_bell', 'goat_beard', 'goat_tail', 'goat_ear_l', 'goat_ear_r', 'goat_eye_l', 'goat_eye_r', ...LEGS.flatMap((l) => [`goat_leg_${l}`, `goat_shin_${l}`])];

/** How tall he stands (the tips of his horns), and how high his middle is: what he tips about, and comes down by to lie. */
const TOP = 0.9;
const MIDDLE = 0.45;
/** How high his name tag floats over the top of him standing, and the heart over that. */
const TAG_OVER = 0.27;
const HEART_OVER = 0.55;
/** How long the heart of a pat rises for, in seconds. */
const HEART_S = 2.2;
/** How far round his head turns to look at someone. */
const HEAD_TURN = 1.25;

/**
 * What the mouse picks him by: never drawn (nor outlined), yet rays still hit them. His own shapes take
 * no rays, so the crosshair's ray each frame costs three rough shapes rather than ten thousand triangles.
 */
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });
UNSEEN.userData.outlineParameters = { visible: false };

/** The loaded model's moving parts. */
interface Rig {
  /** Holds the model by his middle: tipped for a hop, lowered to lie down, pushed forward for a butt. */
  pivot: THREE.Group;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  bell: THREE.Object3D;
  beard: THREE.Object3D;
  tail: THREE.Object3D;
  ears: [THREE.Object3D, THREE.Object3D];
  eyes: { part: THREE.Object3D; rest: number }[];
  legs: THREE.Object3D[];
  shins: THREE.Object3D[];
}

/**
 * Marc, the office goat, as everyone on his floor sees him: a white-and-tan toon goat that walks where
 * the server says (see server/goat.ts), grazes on the plants, nibbles a rug, butts the punching bag,
 * looks at whoever's about, lies down, gets the zoomies, and bleats and wags when he's petted. Forward
 * is +z. He's modelled in Blender (goat.glb) in parts, each with its origin at its joint, and every
 * move he makes is those parts turned here (pose.ts has the numbers); the model loads the first time a
 * floor has him.
 */
export class Goat {
  readonly root = new THREE.Group();
  readonly interactable: Interactable = { kind: 'goat', x: 0, z: 0, radius: 1.5 };
  private rig: Rig | null = null;
  private asked = false;
  private tag: THREE.Sprite;
  private heart: { sprite: THREE.Sprite; until: number } | null = null;

  private state: GoatState | null = null;
  /** performance.now() when the leg he's on began, and when he gets where it goes. */
  private start = 0;
  private arriveAt = 0;
  /** How many pats he's had, as last heard: one more is a new pat. */
  private pets: number | null = null;
  /** How many butts of the bag have landed since he got to it. */
  private butts = 0;
  /** The bags he has set swinging: which way each went (in its own frame), and for how long so far. */
  private swings = new Map<THREE.Object3D, { x: number; z: number; t: number }>();
  private pose = restPose();
  private drop = 0;
  /** How far through a turn of his legs he is (see STRIDE), and how far round his head is turned. */
  private phase = 0;
  private yaw = 0;
  private t = 0;
  private placed = false;

  constructor(private deps: GoatDeps) {
    this.root.name = 'goat';
    this.root.visible = false;
    this.root.userData.interact = this.interactable;
    this.tag = textSprite(`🐐 ${GOAT_NAME}`, { bg: '#fffaf3', size: 30 });
    this.tag.position.y = TOP + TAG_OVER;
    this.root.add(this.tag);
  }

  /** Nothing to pet on a floor he isn't on, or once the elevator has him. */
  get interactables(): Interactable[] {
    return this.state && this.root.visible ? [this.interactable] : [];
  }

  /** A new leg of his day from the server (null: he's not on this floor); `start` is when it began, on performance.now()'s clock. */
  sync(state: GoatState | null, start: number) {
    this.state = state;
    this.start = start;
    this.root.visible = !!state;
    if (!state) {
      this.placed = false;
      return;
    }
    if (!this.asked) this.load();
    const now = performance.now();
    this.arriveAt = start + legSeconds(state) * 1000;
    // The butts that landed before this page heard of them are let go.
    this.butts = state.act === 'butt' ? buttsBy((now - this.arriveAt) / 1000) : 0;
    // A new pat (not one from before this page loaded, or from before you got to his floor).
    if (state.act === 'pet' && this.pets !== null && state.pets > this.pets && now - start < 1000) {
      const p = dogAt(state, 0);
      this.deps.bleat(p.x, p.z);
      this.love();
    }
    this.pets = state.pets;
  }

  /** What he's up to, for the hint bar: "grazing", "following you". */
  doing(personName: (id: string) => string | undefined): string {
    const s = this.state;
    if (!s) return '';
    const moving = performance.now() < this.arriveAt;
    if (s.riding) return 'off to the elevator';
    if (s.following) return `following ${personName(s.following) ?? 'someone'}`;
    switch (s.act) {
      case 'graze':
        return moving ? 'off to graze' : 'grazing';
      case 'nibble':
        return moving ? 'up to something' : 'nibbling the rug';
      case 'butt':
        return moving ? 'up to something' : 'butting the punching bag';
      case 'lie':
        return moving ? 'looking for a spot to lie down' : 'having a rest';
      case 'zoom':
        return 'the zoomies';
      case 'pet':
        return s.petBy ? `petted by ${s.petBy}` : 'being petted';
      case 'look':
        return `looking at ${(s.watching && personName(s.watching)) ?? 'someone'}`;
      default:
        return moving ? 'ambling about' : '';
    }
  }

  update(dt: number) {
    const s = this.state;
    if (!s) return;
    this.t += dt;
    const now = performance.now();
    const at = dogAt(s, (now - this.start) / 1000);
    // In the elevator, behind its doors: gone until he walks out on another floor.
    this.root.visible = !(s.riding && !at.moving);
    const pos = this.root.position;
    // Somewhere new (just synced, or a floor away): straight there, already doing whatever he's doing.
    const jump = !this.placed || Math.hypot(pos.x - at.x, pos.z - at.z) > 3;
    if (jump) {
      pos.set(at.x, 0, at.z);
      this.root.rotation.y = at.heading;
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-dt * 12);
      pos.x += (at.x - pos.x) * k;
      pos.z += (at.z - pos.z) * k;
      let turn = at.heading - this.root.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.root.rotation.y += turn * (1 - Math.exp(-dt * 9));
    }
    this.interactable.x = pos.x;
    this.interactable.z = pos.z;

    const since = (now - this.arriveAt) / 1000;
    // Each butt lands on its beat, and sets the bag swinging away from him.
    if (!at.moving && s.act === 'butt' && s.piece) {
      for (const due = buttsBy(since); this.butts < due; this.butts++) if (since - buttAt(this.butts) < 0.5) this.butt(s.piece, at.x, at.z);
    }
    this.swing(dt);
    this.animate(dt, at.moving ? (s.speed >= DASH_FROM ? 'dash' : 'walk') : s.act, s, since, jump);
  }

  // ---- The model ----------------------------------------------------------------------------------

  private load() {
    this.asked = true;
    loadModel('goat')
      .then(({ scene }) => this.attach(scene))
      // A file that didn't load, or isn't the model the code knows (a part missing): no goat but his name tag.
      .catch((err: unknown) => console.error("The office goat's model didn't load", err));
  }

  /** Paints the model, finds the parts the code turns, hangs it by its middle and gives it something to be picked by. */
  private attach(model: THREE.Object3D) {
    // The model's materials are only names for what to paint (see PAINT).
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      m.material = toon(PAINT[name] ?? '#ff00ff');
      m.castShadow = SHADOWED.has(name);
      m.receiveShadow = true;
      // Picked by rough shapes instead (see UNSEEN).
      m.raycast = () => {};
    });
    const part = (name: string) => {
      const o = model.getObjectByName(name);
      if (!o) throw new Error(`goat.glb has no ${name}`);
      return o;
    };
    for (const name of GOAT_PARTS) part(name);
    const neck = part('goat_neck');
    const head = part('goat_head');
    // His head turns to look at people after his neck has leant: round the upright, not round the lean.
    neck.rotation.order = 'YXZ';
    head.rotation.order = 'YXZ';
    const pick = (parent: THREE.Object3D, geo: THREE.BufferGeometry, x: number, y: number, z: number, lying = false) => {
      const mesh = new THREE.Mesh(geo, UNSEEN);
      mesh.position.set(x, y, z);
      if (lying) mesh.rotation.x = Math.PI / 2;
      parent.add(mesh);
    };
    pick(part('goat'), new THREE.CapsuleGeometry(0.17, 0.34, 2, 8), 0, 0.46, -0.03, true);
    pick(neck, new THREE.CapsuleGeometry(0.11, 0.14, 2, 8), 0, 0.1, 0.05);
    pick(head, new THREE.SphereGeometry(0.16, 8, 6), 0, 0.05, 0.11);
    const pivot = new THREE.Group();
    pivot.position.y = MIDDLE;
    model.position.y = -MIDDLE;
    pivot.add(model);
    this.root.add(pivot);
    this.rig = {
      pivot,
      neck,
      head,
      bell: part('goat_bell'),
      beard: part('goat_beard'),
      tail: part('goat_tail'),
      ears: [part('goat_ear_l'), part('goat_ear_r')],
      eyes: ['goat_eye_l', 'goat_eye_r'].map((n) => ({ part: part(n), rest: part(n).scale.y })),
      legs: LEGS.map((l) => part(`goat_leg_${l}`)),
      shins: LEGS.map((l) => part(`goat_shin_${l}`)),
    };
  }

  /** A little heart over his head, rising: someone petted him. */
  private love() {
    if (this.heart) {
      this.root.remove(this.heart.sprite);
      disposeSprite(this.heart.sprite);
    }
    const sprite = textSprite('❤️', { bg: '#ffffff', size: 34 });
    this.root.add(sprite);
    this.heart = { sprite, until: this.t + HEART_S };
  }

  /** His head lands on the punching bag: a thump, and the bag swings away from him. */
  private butt(piece: string, x: number, z: number) {
    const bag = this.deps.bag(piece);
    if (!bag) return;
    this.deps.thud(bag.x, bag.z);
    const dx = bag.x - x;
    const dz = bag.z - z;
    const far = Math.hypot(dx, dz) || 1;
    const sin = Math.sin(bag.rotY);
    const cos = Math.cos(bag.rotY);
    this.swings.set(bag.swing, { x: (dx * cos - dz * sin) / far, z: (dx * sin + dz * cos) / far, t: 0 });
  }

  /** The bags he butted swing out and back, less each time, and hang still again. */
  private swing(dt: number) {
    for (const [bag, s] of this.swings) {
      s.t += dt;
      const done = s.t > 3.5;
      const lean = done ? 0 : 0.42 * Math.exp(-1.5 * s.t) * Math.sin(5.2 * s.t);
      // Hung from its hook: leaning toward +x is a turn about z, toward +z a turn back about x.
      bag.rotation.set(-s.z * lean, 0, s.x * lean);
      if (done) this.swings.delete(bag);
    }
  }

  /** `snap`: he's just been put somewhere, so there's nothing to ease from. */
  private animate(dt: number, doing: Doing, s: GoatState, since: number, snap: boolean) {
    const t = this.t;
    const moving = doing === 'walk' || doing === 'dash';
    if (moving) this.phase += ((s.speed * dt) / STRIDE[doing]) * Math.PI * 2;
    const want = moving ? gait(doing, this.phase) : doing === 'graze' ? grazing(s.piece ? this.deps.rim(s.piece) : undefined) : POSES[doing];
    const p = ease(this.pose, want, snap ? 1 : 1 - Math.exp(-dt * (moving ? 16 : 7)));
    this.drop += ((moving ? 0 : DROP[doing]) - this.drop) * (snap ? 1 : 1 - Math.exp(-dt * 7));

    this.tag.position.y = TOP + TAG_OVER - this.drop * 0.8;
    if (this.heart) {
      const left = this.heart.until - t;
      if (left <= 0) {
        this.root.remove(this.heart.sprite);
        disposeSprite(this.heart.sprite);
        this.heart = null;
      } else this.heart.sprite.position.y = TOP + HEART_OVER - this.drop + (1 - left / HEART_S) * 0.35;
    }

    // His head turns to whoever he's watching, as far as it goes.
    let turn = 0;
    const who = !moving && s.watching ? this.deps.person(s.watching) : undefined;
    if (who) {
      const a = Math.atan2(who.x - this.root.position.x, who.z - this.root.position.z) - this.root.rotation.y;
      turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(a), Math.cos(a)), -HEAD_TURN, HEAD_TURN);
    }
    this.yaw += (turn - this.yaw) * (snap ? 1 : 1 - Math.exp(-dt * 6));

    const rig = this.rig;
    if (!rig) return;
    // What he does on top of how he holds himself: these are the moves themselves, so nothing eases them.
    let { y, z, pitch, neck, head } = p;
    let kick = 0;
    let rear = 0;
    let wag = Math.sin(t * 1.7) * 0.08;
    let beard = 0;
    let bell = 0;
    if (moving) {
      wag = Math.sin(this.phase) * 0.2;
      bell = Math.sin(this.phase * 2) * 0.3;
    } else if (doing === 'graze' || doing === 'nibble') {
      // Chewing: his head bobs at it, and his beard with it.
      const chew = Math.sin(t * 9);
      head += chew * 0.05;
      neck += Math.sin(t * 1.3) * 0.04;
      beard = chew * 0.22;
    } else if (doing === 'zoom') {
      const b = buck(since);
      y += b.y;
      pitch += b.pitch;
      kick = b.kick;
      wag = Math.sin(t * 14) * 0.4;
    } else if (doing === 'butt') {
      // Up on his hind legs and into it: tipped back about his middle, lifted so his back hooves stay down, horns to the bag.
      const go = lunge(since);
      rear = go.rear;
      z += go.z;
      pitch -= REAR * rear;
      y += 0.2 * Math.sin(REAR * rear);
      neck -= 0.3 * rear;
      head += 0.1 * rear;
    } else if (doing === 'pet') {
      // Wagging hard, his bell ringing with it, for as long as the pat lasts.
      const happy = THREE.MathUtils.clamp(1 - (performance.now() - this.start) / GOAT_PET_MS, 0.3, 1);
      wag = Math.sin(t * 22) * 0.75 * happy;
      bell = Math.sin(t * 15) * 0.3 * happy;
      y += Math.abs(Math.sin(t * 7)) * 0.02 * happy;
    } else neck += Math.sin(t * 1.5) * 0.015;

    rig.pivot.position.set(0, MIDDLE + y, z);
    rig.pivot.rotation.x = pitch;
    rig.neck.rotation.set(neck, this.yaw * 0.55, 0);
    rig.head.rotation.set(head, this.yaw * 0.45, 0);
    for (let i = 0; i < 4; i++) {
      // Reared up, his back legs stay under him and his front ones tuck.
      rig.legs[i].rotation.x = p.legs[i] + (i >= 2 ? kick + REAR * rear : -0.5 * rear);
      rig.shins[i].rotation.x = p.shins[i] + (i >= 2 ? 0 : 1.1 * rear);
    }
    rig.tail.rotation.set(p.tail, 0, wag);
    const flop = p.ears + (moving ? Math.sin(this.phase * 2) * 0.12 : 0);
    rig.ears[0].rotation.z = flop;
    rig.ears[1].rotation.z = -flop;
    rig.beard.rotation.x = beard;
    rig.bell.rotation.x = bell;
    // A blink now and then; drowsy lying down.
    const open = t % 4.7 < 0.12 ? 0.12 : doing === 'lie' ? 0.45 : 1;
    for (const e of rig.eyes) e.part.scale.y = e.rest * open;
  }
}
