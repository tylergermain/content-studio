import * as THREE from 'three';
import { HOLES } from '../../../shared/minigolf/course';
import { BALL_R } from '../../../shared/minigolf/types';
import { isTyping, type PlayerController } from '../../player';
import { $, h, modalOpen } from '../../ui/dom';
import type { Person } from '../../world/character';
import { distText, feltAt, meterAt, nth, stanceAt, wrapAngle, yawTo } from './play';

// Putting (E at your ball on your turn): you stand side on to the ball with the putter, and the camera
// stands back along the line behind it. The mouse (or A and D) aims, with a dotted line on the felt
// the first 1.2 m of the way; holding Space runs the meter up and back down, golf's way (PUTT_METER):
// let go to putt. The office rolls it and everyone's page plays the path; the camera follows the ball
// until it stops, then you're over it again if it's still your turn, or stepping away if it isn't.

export type PutterStage = 'aim' | 'charge' | 'watch';

/** A and D (and the arrow keys) turn the aim this fast, in radians a second. */
const TURN = 0.5;
/** Let go with the meter under this and it's no putt at all: Space only tapped. */
const MIN_POWER = 0.004;
/** The aim line on the felt: this long, a dot every so far. */
const AIM_LINE = 1.2;
const DOTS = 12;
/**
 * Behind the ball along the line while aiming, and up, and a little to the side away from you so you
 * don't stand in your own way; then following it, back and up.
 */
const AIM_BACK = 2.6;
const AIM_UP = 1.4;
const AIM_SIDE = 0.55;
const CHASE_BACK = 3;
const CHASE_UP = 2;
/** How long the camera stays on a ball that's stopped, before you're over it again (or stepping away), in seconds. */
const LINGER = 1.1;
const LINGER_DONE = 2.2;
/** No putt back from the office this long after sending one (ms): it wasn't taken (not your turn, too far from the ball). */
const NO_ANSWER = 2500;

export interface PutterHooks {
  /** Putt it now: `yaw` and `power` (0..1). */
  stroke(yaw: number, power: number): void;
  /** Your ball's middle as it's drawn, in the street frame, or null when it isn't out. */
  ball(): THREE.Vector3 | null;
  /** Your putt being played out, if there is one: the putt, how far in, which way it's going, and whether it's over. */
  rolling(): { roll: { holed: boolean }; t: number; heading: number | null; over: boolean } | null;
  /** Whether it's still your turn, with your ball out to putt. */
  stillUp(): boolean;
  /** Strokes you've taken on this hole so far. */
  taken(): number;
  /** How far down the street is from your floor (see streetBelow). */
  street(): number;
  /** The putter's back on the rack: you've stepped away. */
  done(): void;
}

const lookAt = new THREE.Matrix4();
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const spot = { x: 0, z: 0, facing: 0 };

