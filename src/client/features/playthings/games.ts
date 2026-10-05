/**
 * The two tables: a foosball point that plays itself out when you kick off, and a ping-pong rally you
 * keep going by yourself, Space returning the ball each time it comes back. The numbers behind them are
 * logic.ts's; the other things to play with are toys.ts's.
 */
import type * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { toast } from '../../ui/dom';
import type { PieceView } from '../../world/office/furnish';
import { FOOSBALL_RODS, PLAY_PARTS } from '../../world/office/furniture-play';
import { keep, readBests, roomOf, saveBests, type Toy } from './kit';
import { FOOSBALL, RALLY, foosBallAt, foosGoal, foosPoint, rallyBall, rallyHit, rallyMissed, rallyTrip, rodTurn, type FoosPoint, type FoosScore } from './logic';

const TAU = Math.PI * 2;

// ---- Foosball ---------------------------------------------------------------------------------------

/** E kicks off: the rods rock and spin, the ball's knocked about, and it ends in a goal for you or for them. First to five. */
export function foosball(ctx: Ctx): Toy {
  const of = keep((v) => {
    const ball = v.group.getObjectByName(PLAY_PARTS.foosBall);
    const rods: (THREE.Object3D | undefined)[] = [];
    for (let i = 0; i < FOOSBALL_RODS; i++) rods.push(v.group.getObjectByName(`${PLAY_PARTS.rod}${i}`));
    return {
      ball,
      rods,
      /** Where the ball lies between points. */
      rest: ball ? { x: ball.position.x, z: ball.position.z } : { x: 0, z: 0 },
      score: { you: 0, them: 0 } as FoosScore,
      point: null as FoosPoint | null,
      seed: 0,
      t: 0,
      /** How many of the point's knocks have sounded. */
      knocks: 0,
      /** Seconds left of the rods coming back to rest after a point. */
      settle: 0,
    };
  });
  return {
    hint(v) {
      const s = of(v);
      const score = `${s.score.you} – ${s.score.them}`;
      return { k: `${score}|${!!s.point}`, parts: [aside(score), s.point ? aside('in play…') : key('E', 'Kick off')] };
    },
    use(v) {
      const s = of(v);
      if (s.point) return;
      s.seed = Math.floor(Math.random() * 1e9);
      s.point = foosPoint(s.seed);
      s.t = 0;
      s.knocks = 1;
      ctx.sound.plaything('clack', roomOf(v, 0, 0.85, 0));
    },
    tick(views, { dt }) {
      for (const v of views) {
        const s = of(v);
        if (s.settle > 0) {
          // Each rod the short way back to hanging straight.
          s.settle = Math.max(0, s.settle - dt);
          for (const rod of s.rods) if (rod) rod.rotation.z *= Math.exp(-dt * 12);
          if (s.settle === 0) {
            for (const rod of s.rods) if (rod) rod.rotation.z = 0;
            s.ball?.position.setX(s.rest.x).setZ(s.rest.z);
          }
        }
        if (!s.point) continue;
        s.t += dt;
        const at = foosBallAt(s.point, s.t);
        s.ball?.position.setX(at.x).setZ(at.z);
        s.rods.forEach((rod, i) => rod && (rod.rotation.z = rodTurn(i, s.t, s.seed)));
        while (s.knocks < s.point.path.length - 1 && s.t >= s.point.path[s.knocks].t) {
          s.knocks++;
          ctx.sound.plaything('clack', roomOf(v, at.x, 0.85, at.z));
        }
        if (s.t < FOOSBALL.point) continue;
        const { score, won } = foosGoal(s.score, s.point.yours);
        const tally = `${score.you}–${score.them}`;
        ctx.sound.plaything('goal', roomOf(v, at.x, 0.85, at.z));
        if (won === 'you') {
          toast(`🏆 You win, ${tally}!`);
          ctx.confetti.burst(v.piece.x, 1.1, v.piece.z, 120);
        } else if (won) toast(`⚽ They take it, ${tally}. Rematch?`);
        else toast(s.point.yours ? `⚽ GOAL! ${tally}` : `⚽ They scored: ${tally}`);
        s.score = won ? { you: 0, them: 0 } : score;
        s.point = null;
        s.settle = 0.5;
        for (const rod of s.rods) if (rod) rod.rotation.z = Math.atan2(Math.sin(rod.rotation.z), Math.cos(rod.rotation.z));
        ctx.hint.invalidate();
      }
    },
  };
}

