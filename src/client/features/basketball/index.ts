/**
 * The floor's basketball, by the hoop on the west wall: picking it up, winding up a shot (the meter)
 * and letting it fly, baskets and streaks, and the ball in everyone's hands.
 */
import * as THREE from 'three';
import { HOOP, SWEET, idealSpeed, lookAtRim, shotSpeed, throwPitch, tossSpeed, underCeiling, type Solid } from '../../../shared/hoop';
import { RANGE, clearWay, farAim, farRelease, heaveThrow, windMeter, windPace, type FarAim, type WindClock } from '../../../shared/hoop-range';
import type { RoomOptions } from '../../../shared/floorplan';
import { onDeck } from '../../../shared/mezzanine';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { $, clip, h, modalOpen, toast } from '../../ui/dom';
import type { Person } from '../../world/character';
import { Basketball, IN_HANDS, ballSolids } from './world';
import { LongShot } from './long-shot';
import type { Interactable } from '../../world/types';
import { disposeSprite, textSprite } from '../../world/toon';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    ball: true;
  }
}

/** A floor that says nothing of its fittings has the office's. */
const AS_IT_COMES: RoomOptions = {};

export interface BasketballDeps {
  /** Everyone else on your floor, as you see them, by peer id. */
  remotes: ReadonlyMap<string, { person: Person }>;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
}

