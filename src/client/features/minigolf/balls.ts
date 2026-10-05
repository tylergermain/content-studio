import * as THREE from 'three';
import { HOLES } from '../../../shared/minigolf/course';
import { teeBall } from '../../../shared/minigolf/physics';
import { BALL_R } from '../../../shared/minigolf/types';
import { PUTT_RULES, type PuttEvent, type PuttRoll, type PuttRound } from '../../../shared/protocol';
import { disposeSprite, mesh, textSprite, toon } from '../../world/toon';
import { ballOf, headingAt, pathAt, rollSeconds, turnOf } from './play';

// Everyone's balls out on Putt Street, every round's, in their players' colors: where the office says
// each one lies, and a putt played back along the path the office sent, on the office's clock (so it
// goes through the windmill's sails when they're open on screen too), never rolled here. A putt that
// came late is played from where it has got to. The one whose turn it is has their name over their
// ball. Drawn in the course's group, so in the street frame: y 0 the street.

/** What a putt does along the way, for its sounds: `at` is where (street frame), `amount` how hard. */
export type BallEvent = PuttEvent | 'tock' | 'ace';

/** A sound that's this late (ms) isn't played: the putt came in late and has got past it. */
const STALE = 300;
/** After the path ends: a ball moved a club length hops there, one in the water or off the felt is back where it was putted from after this long (s). */
const HOP = 0.5;
const BACK = 1.1;

interface Ball {
  mesh: THREE.Mesh;
  color: string;
  /** Still in a round, this frame. */
  seen: boolean;
}

interface Played {
  roll: PuttRoll;
  /** Seconds the path lasts, and the next of its events still to sound. */
  seconds: number;
  next: number;
  struck: boolean;
}

const ballGeo = new THREE.SphereGeometry(BALL_R, 16, 12);
/** Each hole's ball on its tee, worked out once. */
const TEED = HOLES.map((h) => teeBall(h));
const at = new THREE.Vector3();
const end = new THREE.Vector3();

export class PuttBalls {
  readonly group = new THREE.Group();
  private readonly balls = new Map<string, Ball>();
  private readonly played = new Map<string, Played>();
  private readonly labels = new Map<string, THREE.Sprite>();
  /** Whose ball has their name over it, and the name it has. */
  private labelled: { id: string; name: string; sprite: THREE.Sprite } | null = null;
  /** Your own id, and whether your name is kept off your ball (you're over it with the putter). */
  you = '';
  quiet = false;
  /** A putt hit something, or was struck, or dropped (`mine`: it's your ball). */
  onEvent: ((kind: BallEvent, at: THREE.Vector3, amount: number, mine: boolean, roll: PuttRoll) => void) | null = null;

  /** Where the ball of player `id` is drawn now (street frame, its middle), if it's out. */
  ballAt(id: string): THREE.Vector3 | null {
    const b = this.balls.get(id);
    return b && b.mesh.visible ? b.mesh.position : null;
  }

  /** Whether round `round`'s last putt is still being played out here at office time `now` (seconds included for a hop or a drop back). */
  rolling(round: string, now: number): boolean {
    const p = this.played.get(round);
    return !!p && now < p.roll.startAt + (p.seconds + after(p.roll)) * 1000;
  }

  /** What `mine` hands back, the same one each time (it's asked every frame). */
  private readonly yours: { roll: PuttRoll | null; t: number; heading: number | null; over: boolean } = { roll: null, t: 0, heading: null, over: false };

  /**
   * Your putt being played out now, for the camera to follow: its path's `t` seconds in, which way it's
   * going, and whether it's over. The same object every time, filled in afresh: read it straight away.
   */
  mine(round: string, now: number): { roll: PuttRoll; t: number; heading: number | null; over: boolean } | null {
    const p = this.played.get(round);
    if (!p || p.roll.id !== this.you) return null;
    const y = this.yours;
    y.roll = p.roll;
    y.t = (now - p.roll.startAt) / 1000;
    y.heading = headingAt(p.roll.path, Math.min(y.t, p.seconds));
    y.over = y.t > p.seconds + after(p.roll);
    return y as { roll: PuttRoll; t: number; heading: number | null; over: boolean };
  }

  /** Each frame: every round's balls where they are at office time `now`, and the sounds of any putt that's going. */
  update(now: number, rounds: readonly PuttRound[], rolls: ReadonlyMap<string, PuttRoll>) {
    for (const b of this.balls.values()) b.seen = false;
    let labelId: string | null = null;
    let labelName = '';
    let labelBall: THREE.Mesh | null = null;
    for (const r of rounds) {
      const roll = rolls.get(r.id);
      const play = roll ? this.playing(r.id, roll) : null;
      const up = turnOf(r);
      for (const p of r.players) {
        const ball = this.ball(p.id, p.color);
        ball.seen = true;
        const live = play && play.roll.id === p.id ? this.place(play, now, ball.mesh) : false;
        if (!live) {
          const lies = ballOf(r, p, TEED[r.hole] ?? null);
          ball.mesh.visible = !!lies;
          if (lies) ball.mesh.position.set(lies.x, lies.y + BALL_R, lies.z);
        }
        if (ball.mesh.visible && (live || up === p) && !(this.quiet && p.id === this.you)) {
          labelId = p.id;
          labelName = p.name;
          labelBall = ball.mesh;
        }
      }
    }
    // Balls of people no longer in a round are picked up.
    for (const [id, b] of this.balls) {
      if (b.seen) continue;
      this.group.remove(b.mesh);
      this.balls.delete(id);
    }
    for (const id of this.played.keys()) if (!hasRound(rounds, id)) this.played.delete(id);
    this.label(labelId, labelName, labelBall);
  }

