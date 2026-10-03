/**
 * The things to play with that you just walk up to (or onto): the punching bag, the vending machine, the
 * trampoline, the dance mat, the prize wheel and the high striker. Each is a Toy (see kit.ts) that
 * index.ts hands its pieces to; the numbers behind them are logic.ts's. The two tables are games.ts's.
 */
import * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import type { Ctx } from '../../core/context';
import { aside, key } from '../../core/hint';
import { toast } from '../../ui/dom';
import type { PieceView } from '../../world/office/furnish';
import { DANCE_TILES, PLAY_PARTS, WHEEL_PRIZES } from '../../world/office/furniture-play';
import { keep, localOf, roomOf, type Toy } from './kit';
import {
  BOUNCE,
  DANCE,
  STRIKER,
  WHEEL,
  comboAt,
  contactDip,
  danceTile,
  hitCombo,
  launchPuck,
  matDip,
  meterBar,
  pegsPassed,
  punchSwing,
  rebound,
  restSwing,
  spinSpeed,
  stepPuck,
  stepSpin,
  stepSpring,
  stepSwing,
  strikeName,
  sweep,
  tileNote,
  wedgeAt,
  type Combo,
  type Puck,
  type Spin,
  type Spring,
  type Swing,
} from './logic';

const seconds = () => performance.now() / 1000;

// ---- The punching bag -------------------------------------------------------------------------------

/** E punches it: it swings away from you and settles, and punches in a row count up. */
export function punchingBag(ctx: Ctx): Toy {
  const of = keep((): { swing: Swing; combo: Combo; moving: boolean } => ({ swing: restSwing(), combo: { n: 0, at: -Infinity }, moving: false }));
  return {
    hint(v) {
      const n = comboAt(of(v).combo, seconds());
      return { k: String(n), parts: [...(n > 1 ? [aside(`🥊 x${n}`)] : []), key('E', 'Punch')] };
    },
    use(v) {
      const s = of(v);
      const n = hitCombo(s.combo, seconds());
      // Away from you. Sideways the frame's uprights are in its way, so it mostly goes front to back.
      const from = localOf(v, ctx.player.pos.x, ctx.player.pos.z);
      punchSwing(s.swing, -from.x * 0.3, -from.z || -1, 1 + Math.min(n, 10) * 0.02);
      s.moving = true;
      ctx.sound.plaything('thud', roomOf(v, 0, 1.25, 0), 0.9 + Math.min(n, 10) * 0.05);
      ctx.shake(0.12);
      if (n === 10 || n === 25 || n === 50) toast(`🥊 ${n} in a row!`);
    },
    tick(views, { dt }) {
      for (const v of views) {
        const s = of(v);
        if (!s.moving || !v.swing) continue;
        s.moving = stepSwing(s.swing, dt);
        // Hung from its hook: leaning toward +x is a turn about z, toward +z a turn back about x.
        v.swing.rotation.set(-s.swing.z, 0, s.swing.x);
      }
    },
  };
}

// ---- The vending machine ----------------------------------------------------------------------------

/** How long the machine takes between cans (seconds), and how long a can lies in the tray. */
const RESTOCK = 4;
const CAN_STAYS = 3.2;
const CANS = ['cherry fizz', 'lemon soda', 'cold brew', 'ginger ale', 'orange crush', 'cola'];

/** E gets a can: the buzz a coffee gives you (see PlaythingsDeps.snack), and the can dropping into the tray. */
export function vendingMachine(ctx: Ctx, snack: () => void): Toy {
  const of = keep((v) => {
    const can = v.group.getObjectByName(PLAY_PARTS.can);
    return { readyAt: 0, since: -1, can, rest: can?.position.y ?? 0 };
  });
  return {
    hint(v) {
      const busy = seconds() < of(v).readyAt;
      return { k: String(busy), parts: busy ? [aside('restocking…')] : [key('E', 'Grab a can')] };
    },
    use(v) {
      const s = of(v);
      const now = seconds();
      if (now < s.readyAt) return;
      s.readyAt = now + RESTOCK;
      s.since = 0;
      ctx.sound.plaything('clunk', roomOf(v, 0, 0.5, 0.4));
      toast(`🥤 Clunk! A can of ${CANS[Math.floor(Math.random() * CANS.length)]}`);
      snack();
    },
    tick(views, { dt }) {
      for (const v of views) {
        const s = of(v);
        if (s.since < 0 || !s.can) continue;
        s.since += dt;
        // The works turn over first, then it drops into the tray and rattles to a stop.
        const fallen = s.since - 0.32;
        s.can.visible = fallen >= 0 && s.since < CAN_STAYS;
        s.can.position.y = s.rest + Math.max(0, 0.16 - fallen * fallen * 9) + (fallen > 0.14 && fallen < 0.3 ? Math.sin((fallen - 0.14) * 19.6) * 0.02 : 0);
        if (s.since >= CAN_STAYS) s.since = -1;
      }
    },
  };
}