// ---- A ping-pong rally --------------------------------------------------------------------------------

/** How far from the table's middle the ball is hit at either end, and how far across it wanders (meters). */
const REACH = 1.22;
const WANDER = 0.42;
/** How long a swing of the paddle takes to show (seconds), and how long before the serve. */
const SWING = 0.22;
const SERVE = 0.9;
/** The keys that walk you away from the table, which ends a rally. */
const WALK = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

interface Rally {
  view: PieceView;
  ball: THREE.Object3D | undefined;
  paddle: THREE.Object3D | undefined;
  /** Where the ball and the paddle lie when nobody's playing, to put them back. */
  home: { ball: THREE.Vector3; paddle: THREE.Vector3 } | null;
  /** Where you stand, and which way you face. */
  spot: { x: number; z: number; facing: number };
  /** Returns so far, how far through its trip the ball is (see rallyBall), and how long this trip takes. */
  n: number;
  p: number;
  trip: number;
  /** Seconds until the serve. */
  serve: number;
  /** Where across the table this trip started and where it's headed. */
  from: number;
  to: number;
  /** Seconds since you last swung, and when you can swing again (after a swing at nothing). */
  swung: number;
  readyAt: number;
}

/**
 * E at the table's end starts a rally: you're held there with the paddle up, the ball comes down the
 * table and back a little quicker every time, and Space returns it. Miss it (or walk away, or E) and
 * the rally's over; your best is kept in this browser.
 */