export class Putter {
  private stage: PutterStage | null = null;
  /** The hole being putted on (0..8), and where the ball was when you stood over it. */
  hole = 0;
  private readonly at = new THREE.Vector3();
  /** Which way you aim: a heading, 0 down +z. */
  aim = 0;
  /** When the meter started running (performance.now()), while Space is held. */
  private chargeAt = 0;
  /** How hard the last putt was, marked on the meter. */
  private lastPower = -1;
  /** When the last putt was sent (performance.now()), and how long the ball's been still since. */
  private sentAt = 0;
  private still = -1;
  /** The camera's own place and turn, while it's the putting camera, and the way the ball last went. */
  private readonly camPos = new THREE.Vector3();
  private readonly camQuat = new THREE.Quaternion();
  private heading = 0;
  /** The dotted aim line, in the course's group (the street frame). */
  readonly line = new THREE.Group();
  private readonly panel: HTMLElement;
  private readonly rest: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly info: HTMLElement;
  private readonly title: HTMLElement;
  /** What the panel's words were last written for: '' to write them again. */
  private shown = '';
  private shownTaken = -1;
  /** How full the meter was last drawn. */
  private drawnPower = -1;

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hooks: PutterHooks,
  ) {
    this.rest = h('span.putt-rest');
    this.mark = h('span.putt-last');
    this.info = h('div.putt-info');
    this.title = h('div.putt-title');
    this.panel = h('div.putt-meter.panel.hidden', { 'aria-label': 'Putting' }, this.title, h('div.putt-bar', {}, this.rest, this.mark), this.info);
    $('hud').append(this.panel);
    const dot = new THREE.CircleGeometry(0.014, 10).rotateX(-Math.PI / 2);
    const white = new THREE.MeshBasicMaterial({ color: '#fffaf3', transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < DOTS; i++) this.line.add(new THREE.Mesh(dot, white));
    this.line.visible = false;
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // Tabbed away mid-putt: the key never comes back up, so it's no putt.
    window.addEventListener('blur', () => this.letGo());
  }

  get active(): boolean {
    return this.stage !== null;
  }

  get doing(): PutterStage | null {
    return this.stage;
  }

  /** How full the meter is right now (0..1), while Space is held. */
  get power(): number {
    return this.stage === 'charge' ? meterAt((performance.now() - this.chargeAt) / 1000) : 0;
  }

  /** Over your ball on hole `hole` (0..8) with the putter, aiming at the cup. */
  start(hole: number): boolean {
    const ball = this.hooks.ball();
    if (this.stage || !ball || !HOLES[hole]) return false;
    this.hole = hole;
    this.overBall(ball);
    const p = this.player;
    p.rig = () => this.stand();
    this.stand();
    p.camYaw = this.aim + Math.PI;
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.me.setGolf(true, 'putter');
    this.panel.classList.remove('hidden');
    this.shown = '';
    return true;
  }

  /** The putter back, and you on your feet where you stood. */
  stop(): void {
    if (!this.stage) return;
    this.stage = null;
    const p = this.player;
    p.rig = null;
    p.lookPitch = -0.08;
    // In third person, the camera goes round behind you.
    if (p.view === 'third') p.camYaw = p.facing + Math.PI;
    this.me.setGolf(false);
    this.line.visible = false;
    this.panel.classList.add('hidden');
    this.hooks.done();
  }

  /** A window opened, or the tab lost the keys, mid-putt: the putter goes back down, no putt. */
  letGo(): void {
    if (this.stage !== 'charge') return;
    this.stage = 'aim';
    this.me.golfBack(0);
  }

  /** Every frame, once the player has moved: aiming, the meter, watching the ball, and the camera. */
  update(dt: number): void {
    if (!this.stage) return;
    const p = this.player;
    if (this.stage === 'aim' || this.stage === 'charge') {
      // The mouse turns your view as it always does (camYaw); that's the aim, along with the keys.
      let aim = wrapAngle(p.camYaw - Math.PI);
      if (p.holding('KeyA', 'ArrowLeft')) aim += TURN * dt;
      if (p.holding('KeyD', 'ArrowRight')) aim -= TURN * dt;
      this.aim = wrapAngle(aim);
      p.camYaw = this.aim + Math.PI;
    }
    if (this.stage === 'charge') this.me.golfBack(0.15 + 0.2 * this.power);
    if (this.stage === 'watch') this.watch(dt);
    if (!this.stage) return;
    this.placeLine();
    this.placeCamera(dt);
    this.render();
  }

  /** Watching your putt: the office not answering, the ball still going, or stopped (and then what's next). */
  private watch(dt: number) {
    const roll = this.hooks.rolling();
    if (!roll) {
      if (performance.now() - this.sentAt > NO_ANSWER) this.stage = 'aim';
      return;
    }
    if (roll.heading !== null) this.heading = roll.heading;
    if (!roll.over) return;
    this.still += dt;
    if (this.still < (roll.roll.holed || !this.hooks.stillUp() ? LINGER_DONE : LINGER)) return;
    const ball = this.hooks.ball();
    if (!this.hooks.stillUp() || !ball) return this.stop();
    // Still your turn: over the ball where it stopped.
    this.overBall(ball);
  }

  /** Stood over the ball at `ball` (its middle, street frame), aiming at the cup. */
  private overBall(ball: THREE.Vector3) {
    this.stage = 'aim';
    this.still = -1;
    this.at.copy(ball);
    this.aim = yawTo(this.at, HOLES[this.hole].cup);
    this.player.camYaw = this.aim + Math.PI;
    this.shown = '';
  }

  /**
   * Where you stand for the aim you've got: side on to the line, STANCE from the ball, on the felt
   * there, or level with the ball where there's none (beside a raised green, your feet by its edge).
   */
  private stand() {
    const s = stanceAt(this.at, this.aim, spot);
    const p = this.player;
    const under = feltAt(HOLES[this.hole], s.x, s.z) ?? this.at.y - BALL_R;
    p.pos.set(s.x, this.hooks.street() + Math.max(under, 0), s.z);
    p.facing = s.facing;
    p.moving = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.stage || e.code !== 'Space') return;
    if (down && (e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down && this.stage === 'aim') {
      this.stage = 'charge';
      this.chargeAt = performance.now();
    } else if (!down && this.stage === 'charge') {
      const power = this.power;
      if (power < MIN_POWER) return this.letGo();
      this.lastPower = power;
      this.stage = 'watch';
      this.sentAt = performance.now();
      this.still = 0;
      this.heading = this.aim;
      this.me.golfHit();
      this.hooks.stroke(this.aim, power);
    }
  }

  /** The dotted line from the ball the way you're aiming, on the felt, while you aim. */
  private placeLine() {
    const on = this.stage === 'aim' || this.stage === 'charge';
    this.line.visible = on;
    if (!on) return;
    const hole = HOLES[this.hole];
    const dx = Math.sin(this.aim);
    const dz = Math.cos(this.aim);
    const dots = this.line.children;
    for (let i = 0; i < dots.length; i++) {
      const d = 0.12 + (i * AIM_LINE) / DOTS;
      const x = this.at.x + dx * d;
      const z = this.at.z + dz * d;
      const y = feltAt(hole, x, z);
      dots[i].visible = y !== null;
      dots[i].position.set(x, (y ?? 0) + 0.006, z);
    }
  }

  private placeCamera(dt: number) {
    const street = this.hooks.street();
    const ball = this.stage === 'watch' ? this.hooks.ball() : null;
    if (ball) {
      // Following it: behind it the way it's going, and up, looking at it.
      const yaw = this.heading;
      want.set(ball.x - Math.sin(yaw) * CHASE_BACK, street + ball.y + CHASE_UP, ball.z - Math.cos(yaw) * CHASE_BACK);
      target.set(ball.x, street + ball.y, ball.z);
    } else {
      // Behind the ball along the line, and up: the ball low in the view, the line out ahead of it.
      const sin = Math.sin(this.aim);
      const cos = Math.cos(this.aim);
      // You stand to the line's left (see stanceAt): the camera's off to its right.
      want.set(this.at.x - sin * AIM_BACK - cos * AIM_SIDE, street + this.at.y + AIM_UP, this.at.z - cos * AIM_BACK + sin * AIM_SIDE);
      target.set(this.at.x + sin * 1.6, street + this.at.y - BALL_R, this.at.z + cos * 1.6);
    }
    const k = 1 - Math.exp(-dt * (ball ? 4 : 7));
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  /** The meter, which stroke this is and how far the cup is. */
  private render() {
    const power = this.stage === 'charge' ? this.power : this.stage === 'aim' ? 0 : this.lastPower;
    if (power !== this.drawnPower) {
      this.drawnPower = power;
      this.rest.style.width = `${(1 - Math.max(0, power)) * 100}%`;
    }
    const taken = this.hooks.taken();
    // The words change only with the stroke and where the ball is.
    if (taken === this.shownTaken && this.shown) return;
    this.shownTaken = taken;
    this.mark.style.left = `${this.lastPower * 100}%`;
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    const hole = HOLES[this.hole];
    const cup = Math.hypot(hole.cup.x - this.at.x, hole.cup.z - this.at.z);
    this.shown = `${hole.n}`;
    this.title.textContent = `⛳ Hole ${hole.n} · ${hole.name} · Par ${hole.par}`;
    this.info.textContent = `${nth(taken + 1)} stroke · ${distText(cup)} to the cup`;
  }
}