// ---- The trampoline ---------------------------------------------------------------------------------

/** How far out from its middle the mat is under your feet (meters; see TRAMPOLINE in build_play.py). */
const MAT_RADIUS = 0.96;

interface Mat {
  mesh: THREE.Mesh | undefined;
  /** Its vertices as modelled, flat. */
  flat: Float32Array | undefined;
  /** How far down its middle is (negative), and where on it (its own frame) the dip is deepest. */
  spring: Spring;
  x: number;
  z: number;
  moving: boolean;
}

/**
 * Step or land on it and it throws you back up, harder while you hold Space (see rebound). Your feet sink
 * into the mat for a moment first, and the mat dips under them and springs back.
 */
export function trampoline(ctx: Ctx): Toy {
  const of = keep((v): Mat => {
    const mesh = v.group.getObjectByName(PLAY_PARTS.mat) as THREE.Mesh | undefined;
    const flat = mesh?.isMesh ? new Float32Array(mesh.geometry.getAttribute('position').array) : undefined;
    return { mesh, flat, spring: { x: 0, v: 0 }, x: 0, z: 0, moving: false };
  });
  /** The mat you're in right now: how long for, how deep it gives, and how fast you came down onto it. */
  let contact: { view: PieceView; t: number; depth: number; fall: number } | null = null;
  /** How fast you were falling, the last frame you were in the air. */
  let fall = 0;

  /** The mat's shape with its middle `m.spring.x` down: deepest under where you landed, nothing at its rim. */
  function shape(m: Mat) {
    if (!m.mesh || !m.flat) return;
    const at = m.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < at.count; i++) {
      const x = m.flat[i * 3];
      const z = m.flat[i * 3 + 2];
      const rim = 1 - Math.min(1, (x * x + z * z) / (MAT_RADIUS * MAT_RADIUS));
      const near = Math.exp(-((x - m.x) ** 2 + (z - m.z) ** 2) / 0.3);
      at.setY(i, m.flat[i * 3 + 1] + m.spring.x * rim * (0.45 + 0.55 * near));
    }
    at.needsUpdate = true;
    m.mesh.geometry.computeVertexNormals();
  }

  return {
    tick(views, { dt }) {
      const p = ctx.player;
      const free = !p.seat && !p.rig && !ctx.trip();
      if (!p.grounded) fall = Math.max(0, -p.vy);
      // The mat under your feet, if you're standing on one (or still in the one that has you).
      let on: PieceView | null = null;
      for (const v of free ? views : []) {
        const top = kindDef(v.piece.kind).top;
        if (Math.hypot(p.pos.x - v.piece.x, p.pos.z - v.piece.z) > MAT_RADIUS) continue;
        if (contact?.view === v ? p.pos.y < top + 0.5 : p.grounded && Math.abs(p.pos.y - top) < 0.04) on = v;
      }
      if (on) {
        const k = kindDef(on.piece.kind);
        const m = of(on);
        if (contact?.view !== on) {
          contact = { view: on, t: 0, depth: matDip(fall), fall };
          const at = localOf(on, p.pos.x, p.pos.z);
          m.x = at.x;
          m.z = at.z;
        }
        contact.t += dt;
        if (contact.t < BOUNCE.contact) {
          // In the mat: held on it (a jump of your own waits for the throw), sunk in as deep as it gives.
          const dip = contactDip(contact.t, contact.depth);
          p.pos.y = k.top;
          p.vy = 0;
          p.grounded = true;
          p.stepOffset = -dip;
          p.updateCamera();
          m.spring.x = -dip;
          m.spring.v = 0;
          shape(m);
        } else {
          const up = Math.min(rebound(k.bounce ?? 0, contact.fall, p.holding('Space')) * p.effects.jump, (k.bounce ?? 0) * 1.5);
          p.vy = up;
          p.grounded = false;
          p.pos.y = k.top + 0.02;
          m.spring.v = contact.depth * 14;
          m.moving = true;
          ctx.sound.plaything('boing', { x: p.pos.x, y: k.top, z: p.pos.z }, up / (k.bounce || 1));
          contact = null;
          fall = 0;
        }
      } else {
        contact = null;
        if (p.grounded) fall = 0;
      }
      // Every mat still ringing from a landing.
      for (const v of views) {
        const m = of(v);
        if (!m.moving || contact?.view === v) continue;
        m.moving = stepSpring(m.spring, dt);
        shape(m);
      }
    },
  };
}