export function pingPong(ctx: Ctx): Toy {
  const bests = readBests();
  let rally: Rally | null = null;

  function start(v: PieceView) {
    const p = ctx.player;
    const use = kindDef(v.piece.kind).use;
    if (rally || !use || p.seat || p.rig || ctx.trip()) return;
    ctx.activities.stopAll('start');
    p.stopWalking();
    const ball = v.group.getObjectByName(PLAY_PARTS.ball);
    const paddle = v.group.getObjectByName(PLAY_PARTS.paddle);
    const spot = { ...roomOf(v, 0, 0, use.z), facing: v.piece.rotY + Math.PI };
    rally = {
      view: v,
      ball,
      paddle,
      home: ball && paddle ? { ball: ball.position.clone(), paddle: paddle.position.clone() } : null,
      spot,
      n: 0,
      p: 0,
      trip: rallyTrip(0),
      serve: SERVE,
      from: 0,
      to: 0,
      swung: 1,
      readyAt: 0,
    };
    // Held at the end of the table, looking down it (the mouse still looks around).
    p.rig = () => {
      p.pos.set(spot.x, 0, spot.z);
      p.moving = false;
      if (p.view === 'third') p.facing = spot.facing;
    };
    p.camYaw = spot.facing + Math.PI;
    p.lookPitch = -0.3;
    ctx.hint.invalidate();
  }

  function stop(missed = false) {
    const r = rally;
    if (!r) return;
    rally = null;
    ctx.player.rig = null;
    if (r.home) {
      r.ball?.position.copy(r.home.ball);
      r.paddle?.position.copy(r.home.paddle);
      r.paddle?.rotation.set(0, 0, 0);
    }
    const best = bests.rally ?? 0;
    if (r.n > best) {
      bests.rally = r.n;
      saveBests(bests);
      toast(`🏓 A rally of ${r.n}: your best yet!`);
    } else if (missed || r.n > 0) toast(r.n ? `🏓 A rally of ${r.n} (your best is ${best})` : '🏓 Missed it! E to serve again');
    ctx.hint.invalidate();
  }

  /** Space: a swing of the paddle, which returns the ball if it's there to be hit. */
  function swing() {
    const r = rally;
    const now = performance.now() / 1000;
    if (!r || now < r.readyAt) return;
    r.swung = 0;
    if (r.serve > 0) return;
    if (!rallyHit(r.p, r.trip)) {
      r.readyAt = now + RALLY.recover;
      return;
    }
    r.n++;
    r.from = r.from + (r.to - r.from) * Math.min(1, r.p);
    r.to = (Math.random() * 2 - 1) * WANDER;
    r.p = 0;
    r.trip = rallyTrip(r.n);
    ctx.sound.plaything('pock', roomOf(r.view, r.from, 1, REACH));
    ctx.hint.invalidate();
  }

  ctx.activities.add({
    id: 'rally',
    active: () => rally !== null,
    stop: () => stop(),
    // Space swings and E puts the paddle down; nothing else is in reach while you play.
    key: (e) => {
      if (e.code === 'Space') {
        if (!e.repeat) swing();
        return true;
      }
      if (!(e.code in DESK_KEYS)) return false;
      if (e.code === 'KeyE') stop();
      return true;
    },
    hint: (el) => {
      const r = rally!;
      const best = Math.max(bests.rally ?? 0, r.n);
      ctx.hint.draw(el, `rally|${r.n}|${r.serve > 0}|${best}`, () => [
        hintTitle(r.serve > 0 ? '🏓 Here it comes…' : `🏓 Rally: ${r.n}`),
        ...(best ? [aside(`best ${best}`)] : []),
        key('Space', 'Hit it back'),
        key('E', 'Stop'),
      ]);
    },
    // Your hands are on the paddle, which floats in front of you: none drawn, and your character keeps its feet.
    hidesHands: true,
  });

  // After you've moved: the ball on its way, the paddle following it, and whatever ends the rally.
  ctx.ticks.add('play', ({ dt }) => {
    const r = rally;
    if (!r) return;
    const p = ctx.player;
    if (ctx.trip() || p.seat || ctx.upTop() || !r.view.group.parent || r.view.away || p.holding(...WALK)) return stop();
    const top = kindDef(r.view.piece.kind).top;
    r.swung += dt;
    if (r.serve > 0) {
      r.serve -= dt;
      if (r.serve <= 0) {
        r.to = (Math.random() * 2 - 1) * WANDER;
        ctx.sound.plaything('pock', roomOf(r.view, 0, 1, REACH));
        ctx.hint.invalidate();
      }
    } else {
      const was = r.p;
      r.p += dt / r.trip;
      // The table at either end of each crossing, and whoever's at the far end sending it back.
      for (const [at, what] of [[0.375, 'tap'], [0.5, 'pock'], [0.875, 'tap']] as const) {
        if (was < at && r.p >= at) ctx.sound.plaything(what, roomOf(r.view, 0, top, at === 0.875 ? REACH / 2 : -REACH / (at === 0.5 ? 1 : 2)), 1);
      }
      if (rallyMissed(r.p, r.trip)) return stop(true);
    }
    const flight = rallyBall(r.serve > 0 ? 0 : r.p);
    const across = r.from + (r.to - r.from) * Math.min(1, r.serve > 0 ? 0 : r.p);
    r.ball?.position.set(across, top + 0.024 + flight.y, flight.z * REACH);
    if (r.paddle) {
      // Stood on its grip at your end, drifting to wherever the ball's coming back to; a swing cocks it back and whips it through.
      const through = r.swung < SWING ? Math.sin((r.swung / SWING) * Math.PI) : 0;
      const aim = r.p > 0.5 ? r.to : r.paddle.position.x;
      r.paddle.position.set(r.paddle.position.x + (aim - r.paddle.position.x) * Math.min(1, dt * 7), top + 0.1, REACH + 0.1 - through * 0.16);
      r.paddle.rotation.set(Math.PI / 2 - 0.12 - through * 0.5, 0, Math.sin(r.swung * TAU) * (r.swung < SWING ? 0.1 : 0));
    }
  });

  return {
    hint() {
      const best = bests.rally ?? 0;
      return { k: String(best), parts: [aside(best ? `your best rally: ${best}` : 'keep the ball coming back'), key('E', 'Start a rally')] };
    },
    use: (v) => start(v),
  };
}
