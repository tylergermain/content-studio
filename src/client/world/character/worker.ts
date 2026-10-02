import * as THREE from 'three';
import type { AgentProvider, Theme, WorkerAction, WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { isAsleep, type WorkerPr } from '../../../shared/status';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from '../toon';
import type { WorkerRig } from './rig';
import { ease, popIn } from './curves';
import { undress } from './props';
import { ACT_MIN, DESPAIR_MIN, TWIRL_TIME, WAIT_CYCLE, WAIT_HOPS, blendStance, type Act, type Stance } from './worker-stance';
import { bubbleFor } from './worker-badges';
import { globe, papers } from './worker-props';
import { DANCE, groove, type Dancing, type Stage } from './worker-dance';
import { packUp, waddle, type Leaving } from './worker-leave';
import { dressUp } from './worker-dress';
import { Antenna } from './worker-antenna';

/** The little Claude worker that sits at a desk. Forward is +z. */
export class Worker {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  /** Its moving parts, for what poses them from the other files here (a dance, a cell, a costume). */
  private rig: WorkerRig;
  /** Its antenna: the stalk, its status light, and on that the emblem of what it runs on (see worker-antenna.ts). */
  private antenna = new Antenna(this.body);
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private bubble: THREE.Sprite | null = null;
  private bubbleKey = '';
  /** The bubble is a task card: it hangs from its tail instead of floating. */
  private bubbleIsCard = false;
  private task: WorkerTask | undefined;
  /** Its pull request, open or merged: its bubble is outlined (and labelled, while it rests) to match. */
  private pr: WorkerPr | undefined;
  /** Its worktree was deleted outside the office (WorkerInfo.lost): its bubble says so until it's fixed. */
  private lost = false;
  private nameTag: THREE.Sprite | null = null;
  private eyes: THREE.Mesh[] = [];
  private blinkAt = Math.random() * 4;
  status: WorkerStatus = 'starting';
  bouncing = false;
  /** You're close enough to read its card: it lands the hop it's in and stands still until you walk away. */
  held = false;
  private bounceT = 0;
  private spawnT = 0;
  /** Seconds left jumping for joy (its pull request just merged). */
  private cheerT = 0;
  /** Up on its desk dancing (a pull request merged): where, and how many seconds in. */
  private dancing: Dancing | null = null;
  private pupils: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  /** Sent home: the box of its things in its arms, and how far into its waddle it is. */
  private leaving: Leaving | null = null;
  /** On its way out (sent home) or in (called to a meeting): it waddles along instead of standing. */
  walking = false;
  /** What its latest tool call was (see setAction), and what it's acting out right now. */
  private nextAction: WorkerAction | undefined;
  private action: WorkerAction | undefined;
  private actionT = 0;
  /** How much of each act is in its stance right now, blending from one to the next. */
  private acts = new Map<Act, number>();
  private stance = {} as Stance;
  private blend = {} as Stance;
  /** Seconds it has been waiting on you, for the jump / tap-its-foot cycle. */
  private waitT = 0;
  private turnY = 0;
  /** Seconds into its finishing spin, or -1. */
  private twirlT = -1;
  private flipT = 0;
  private papers: ReturnType<typeof papers>;
  private globe: ReturnType<typeof globe>;
  /** Beside its laptop, where the globe floats (see setPropSpot). */
  private spot = new THREE.Vector3(-1, 1.1, 1.3);
  private skin: THREE.MeshToonMaterial;
  /** Dressed up for a holiday (see setCostume), and what it's wearing. */
  private costume: Theme | null = null;
  private outfit: THREE.Object3D[] = [];
  /** How far through its stride it is, walking in. */
  private stride = 0;

  constructor(
    name: string,
    private color: string,
  ) {
    const skin = (this.skin = toonUnique(color));
    const white = toon('#ffffff');
    const ink = toon('#1d1d1d');

    this.root.add(this.body);
    // Bean-shaped body
    const bean = mesh(new THREE.CapsuleGeometry(0.28, 0.3, 8, 16), skin, 0, 0.55, 0);
    this.body.add(bean);
    // Big cartoon eyes
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.09, 12, 10), white, sx * 0.11, 0.7, 0.23, false);
      eye.scale.z = 0.6;
      this.body.add(eye);
      const pupil = mesh(new THREE.SphereGeometry(0.045, 10, 8), ink, sx * 0.11, 0.7, 0.29, false);
      this.body.add(pupil);
      this.eyes.push(eye, pupil);
      this.pupils.push(pupil);
    }
    // Headset: band + mic
    const band = mesh(new THREE.TorusGeometry(0.29, 0.025, 6, 20, Math.PI), toon('#2b2d42'), 0, 0.72, 0, false);
    band.rotation.y = Math.PI / 2;
    this.body.add(band);
    for (const sx of [-1, 1]) this.body.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), toon('#2b2d42'), sx * 0.29, 0.72, 0, false));

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.55, 0.05);
      pivot.add(mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), skin, 0, -0.12, 0));
      this.body.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.3);
    this.armR = arm(0.3);
    for (const sx of [-1, 1]) {
      const foot = mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), skin, sx * 0.12, 0.2, 0.05);
      this.body.add(foot);
      this.feet.push(foot);
    }

    // What it acts out with: papers in its hands, and a globe beside its laptop.
    this.papers = papers();
    this.papers.group.position.set(0, 0.86, 0.4);
    this.papers.group.rotation.x = 0.35;
    this.body.add(this.papers.group);
    this.globe = globe();
    for (const prop of [this.papers.group, this.globe.group]) prop.visible = false;
    this.root.add(this.globe.group);

    this.rig = { root: this.root, body: this.body, skin: this.skin, armL: this.armL, armR: this.armR, feet: this.feet, pupils: this.pupils, bulb: this.antenna.bulb, bulbMesh: this.antenna.light, props: [this.papers.group, this.globe.group] };
    this.setName(name);
  }

  /** Where the globe floats, in its own space: beside its laptop, where the card over its head doesn't hide it. */
  setPropSpot(at: THREE.Vector3) {
    this.spot.copy(at);
  }

  /** What it runs on, which the emblem on its antenna shows: none (a shared shell, the bartender) wears the plain one. */
  setProvider(provider: AgentProvider | undefined) {
    this.antenna.wear(provider);
  }

  /** What its latest tool call was, to act out while it's working. */
  setAction(action: WorkerAction | undefined) {
    this.nextAction = action;
  }

  /** Just finished: a quick spin and a hop. */
  celebrate() {
    this.twirlT = 0;
    this.cheer(1.2);
  }

  /** Dresses it up for a holiday (an elf for Christmas), or back in its own skin (null). */
  setCostume(theme: Theme | null) {
    if (theme === this.costume) return;
    this.costume = theme;
    undress(this.outfit);
    dressUp(this.rig, theme, this.color, this.outfit);
  }

  setName(name: string) {
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      disposeSprite(this.nameTag);
    }
    this.nameTag = textSprite(name, { bg: '#2b2d42', color: '#fffaf3', size: 36, border: '#fffaf3' });
    this.nameTag.position.y = 1.55;
    this.root.add(this.nameTag);
  }

  setStatus(status: WorkerStatus, bounce: boolean) {
    this.status = status;
    this.bouncing = bounce;
    if (!this.dancing) this.antenna.paint(status);
    this.drawBubble();
  }

  /** Jumps for joy, arms up, for a few seconds. */
  cheer(seconds = 3) {
    this.cheerT = seconds;
  }

  /**
   * Hops up on to `stage` (its desk), dances for a few seconds with its light flashing like a disco
   * ball, and hops back down into its seat. Asked again mid-dance, it stays up and dances on.
   */
  dance(stage: Stage) {
    if (this.leaving) return;
    const d = this.dancing;
    if (!d) {
      this.dancing = { stage, t: 0 };
      // The dance has a twirl of its own, so a finishing spin it cut into doesn't play after it.
      this.twirlT = -1;
    } else if (d.t > DANCE.up + DANCE.moves) {
      // On its way down: back up from wherever it is in the air.
      d.t = DANCE.up * (1 - (d.t - DANCE.up - DANCE.moves) / DANCE.down);
    } else d.t = Math.min(d.t, DANCE.up);
  }

  /** Back in its seat at once, mid-dance or not (it's being sent home). */
  stopDancing() {
    if (!this.dancing) return;
    this.dancing = null;
    this.settle();
  }

  /** What it's working on, shown on a card over its head in place of the status bubble. */
  setTask(task: WorkerTask | undefined) {
    this.task = task;
    this.drawBubble();
  }

  setPr(pr: WorkerPr | undefined) {
    this.pr = pr;
    this.drawBubble();
  }

  setLost(lost: boolean) {
    this.lost = lost;
    this.drawBubble();
  }

  /** Sent home: its light goes out, its face falls, and its things pop into a box in its arms. `farewell` goes over its head. */
  leave(farewell: string) {
    if (this.leaving) return;
    this.bouncing = false;
    this.cheerT = 0;
    this.bounceT = 0;
    this.twirlT = -1;
    for (const prop of [this.papers.group, this.globe.group]) prop.visible = false;
    this.armL.position.set(-0.3, 0.55, 0.05);
    this.armR.position.set(0.3, 0.55, 0.05);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2, 0.05));
    for (const p of this.pupils) p.position.y = 0.7;
    this.antenna.dark();
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubbleKey = 'leaving';
    this.bubbleIsCard = false;
    this.bubble = textSprite(farewell, { bg: '#e9ecef', size: 34 });
    this.root.add(this.bubble);
    this.leaving = { box: packUp(this.rig), boxT: 0, stride: 0 };
  }

  /** On its way out: says something else over its head in place of its farewell (or whatever was over it, before it packed up). */
  say(text: string) {
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubbleKey = 'said';
    this.bubbleIsCard = false;
    this.bubble = textSprite(text, { bg: '#e9ecef', size: 34 });
    if (!this.leaving) this.bubble.position.y = 1.95;
    this.root.add(this.bubble);
  }

  private drawBubble() {
    if (this.leaving) return;
    const { status, bouncing: bounce, task, pr, lost } = this;
    const { key, draw } = bubbleFor(status, bounce, task, pr, lost);
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
      this.bubble = null;
    }
    this.bubbleIsCard = !!task;
    this.bubble = draw();
    if (this.bubble) this.root.add(this.bubble);
  }

  update(dt: number, t: number) {
    // Its emblem stands still once it's packing, and spins as if at work through a dance.
    this.antenna.update(dt, t, this.leaving ? 'exited' : this.dancing ? 'working' : this.status);
    if (this.leaving) return this.carry(this.leaving, dt, t);
    if (this.dancing) return this.boogie(this.dancing, dt, t);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // Waiting on you: a couple of seconds of jumping, then arms crossed and a tapping foot, and round again.
    this.waitT = this.status === 'needs_input' ? this.waitT + dt : 0;
    const tapping = this.status === 'needs_input' && (this.held || this.waitT % WAIT_CYCLE >= WAIT_HOPS);
    // Jump up and down when done / waiting on a human (except while held or tapping), or cheering.
    if (this.bouncing || this.cheerT > 0) {
      const landAt = Math.ceil(this.bounceT / Math.PI) * Math.PI;
      this.bounceT += dt * 7;
      if ((this.held || tapping) && !this.cheerT && this.bounceT >= landAt) this.bounceT = 0;
    } else this.bounceT = 0;
    const hopping = this.bounceT > 0;
    // Pop-in when hired
    this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.35 : 1;

    this.actionT += dt;
    if (this.nextAction !== this.action && this.actionT >= (this.action === 'failing' ? DESPAIR_MIN : ACT_MIN)) {
      this.action = this.nextAction;
      this.actionT = 0;
    }
    const act: Act =
      hopping || (this.bouncing && this.status === 'done') ? 'up'
      : this.status === 'needs_input' ? 'waiting'
      : this.status === 'working' ? (this.action ?? 'type')
      : 'rest';
    const s = this.pose(act, dt, t);

    this.armL.rotation.set(s.armLx, 0, s.armLz);
    this.armR.rotation.set(s.armRx, 0, s.armRz);
    this.armL.position.set(-0.3 + s.reach * 0.07, 0.55 - s.drop, 0.05 + s.reach * 0.12);
    this.armR.position.set(0.3 - s.reach * 0.07, 0.55 - s.drop + s.reach * 0.04, 0.05 + s.reach * 0.14);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2 + (i ? s.tap * 0.07 : 0), 0.05 + s.kick + (i ? s.tap * 0.03 : 0)));
    for (const p of this.pupils) p.position.y = 0.7 + s.look;
    this.body.rotation.x = s.lean;
    let twirl = 0;
    if (this.twirlT >= 0) {
      this.twirlT += dt;
      twirl = ease(Math.min(1, this.twirlT / TWIRL_TIME)) * Math.PI * 2;
      if (this.twirlT >= TWIRL_TIME) this.twirlT = -1;
    }
    if (hopping) {
      const h = Math.abs(Math.sin(this.bounceT));
      this.body.position.y = h * 0.55;
      const squash = h < 0.15 ? 1 - (0.15 - h) * 1.6 : 1;
      this.body.scale.set(pop * (2 - squash), pop * squash, pop * (2 - squash));
      this.turnY = Math.sin(this.bounceT * 0.5) * 0.3;
    } else {
      this.body.position.y = s.lift;
      this.body.scale.setScalar(pop);
      this.turnY += (s.turn - this.turnY) * Math.min(1, dt * 6);
    }
    this.body.rotation.y = this.turnY + twirl;
    this.body.rotation.z = isAsleep(this.status) ? Math.sin(t * 1.5) * 0.08 : s.roll;
    this.props(dt, t);
    this.blink(dt, s.lid);
    if (this.bubble) this.bubble.position.y = (this.bubbleIsCard ? 1.74 : 1.95) + (hopping ? this.body.position.y : 0) + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + (hopping ? this.body.position.y : 0);
    // Walking in to a meeting: the same waddle as on the way out, without the box.
    if (this.walking || this.stride) {
      this.stride = this.walking ? this.stride + dt * 9 : 0;
      const s = Math.sin(this.stride);
      this.feet.forEach((f, i) => {
        const step = i ? -s : s;
        f.position.z = 0.05 + step * 0.08;
        f.position.y = 0.2 + Math.max(0, step) * 0.05;
      });
      this.body.position.y += Math.abs(s) * 0.05;
      this.body.rotation.z = s * 0.1;
    }
  }

  /** Eases toward `act`'s stance, out of whatever it was doing before. */
  private pose(act: Act, dt: number, t: number): Stance {
    return blendStance(this.acts, act, dt, t, this.stance, this.blend);
  }

  /** The papers and the globe come and go with the act they belong to. */
  private props(dt: number, t: number) {
    const show = (prop: THREE.Object3D, act: Act) => {
      const w = this.acts.get(act) ?? 0;
      prop.visible = w > 0.02;
      if (prop.visible) prop.scale.setScalar(Math.max(0.001, popIn(w)));
      return prop.visible;
    };
    if (show(this.papers.group, 'read')) {
      // A page every second or so, flipped up and over the top.
      this.flipT = (this.flipT + dt) % 1.1;
      const f = Math.min(1, this.flipT / 0.45);
      this.papers.page.rotation.x = -ease(f) * Math.PI * 1.1;
      this.papers.page.visible = f < 1;
    }
    if (show(this.globe.group, 'web')) {
      this.globe.group.position.copy(this.spot).y += Math.sin(t * 2) * 0.03;
      this.globe.ball.rotation.y = t * 2.2;
      this.globe.ring.rotation.z = t * 0.6;
    }
  }

  /** Sent home: head hung, the box in its arms, waddling along while `walking`. */
  private carry(l: NonNullable<Worker['leaving']>, dt: number, t: number) {
    waddle(this.rig, l, this.walking, dt);
    this.blink(dt);
    if (this.bubble) this.bubble.position.y = 1.95 + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55;
  }

  /** Up on the desk dancing: hop up, groove side to side, twirl, jump twice, hop back down. */
  private boogie(d: NonNullable<Worker['dancing']>, dt: number, t: number): void {
    d.t += dt;
    const { up, moves, down } = DANCE;
    if (d.t >= up + moves + down) {
      this.dancing = null;
      this.settle();
      return this.update(0, t);
    }
    const lift = groove(this.rig, d, dt, t);
    this.blink(dt);
    if (this.bubble) this.bubble.position.y = (this.bubbleIsCard ? 1.74 : 1.95) + lift + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + lift;
  }

  /** Back in its seat, standing straight, its light showing its status again. */
  private settle() {
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);
    for (const a of [this.armL, this.armR]) a.rotation.z = 0;
    for (const f of this.feet) f.position.set(f.position.x, 0.2, 0.05);
    this.antenna.paint(this.status);
  }

  /** `lid` narrows the eyes (1 = wide open) between blinks. */
  private blink(dt: number, lid = 1) {
    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.1 : lid;
  }

  dispose() {
    if (this.bubble) disposeSprite(this.bubble);
    if (this.nameTag) disposeSprite(this.nameTag);
    undress(this.outfit);
  }
}