// ---- The dance mat ----------------------------------------------------------------------------------

interface Pad {
  /** Each tile's material, by its number (see TILE_COLORS in furniture-play.ts). */
  tiles: (THREE.MeshToonMaterial | undefined)[];
  /** How lit each is, 1 down to 0. */
  glow: number[];
  /** The tile you were on last frame, or -1. */
  last: number;
  /** Seconds of party left, after every tile was lit at once. */
  party: number;
}

/** Its tiles light up and play a note under your feet; light all nine before the first fades and it throws a party. */
export function danceMat(ctx: Ctx): Toy {
  const of = keep((v): Pad => {
    const tiles: Pad['tiles'] = new Array(DANCE_TILES).fill(undefined);
    v.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      const m = mat && !Array.isArray(mat) ? /^Tile(\d)$/.exec(mat.name) : null;
      if (m) tiles[Number(m[1])] = mat;
    });
    return { tiles, glow: new Array(DANCE_TILES).fill(0), last: -1, party: 0 };
  });
  return {
    tick(views, { dt, t }) {
      const p = ctx.player;
      for (const v of views) {
        const s = of(v);
        const top = kindDef(v.piece.kind).top;
        const at = localOf(v, p.pos.x, p.pos.z);
        const on = p.grounded && !p.seat && Math.abs(p.pos.y - top) < 0.06 ? danceTile(at.x, at.z) : -1;
        if (on >= 0 && on !== s.last && s.party <= 0) {
          s.glow[on] = 1;
          ctx.sound.plaything('note', roomOf(v, at.x, top, at.z), tileNote(on));
          if (s.glow.every((g) => g > 0)) {
            s.party = 2.4;
            ctx.sound.plaything('party', roomOf(v, 0, top, 0));
            ctx.confetti.burst(v.piece.x, 0.4, v.piece.z, 140);
            toast('🕺 Full board! Every tile lit at once');
          }
        }
        s.last = on;
        const was = s.party;
        s.party = Math.max(0, s.party - dt);
        for (let i = 0; i < DANCE_TILES; i++) {
          if (s.party > 0) s.glow[i] = 0.55 + 0.45 * Math.sin(t * 14 + i * 2.1);
          else if (was > 0) s.glow[i] = 0;
          else if (i !== on) s.glow[i] = Math.max(0, s.glow[i] - dt / DANCE.fade);
          const mat = s.tiles[i];
          if (mat) mat.emissiveIntensity = s.glow[i] * 0.85;
        }
      }
    },
  };
}

// ---- The prize wheel --------------------------------------------------------------------------------