  /** The playing-out of round `round`'s latest putt, started over when a new one comes. */
  private playing(round: string, roll: PuttRoll): Played {
    let p = this.played.get(round);
    if (!p || p.roll !== roll) {
      p = { roll, seconds: rollSeconds(roll.path), next: 0, struck: false };
      this.played.set(round, p);
    }
    return p;
  }

  /**
   * Puts `ball` where the putt `p` has it at office time `now`, sounding what it's got to on the way;
   * false once it's all played out (then the ball's where the round says it lies).
   */
  private place(p: Played, now: number, ball: THREE.Mesh): boolean {
    const { roll } = p;
    const t = (now - roll.startAt) / 1000;
    if (t > p.seconds + after(roll)) return false;
    const mine = roll.id === this.you;
    if (!p.struck && t >= 0) {
      p.struck = true;
      if (t * 1000 < STALE) this.emit('tock', pathAt(roll.path, 0, at), roll.power, mine, roll);
    }
    while (p.next < roll.events.length && roll.events[p.next][0] <= t) {
      const [et, kind] = roll.events[p.next++];
      if ((t - et) * 1000 > STALE) continue;
      this.emit(kind, pathAt(roll.path, et, at), speedAt(roll.path, et), mine, roll);
      if (kind === 'cup' && roll.holed && roll.taken === 1) this.emit('ace', at, 1, mine, roll);
    }
    ball.visible = true;
    if (t <= p.seconds) {
      pathAt(roll.path, t, ball.position).y += BALL_R;
      // In the cup, it drops out of sight at the end.
      if (roll.holed && t >= p.seconds - 1 / 30) ball.visible = false;
      return true;
    }
    const k = (t - p.seconds) / after(roll);
    pathAt(roll.path, p.seconds, end);
    if (roll.holed) ball.visible = false;
    else if (roll.out) {
      // Gone in the water (or off the felt) for a moment, then back where it was putted from.
      ball.visible = k > 0.7;
      ball.position.set(roll.rest.x, roll.rest.y + BALL_R + (1 - k) * 0.6, roll.rest.z);
    } else if (roll.moved) {
      // Picked up and put down a club length away: a little hop over to it.
      ball.position.set(end.x + (roll.rest.x - end.x) * k, end.y + (roll.rest.y - end.y) * k + BALL_R + Math.sin(k * Math.PI) * 0.35, end.z + (roll.rest.z - end.z) * k);
    } else ball.position.set(roll.rest.x, roll.rest.y + BALL_R, roll.rest.z);
    return true;
  }

  private emit(kind: BallEvent, where: THREE.Vector3, amount: number, mine: boolean, roll: PuttRoll) {
    this.onEvent?.(kind, where, amount, mine, roll);
  }

  /** Player `id`'s ball, made the first time it's wanted, in `color`. */
  private ball(id: string, color: string): Ball {
    let b = this.balls.get(id);
    if (b && b.color !== color) {
      b.mesh.material = toon(color);
      b.color = color;
    }
    if (!b) {
      b = { mesh: mesh(ballGeo, toon(color), 0, 0, 0, true), color, seen: true };
      b.mesh.visible = false;
      this.group.add(b.mesh);
      this.balls.set(id, b);
    }
    return b;
  }

  /** Puts the name card over the ball of whoever's putting (player `id`, called `name`, their ball `ball`), or takes it down. */
  private label(id: string | null, name: string, ball: THREE.Mesh | null) {
    if (this.labelled && (!id || this.labelled.id !== id || this.labelled.name !== name)) {
      this.group.remove(this.labelled.sprite);
      this.labelled = null;
    }
    if (!id || !ball) return;
    if (!this.labelled) {
      let sprite = this.labels.get(id);
      if (sprite && sprite.userData.name !== name) {
        disposeSprite(sprite);
        sprite = undefined;
      }
      if (!sprite) {
        sprite = textSprite(`⛳ ${name}`, { bg: '#2b2d42', color: '#fffaf3', size: 40 });
        sprite.scale.multiplyScalar(0.7);
        sprite.center.set(0.5, 0);
        sprite.userData.name = name;
        this.labels.set(id, sprite);
      }
      this.labelled = { id, name, sprite };
      this.group.add(sprite);
    }
    this.labelled.sprite.position.copy(ball.position).y += 0.32;
  }

  /** Everything put away (the floor's gone). */
  clear() {
    for (const b of this.balls.values()) this.group.remove(b.mesh);
    this.balls.clear();
    this.played.clear();
    for (const s of this.labels.values()) disposeSprite(s);
    this.labels.clear();
    if (this.labelled) this.group.remove(this.labelled.sprite);
    this.labelled = null;
  }
}

/** Whether round `id` is among `rounds`. */
function hasRound(rounds: readonly PuttRound[], id: string): boolean {
  for (const r of rounds) if (r.id === id) return true;
  return false;
}

/** How long after its path ends a putt is still being played out: a hop a club length, or a drop back to where it was putted from. */
function after(roll: PuttRoll): number {
  return roll.out ? BACK : roll.moved ? HOP : 0;
}

/** How fast the ball's going `t` seconds along `path` (m/s), for how hard what it hits sounds. */
function speedAt(path: ArrayLike<number>, t: number): number {
  const i = Math.max(1, Math.min(Math.floor(path.length / 3) - 1, Math.round(t * PUTT_RULES.samples)));
  const dx = path[i * 3] - path[(i - 1) * 3];
  const dz = path[i * 3 + 2] - path[(i - 1) * 3 + 2];
  return Math.min(8, Math.hypot(dx, dz) * PUTT_RULES.samples);
}
