/**
 * The floor's basketball, by the hoop on the west wall: picking it up, winding up a shot (the meter)
 * and letting it fly, baskets and streaks, and the ball in everyone's hands.
 */
import * as THREE from 'three';
import { dunkRelease, physicalThrow, throwCharge } from '../../../shared/basketball-shot';
import { HOOP } from '../../../shared/hoop';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { $, clip, h, modalOpen, toast } from '../../ui/dom';
import type { Person } from '../../world/character';
import { Basketball, IN_HANDS } from './world';
import type { Interactable } from '../../world/types';
import { disposeSprite, textSprite } from '../../world/toon';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    ball: true;
  }
}

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
  let dunking = false;
  /** When you started winding up a shot (performance.now()), or 0. */
  let windFrom = 0;
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

  /** E at the ball: it's yours, if nobody beats you to it. */
  function takeBall() {
    if (ctx.carrying()) return toast('🗂️ Your hands are full: put the card back first (Q)', 'warn');
    if (ball.holder) return;
    deps.reach();
    ctx.sound.ball('bounce', ball.at, 1.5);
    ball.takeNow(store.you);
    ballPending++;
    ctx.net.send({ t: 'ball.take' });
    ctx.hint.invalidate();
  }

  ctx.interactions.define('ball', {
    reach: 3.2,
    hint: () => ({ k: String(ball.still), parts: [hintTitle('🏀 Basketball'), ball.still ? aside('shoot some hoops') : '', key('E', ball.still ? 'Pick it up' : 'Catch it!')] }),
    use: onE(() => takeBall()),
  });

  /** Release where your hands are, in the direction you actually aim. */
  function shotAim(): { from: THREE.Vector3; heading: number; pitch: number } {
    const player = ctx.player;
    const first = player.view === 'first';
    const heading = first ? player.camYaw + Math.PI : player.facing;
    const pitch = player.lookPitch;
    const from = first ? ctx.camera.position.clone() : new THREE.Vector3(player.pos.x, player.pos.y + 1.95, player.pos.z);
    from.x += Math.sin(heading) * Math.cos(pitch) * 0.3;
    from.y += Math.sin(pitch) * 0.3;
    from.z += Math.cos(heading) * Math.cos(pitch) * 0.3;
    return { from, heading, pitch };
  }

  /** Hold E (or the mouse) with the ball: charge builds until you let go. */
  function windUp() {
    if (!holdingBall() || windFrom) return;
    windFrom = performance.now();
  }

  /** Let go: it flies where you aim with the power you charged. */
  function letFly() {
    if (!windFrom) return;
    const held = (performance.now() - windFrom) / 1000;
    windFrom = 0;
    if (!holdingBall()) return;
    const a = shotAim();
    dunking = dunkRelease(a.from, ctx.player.grounded, a.pitch);
    shooting = true;
    const shot = physicalThrow(a.from, a.heading, a.pitch, held);
    throwBall(shot);
    if (ctx.player.view === 'first') ctx.hands.shoot();
    else ctx.me.shoot();
  }

  /** Q with the ball: it drops out of your hands in front of you. */
  function dropBall() {
    if (!holdingBall()) return;
    windFrom = 0;
    const player = ctx.player;
    const f = player.view === 'first' ? player.camYaw + Math.PI : player.facing;
    const from = handsOf(store.you, new THREE.Vector3()) ?? ctx.camera.localToWorld(new THREE.Vector3(0, -0.25, -0.45));
    shooting = false;
    dunking = false;
    release(from, f, 0, 0.25);
  }

  function release(from: THREE.Vector3, heading: number, pitch: number, speed: number) {
    const c = Math.cos(pitch);
    const s = { x: from.x, y: from.y, z: from.z, vx: Math.sin(heading) * c * speed, vy: Math.sin(pitch) * speed, vz: Math.cos(heading) * c * speed };
    throwBall(s);
  }

  function throwBall(s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) {
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
  ball.onThrow = (by) => deps.remotes.get(by)?.person.shoot();
  ball.onMiss = (by) => {
    if (by === store.you && shooting) streak = 0;
  };
  ball.onBasket = (b) => {
    const mine = b.by === store.you;
    const points = b.three ? 3 : 2;
    const peer = store.peers.get(b.by);
    const isDunk = mine && dunking;
    const how = isDunk ? 'DUNK! ' : b.swish ? 'SWISH! ' : b.bank ? 'BANK! ' : '';
    popScore(mine ? `${how}+${points}` : `${clip(peer?.name ?? 'Someone', 16)} ${how}+${points}`, mine ? store.profile.color : (peer?.color ?? '#ff6b1a'));
    if (mine) {
      streak++;
      const said = isDunk ? 'Dunk!' : b.swish ? 'Swish!' : b.bank ? 'Off the glass!' : 'In off the rim!';
      toast(`🏀 ${said} +${points} from ${b.distance.toFixed(1)} m${streak > 1 ? ` · 🔥 ${streak} in a row` : ''}`);
    }
    if (isDunk || b.three || (mine && streak >= 3)) ctx.confetti.burst(HOOP.rim.x + 0.3, HOOP.rim.y, HOOP.rim.z, 140, 0.7);
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
    const hands = ctx.hands;
    hands.holdBall(mine);
    hands.windUp(windFrom ? throwCharge((now - windFrom) / 1000) : 0);
    for (const [id, r] of deps.remotes) r.person.holdBall(ball.holder === id);
    updateScorePops(dt);
    renderShotMeter(now);
  }
  ctx.ticks.add('others', ({ dt, now }) => {
    // A floor without the hoop has no ball either.
    ball.group.visible = !office.hoop.away;
    if (!ctx.upTop() && ctx.inOffice() && !office.hoop.away) updateBall(now, dt);
  });

  /** The wind-up meter over the hint, while you hold E: charge increases with hold time, without a guaranteed scoring band. */
  let meterKey = '';
  function renderShotMeter(now: number) {
    const on = windFrom > 0 && !modalOpen();
    const at = on ? throwCharge((now - windFrom) / 1000) : 0;
    const k = `${on}|${at.toFixed(3)}`;
    if (k === meterKey) return;
    meterKey = k;
    const el = $('shot-meter');
    el.classList.toggle('hidden', !on);
    el.classList.remove('aimed');
    el.style.setProperty('--at', String(at));
  }

  /** With the ball in your hands: how to shoot, and how to put it down. */
  function ballHint(): Hint {
    const first = ctx.player.view === 'first';
    return {
      k: `${streak}|${first}|${!!windFrom}`,
      parts: [
        h('span.title', {}, '🏀 Ball in hand'),
        streak > 1 ? aside(`🔥 ${streak} in a row`) : '',
        windFrom ? aside('release to throw; longer hold means more power') : key(first ? 'E / Click' : 'E', 'Hold to shoot'),
        key('Space', 'Jump for a layup'),
        key('Q', 'Drop it'),
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
    ballAtFeet,
  };
}
