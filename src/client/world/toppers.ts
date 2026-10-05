import type { AgentProvider } from '../../shared/providers';
import type { WorkerStatus } from '../../shared/protocol';

// What a worker wears on the tip of its antenna to say what it runs on: one small emblem per agent
// provider, modelled in toppers.glb (blender/scripts/build_toppers.py) and stood on the antenna by
// world/character/worker-antenna.ts. They are the office's own shapes, not anyone's logo: the
// provider's name is on the worker's card.
//
// This table is the only place that says who wears what. To give a provider another emblem, change
// its `part` to any root in toppers.glb; to give it other colors, change `colors`. A new emblem is a
// function in build_toppers.py (see its header), and a provider with no row here wears the plain one.
// tests/toppers-model.test.ts holds the model to this table.

/** One emblem as a worker wears it. */
export interface Topper {
  /** Its root in toppers.glb. */
  part: string;
  /** What its two materials are painted (an emblem made of one only has Main). */
  colors: { Main: string; Accent: string };
  /** How fast it turns, next to the others (1 unless given): 0 keeps it facing forward, only bobbing. */
  spin?: number;
  /** How big it is, next to how it was modelled (1 unless given). */
  size?: number;
}

/** What a worker with no provider wears (a shared shell, the bartender), and a provider with no row below. */
export const DEFAULT_TOPPER: Topper = { part: 'topper_default', colors: { Main: '#dfe7ef', Accent: '#8d99ae' } };

export const TOPPERS: Partial<Record<AgentProvider, Topper>> = {
  claude: { part: 'topper_claude', colors: { Main: '#e8714f', Accent: '#ffb38a' } },
  codex: { part: 'topper_codex', colors: { Main: '#1fa971', Accent: '#2b2d42' } },
  pi: { part: 'topper_pi', colors: { Main: '#8b5cf6', Accent: '#d9c8ff' } },
  opencode: { part: 'topper_opencode', colors: { Main: '#8d99ae', Accent: '#ff9f1c' } },
  grok: { part: 'topper_grok', colors: { Main: '#ffc93c', Accent: '#2b2d42' } },
  muse: { part: 'topper_muse', colors: { Main: '#f472b6', Accent: '#fff3b0' } },
  dsh: { part: 'topper_dsh', colors: { Main: '#1d7fd1', Accent: '#bfe9ff' } },
  cursor: { part: 'topper_cursor', colors: { Main: '#f7f3ea', Accent: '#2b2d42' } },
  custom: { part: 'topper_custom', colors: { Main: '#adb5bd', Accent: '#ef8a3c' } },
};

/** The emblem a worker on `provider` wears: the plain one for none, or for one the table doesn't know. */
export function topperFor(provider: AgentProvider | undefined): Topper {
  return (provider && Object.hasOwn(TOPPERS, provider) && TOPPERS[provider]) || DEFAULT_TOPPER;
}

/** How an emblem moves: how fast it turns (radians a second), how far it bobs (m), and how much it swells with each beat. */
export interface TopperLife {
  turn: number;
  bob: number;
  pulse: number;
}

const ASLEEP: TopperLife = { turn: 0, bob: 0, pulse: 0 };
const AWAKE: TopperLife = { turn: 0.8, bob: 0.01, pulse: 0 };
const BUSY: TopperLife = { turn: 3.4, bob: 0.004, pulse: 0.12 };

/**
 * How a worker's emblem moves while it's in `status`, the status its light already shows: turning
 * slowly and bobbing while it's about, spinning and beating while it works, and still, facing
 * forward, once it's asleep.
 */
export function topperLife(status: WorkerStatus): TopperLife {
  if (status === 'working') return BUSY;
  return status === 'exited' || status === 'offline' ? ASLEEP : AWAKE;
}

/** Eased turning, kept between frames: the angle it's at and how fast it's going. */
export interface TopperSpin {
  angle: number;
  speed: number;
}

/**
 * Turns an emblem on by `dt` seconds toward `life`'s speed (times its own `spin`), easing up to it and
 * back down. One that's to stand still comes round to face forward the short way and stops there.
 */
export function turnTopper(s: TopperSpin, life: TopperLife, spin: number, dt: number): TopperSpin {
  const want = life.turn * spin;
  s.speed += (want - s.speed) * Math.min(1, dt * 3);
  s.angle = (s.angle + s.speed * dt) % (Math.PI * 2);
  if (want === 0) {
    const home = s.angle > Math.PI ? Math.PI * 2 : 0;
    s.angle += (home - s.angle) * Math.min(1, dt * 4);
  }
  return s;
}