/** E spins it: it clicks round under its flapper as it runs down, and says what it stopped on. */
export function prizeWheel(ctx: Ctx): Toy {
  const of = keep((v) => ({
    wheel: v.group.getObjectByName(PLAY_PARTS.wheel),
    flapper: v.group.getObjectByName(PLAY_PARTS.flapper),
    spin: { angle: 0, speed: 0 } as Spin,
    spinning: false,
    /** How far the flapper's knocked aside (radians), easing back. */
    flap: 0,
    /** What it stopped on last, if it has been spun. */
    won: -1,
  }));
  return {
    hint(v) {
      const s = of(v);
      if (s.spinning) return { k: 'spinning', parts: [aside('round and round…')] };
      const prize = WHEEL_PRIZES[s.won];
      return { k: String(s.won), parts: [...(prize ? [aside(`${prize.icon} ${prize.says}`)] : []), key('E', prize ? 'Spin again' : 'Spin it')] };
    },
    use(v) {
      const s = of(v);
      if (s.spinning) return;
      s.spin.speed = spinSpeed(Math.random());
      s.spinning = true;
      ctx.sound.plaything('tick', roomOf(v, 0, 1.7, 0), 1);
    },
    tick(views, { dt }) {
      for (const v of views) {
        const s = of(v);
        if (s.flap > 0.001 && s.flapper) {
          s.flap *= Math.exp(-dt * 16);
          s.flapper.rotation.z = s.flap;
        }
        if (!s.spinning) continue;
        const from = s.spin.angle;
        s.spinning = stepSpin(s.spin, dt);
        if (s.wheel) s.wheel.rotation.z = -s.spin.angle;
        if (pegsPassed(from, s.spin.angle, WHEEL_PRIZES.length) > 0) {
          s.flap = 0.5;
          ctx.sound.plaything('tick', roomOf(v, 0, 1.7, 0), s.spin.speed / WHEEL.fastest);
        }
        if (s.spinning) continue;
        s.won = wedgeAt(s.spin.angle, WHEEL_PRIZES.length);
        const prize = WHEEL_PRIZES[s.won];
        ctx.sound.plaything('prize', roomOf(v, 0, 1.2, 0));
        toast(`🎡 ${prize.icon} ${prize.says}`);
        ctx.hint.invalidate();
      }
    },
  };
}

// ---- The high striker -------------------------------------------------------------------------------

/** How far the puck slides, from where it rests up to the bell (meters; see STRIKER in build_play.py). */
const RAIL = 1.92;

/** Its meter runs up and down by itself; E swings the mallet with however much is on it, and a full one rings the bell. */
export function highStriker(ctx: Ctx): Toy {
  const of = keep((v) => {
    const puck = v.group.getObjectByName(PLAY_PARTS.puck);
    return { puck, bell: v.group.getObjectByName(PLAY_PARTS.bell), rest: puck?.position.y ?? 0, at: { y: 0, v: 0 } as Puck, power: 0, flying: false, rung: 0 };
  });
  return {
    hint(v) {
      if (of(v).flying) return { k: 'up', parts: [aside('there it goes…')] };
      const bar = meterBar(sweep(seconds(), STRIKER.period));
      return { k: bar, parts: [aside(bar), key('E', 'Swing the mallet')] };
    },
    use(v) {
      const s = of(v);
      if (s.flying) return;
      s.power = sweep(seconds(), STRIKER.period);
      launchPuck(s.at, s.power);
      s.flying = true;
      ctx.sound.plaything('whack', roomOf(v, 0, 0.2, 0.24), s.power);
      ctx.shake(0.1 + 0.2 * s.power);
    },
    tick(views, { dt, t }) {
      for (const v of views) {
        const s = of(v);
        if (s.rung > 0 && s.bell) {
          s.rung = Math.max(0, s.rung - dt);
          s.bell.rotation.z = Math.sin(t * 34) * 0.16 * s.rung;
        }
        if (!s.flying) continue;
        const what = stepPuck(s.at, dt);
        if (s.puck) s.puck.position.y = s.rest + s.at.y * RAIL;
        if (what === 'bell') {
          s.rung = 1;
          const bell = roomOf(v, 0, 2.3, -0.26);
          ctx.sound.plaything('bell', bell);
          ctx.confetti.burst(bell.x, bell.y, bell.z, 90);
          toast(`🔔 ${strikeName(s.power)}!`);
        }
        if (s.at.y <= 0 && s.at.v <= 0) {
          s.flying = false;
          if (s.power < STRIKER.bell) toast(`🔔 ${strikeName(s.power)}: ${Math.round((s.power / STRIKER.bell) * 100)}% of the way up`);
          ctx.hint.invalidate();
        }
      }
    },
  };
}