/** Registers a handler in the 'activity' key stage: install it after the activities' own. */
export function installBasketball(ctx: Ctx, deps: BasketballDeps) {
  const { office } = ctx;
  /** The floor's basketball, by the hoop on the west wall (see world.ts). */
  const ball = new Basketball(() => office.colliders);
  office.group.add(ball.group);
  /**
   * Ball messages of yours the office hasn't answered yet (it answers every one): until it has, what
   * you did stands, so picking it up and shooting quickly doesn't snap it back into your hands.
   */
  let ballPending = 0;
  /** The office said where the ball is; `answer` when it's answering one of yours (it may be someone else's news). */
  function ballNews(answer: boolean) {
    if (!answer) ballPending = 0;
    else if (ballPending > 0 && --ballPending > 0) return;
    ball.set(store.ball, performance.now());
    ctx.hint.invalidate();
  }
  ctx.messages.on('ball', () => ballNews(true));
  const holdingBall = () => ball.holder === store.you;
  /** Baskets of yours in a row, and whether your last throw was a shot at the hoop (a miss of a pass or a drop doesn't count). */
  let streak = 0;
  let shooting = false;
  /** When you started winding up a shot (performance.now()), or 0; and the meter's clock, which runs faster for a heave. */
  let windFrom = 0;
  let wind: WindClock = { at: 0, runs: 0, heave: false };
  /**
   * A long shot as you wind it up, written over every frame; what of the room might be in its way (see
   * clearWay), taken as you start to wind up and again as you let go, which its throw flies past; and
   * what drops in from there, worked out over the wind-up (see LongShot), WORK_MS a frame at most.
   */
  const longAim: FarAim = { heading: 0, pitch: 0, dist: 0, width: 0, heave: false };
  let inTheWay: Solid[] = [];
  const longShot = new LongShot();
  const WORK_MS = 2;
  // The ball's there to use (and to aim at: it's on the building); a window opening lets go of a wind-up.
  ctx.usables.add({ usable: () => (office.hoop.away ? [] : ball.interactables) });
  ctx.windowOpened.add(() => void (windFrom = 0));

  // With the ball in your hands, E winds up a shot (let go to shoot) and Q drops it.
  ctx.keys.add('activity', (e) => {
    if (!holdingBall() || (e.code !== 'KeyE' && e.code !== 'KeyQ')) return false;
    if (e.repeat) return true;
    if (e.code === 'KeyE') windUp();
    else dropBall();
    return true;
  });

  /** Whose the ball is to pick up, when it isn't anyone's (a game of PIG: see BallState.for), or undefined. */
  const notYours = () => (store.ball.for !== undefined && store.ball.for !== store.you ? store.ball.for : undefined);

  /** E at the ball: it's yours, if nobody beats you to it. */
  function takeBall() {
    if (ctx.carrying()) return toast('🗂️ Your hands are full: put the card back first (Q)', 'warn');
    if (ball.holder || notYours() !== undefined) return;
    deps.reach();
    ctx.sound.ball('bounce', ball.at, 1.5);
    ball.takeNow(store.you);
    ballPending++;
    ctx.net.send({ t: 'ball.take' });
    ctx.hint.invalidate();
  }

  ctx.interactions.define('ball', {
    reach: 3.2,
    hint: () => {
      // In a game of PIG, it's whoever's turn it is (nobody's, mid-shot).
      const theirs = notYours();
      if (theirs !== undefined) return { k: `pig|${theirs}`, parts: [hintTitle('🐷 PIG'), aside(theirs ? `${clip(store.peers.get(theirs)?.name ?? 'Someone', 16)}'s shot` : 'the shot is in the air')] };
      return { k: String(ball.still), parts: [hintTitle('🏀 Basketball'), ball.still ? aside('shoot some hoops') : '', key('E', ball.still ? 'Pick it up' : 'Catch it!')] };
    },
    use: onE(() => takeBall()),
  });

  /**
   * How a shot of yours goes from where you are: out of your hands, which way (a heading), how steep,
   * and how hard it takes to sink it (null: you're not shooting at the hoop). From out past RANGE it's
   * `far` instead (see shared/hoop-range.ts): squared up to the ring, a heave from further out still.
   */
  function shotAim(): { from: THREE.Vector3; heading: number; pitch: number; ideal: number | null; far: FarAim | null } {
    const player = ctx.player;
    const rim = HOOP.rim;
    const first = player.view === 'first';
    // First person, the ball goes where you look; third, from over your head the way you face.
    const facing = first ? player.camYaw + Math.PI : player.facing;
    const from = first ? ctx.camera.position.clone() : new THREE.Vector3(player.pos.x, player.pos.y + 1.95, player.pos.z);
    from.x += Math.sin(facing) * 0.3;
    from.z += Math.cos(facing) * 0.3;
    const toRim = Math.atan2(rim.x - from.x, rim.z - from.z);
    const off = Math.abs(Math.atan2(Math.sin(toRim - facing), Math.cos(toRim - facing)));
    const far = Math.hypot(rim.x - from.x, rim.z - from.z);
    const aimed = off < (first ? 0.35 : 0.6);
    // A long shot only where the ball has a clear way to the ring, and never from up in the loft or under it.
    const loft = onDeck(store.floorPlan.room ?? AS_IT_COMES, from.x, from.z);
    const long = aimed && far >= RANGE && !loft ? farAim(from, throwPitch(first ? player.lookPitch : lookAtRim(from)), far, longAim) : null;
    if (long && clearWay(from, long, inTheWay)) return { from, heading: long.heading, pitch: long.pitch, ideal: null, far: long };
    const atHoop = aimed && far < RANGE && far > 0.4;
    if (first) {
      const look = throwPitch(player.lookPitch);
      const pitch = atHoop ? underCeiling(from, look) : look;
      return { from, heading: facing, pitch, ideal: atHoop ? idealSpeed(from, pitch) : null, far: null };
    }
    // Facing about the right way, your character squares up to the hoop.
    if (!atHoop) return { from, heading: facing, pitch: throwPitch(0.15), ideal: null, far: null };
    const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
    return { from, heading: toRim, pitch, ideal: idealSpeed(from, pitch), far: null };
  }

  /** Hold E (or the mouse) with the ball: the meter goes up and down until you let go. */
  function windUp() {
    if (!holdingBall() || windFrom) return;
    windFrom = performance.now();
    inTheWay = ballSolids(office.colliders);
    longShot.clear();
    wind = { at: windFrom, runs: 0, heave: !!shotAim().far?.heave };
  }

  /** Let go: it flies as hard as the meter says (right in the green, it drops in). */
  function letFly() {
    if (!windFrom) return;
    const now = performance.now();
    windFrom = 0;
    if (!holdingBall()) return;
    inTheWay = ballSolids(office.colliders);
    const a = shotAim();
    const heave = !!a.far?.heave;
    wind = windPace(wind, now, heave);
    const power = windMeter(wind, now);
    shooting = a.ideal !== null || a.far !== null;
    if (a.far) {
      // What drops in from here (the middle of the green is that, thrown from just where it was worked
      // out), and nothing from outside the green.
      const far = longShot.take(a.from, a.far, inTheWay);
      const out = farRelease(far.from, far.heading, far.shot, power, inTheWay);
      release(far.from, far.heading, out.pitch, out.speed);
    } else release(a.from, a.heading, a.pitch, shooting ? shotSpeed(a.ideal!, power) : tossSpeed(power));
    if (ctx.player.view === 'first') ctx.hands.shoot(heave);
    else ctx.me.shoot(heave);
  }

  /** Q with the ball: it drops out of your hands in front of you. */
  function dropBall() {
    if (!holdingBall()) return;
    windFrom = 0;
    const player = ctx.player;
    const f = player.view === 'first' ? player.camYaw + Math.PI : player.facing;
    const from = handsOf(store.you, new THREE.Vector3()) ?? ctx.camera.localToWorld(new THREE.Vector3(0, -0.25, -0.45));
    shooting = false;
    release(from, f, 0, 0.25);
  }

  function release(from: { x: number; y: number; z: number }, heading: number, pitch: number, speed: number) {
    const c = Math.cos(pitch);
    const s = { x: from.x, y: from.y, z: from.z, vx: Math.sin(heading) * c * speed, vy: Math.sin(pitch) * speed, vz: Math.cos(heading) * c * speed };
    ball.throwNow({ ...s, by: store.you }, performance.now());
    ballPending++;
    ctx.net.send({ t: 'ball.throw', ...s });
    ctx.hint.invalidate();
  }

  /** Where the ball is in `id`'s hands, or null when you can't see it there (your own, in first person, is in your view instead). */
  function handsOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const who = id === store.you ? (ctx.player.view === 'first' ? null : ctx.me) : (deps.remotes.get(id)?.person ?? null);
    if (!who) return null;
    who.root.updateMatrixWorld();
    return who.root.localToWorld(out.copy(IN_HANDS));
  }

  ball.onHit = (hit, at) => {
    if (hit.kind === 'score') {
      office.hoop.swish();
      ctx.sound.ball('score', HOOP.rim, hit.speed);
    } else if (hit.speed > 0.6) ctx.sound.ball(hit.kind, at, hit.speed);
  };
  // A heave, they see thrown one-armed: it's told from the throw itself (from way out, straight at the ring).
  ball.onThrow = (by, shot) => deps.remotes.get(by)?.person.shoot(heaveThrow(shot));
  ball.onMiss = (by) => {
    if (by === store.you && shooting) streak = 0;
  };
  ball.onBasket = (b) => {
    const mine = b.by === store.you;
    const points = b.three ? 3 : 2;
    const peer = store.peers.get(b.by);
    const how = b.swish ? 'SWISH! ' : b.bank ? 'BANK! ' : '';
    popScore(mine ? `${how}+${points}` : `${clip(peer?.name ?? 'Someone', 16)} ${how}+${points}`, mine ? store.profile.color : (peer?.color ?? '#ff6b1a'));
    if (mine) {
      streak++;
      const said = b.swish ? 'Swish!' : b.bank ? 'Off the glass!' : 'In off the rim!';
      toast(`🏀 ${said} +${points} from ${b.distance.toFixed(1)} m${streak > 1 ? ` · 🔥 ${streak} in a row` : ''}`);
    }
    if (b.three || (mine && streak >= 3)) ctx.confetti.burst(HOOP.rim.x + 0.3, HOOP.rim.y, HOOP.rim.z, 140, 0.7);
  };

  /** Points floating up off the hoop, and fading. */
  const scorePops: { sprite: THREE.Sprite; t: number }[] = [];
  function popScore(text: string, bg: string) {
    const sprite = textSprite(text, { bg, color: '#ffffff', size: 64, border: '#2b2d42' });
    sprite.position.set(HOOP.rim.x + 0.4, HOOP.rim.y + 0.9, HOOP.rim.z);
    office.group.add(sprite);
    scorePops.push({ sprite, t: 0 });
  }
  function updateScorePops(dt: number) {
    for (let i = scorePops.length - 1; i >= 0; i--) {
      const p = scorePops[i];
      p.t += dt;
      p.sprite.position.y = HOOP.rim.y + 0.9 + p.t * 0.45;
      p.sprite.material.opacity = Math.min(1, (2 - p.t) / 0.5);
      if (p.t < 2) continue;
      office.group.remove(p.sprite);
      disposeSprite(p.sprite);
      scorePops.splice(i, 1);
    }
  }

  /** Every frame: the ball flies on (or goes wherever whoever has it goes), and your hands and everyone's arms hold it. */
  function updateBall(now: number, dt: number) {
    ball.update(now, handsOf);
    const mine = holdingBall();
    if (!mine) windFrom = 0;
    ctx.me.holdBall(mine);
    // Out past HEAVE_FROM the meter runs faster, from whenever you get there mid wind-up.
    const aim = windFrom ? shotAim() : null;
    if (aim) wind = windPace(wind, now, !!aim.far?.heave);
    if (aim?.far) longShot.work(aim.from, aim.far, inTheWay, WORK_MS);
    const hands = ctx.hands;
    hands.holdBall(mine);
    hands.windUp(windFrom ? windMeter(wind, now) : 0, !!aim?.far?.heave);
    for (const [id, r] of deps.remotes) r.person.holdBall(ball.holder === id);
    updateScorePops(dt);
    renderShotMeter(now, aim);
  }
  ctx.ticks.add('others', ({ dt, now }) => {
    // A floor without the hoop has no ball either.
    ball.group.visible = !office.hoop.away;
    if (!ctx.upTop() && !office.hoop.away) updateBall(now, dt);
  });

  /**
   * The wind-up meter over the hint, while you hold E: a green band where the shot drops in, when you're
   * shooting at the hoop (smaller the further out you are), and HEAVE on it from way out.
   */
  let meterKey = '';
  function renderShotMeter(now: number, aim: ReturnType<typeof shotAim> | null) {
    const on = windFrom > 0 && !modalOpen();
    const at = on ? windMeter(wind, now) : 0;
    const sweet = on && !!aim && (aim.ideal !== null || aim.far !== null);
    const width = aim?.far?.width ?? SWEET.width;
    const heave = on && !!aim?.far?.heave;
    const k = `${on}|${sweet}|${heave}|${width.toFixed(4)}|${at.toFixed(3)}`;
    if (k === meterKey) return;
    meterKey = k;
    const el = $('shot-meter');
    el.classList.toggle('hidden', !on);
    el.classList.toggle('aimed', sweet);
    el.classList.toggle('heave', heave);
    el.style.setProperty('--at', String(at));
    el.style.setProperty('--sweet', String(SWEET.at));
    el.style.setProperty('--width', String(width));
  }

  /** What else the hint says while the ball's in your hands (a game of PIG's, say): see addBallHint. */
  const ballHints: (() => Hint | null)[] = [];

  /** With the ball in your hands: how to shoot, and how to put it down. */
  function ballHint(): Hint {
    const first = ctx.player.view === 'first';
    const more = ballHints.map((fn) => fn()).filter((m): m is Hint => !!m);
    return {
      k: `${streak}|${first}|${!!windFrom}|${wind.heave}|${more.map((m) => m.k).join('|')}`,
      parts: [
        h('span.title', {}, '🏀 Ball in hand'),
        streak > 1 ? aside(`🔥 ${streak} in a row`) : '',
        windFrom ? aside(wind.heave ? 'one-handed heave: let go in the green!' : 'let go in the green!') : key(first ? 'E / Click' : 'E', 'Hold to shoot'),
        key('Q', 'Drop it'),
        ...more.flatMap((m) => m.parts),
      ],
    };
  }

  /** In first person, a ball at your feet is yours to pick up without looking right at it. */
  function ballAtFeet(): Interactable | null {
    const it = ball.interactable;
    if (it.off) return null;
    const p = ball.at;
    const player = ctx.player;
    return Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 1.1 && p.y - player.pos.y < 1.2 && p.y - player.pos.y > -0.5 ? it : null;
  }

  return {
    ball,
    /** Whether the ball's in your hands. */
    holding: holdingBall,
    ballNews,
    dropBall,
    windUp,
    letFly,
    /** Whether you're winding up a shot (E, or the mouse, held down with the ball). */
    winding: () => windFrom !== 0,
    /** No shot after all (a window opened, the page lost focus): the wind-up's let go of. */
    stopWinding: () => void (windFrom = 0),
    ballHint,
    /** Adds to what the hint says while the ball's in your hands (after how to shoot and drop it). */
    addBallHint: (fn: () => Hint | null) => void ballHints.push(fn),
    ballAtFeet,
  };
}
