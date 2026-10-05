/**
 * What the Touch controllers' buttons and sticks mean, as plain functions of their numbers (no
 * WebXR, no DOM, so tests/vr-input.test.ts runs them as they are): the sticks' dead zone, a button's
 * press and its edges, snap turning's flick, where a trigger pull goes, and the things the trigger
 * doesn't do in VR yet. controllers.ts reads the pads through these; interact.ts and locomotion.ts act on them.
 */
import type { Btn, Hand } from './types';

/** How far a stick must lean (0–1) before it counts: Touch sticks rest a little off centre. */
export const DEADZONE = 0.15;

/** A button's value (0–1) that presses it, and the lower one it must drop under to let go again (no chatter at the edge). */
export const PRESS = 0.55;
export const RELEASE = 0.35;

/** Snap turning: a flick past FIRE turns once; the stick must come back under REARM before it turns again. */
export const SNAP_FIRE = 0.7;
export const SNAP_REARM = 0.3;

/** How long (ms) A must be held, in a text field with a 🎤, to be push to talk rather than a tap that shows the keyboard. */
export const HOLD_MS = 300;

/**
 * The kinds of thing whose use flies the camera about (the telescope, the golf tee, the dart board
 * and the axe lane): with the headset owning the camera there's nothing to see, so the trigger
 * there says "Not in VR yet" instead of pressing E.
 */
export const VR_BLOCKED: ReadonlySet<string> = new Set(['telescope', 'golf', 'darts', 'axe']);

/** A button that's up and has been. */
export const IDLE: Btn = Object.freeze({ pressed: false, down: false, up: false, value: 0 });

/** One axis through the dead zone: 0 inside it, rescaled to 0–1 past it, sign kept. Not a number (IWER's null) is 0. */
export function deadzone(v: number | null | undefined, dz = DEADZONE): number {
  const a = Math.abs(v ?? 0);
  if (!(a > dz)) return 0;
  return Math.sign(v!) * Math.min(1, (a - dz) / (1 - dz));
}

/**
 * A stick through a round dead zone: still inside it, and past it its lean rescaled to 0–1 the way
 * it points (so a diagonal isn't faster than straight ahead). Written into `out`.
 */
export function deadzone2(x: number | null | undefined, y: number | null | undefined, dz = DEADZONE, out = { x: 0, y: 0 }): { x: number; y: number } {
  const sx = Number.isFinite(x) ? (x as number) : 0;
  const sy = Number.isFinite(y) ? (y as number) : 0;
  const len = Math.hypot(sx, sy);
  if (!(len > dz)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const k = Math.min(1, (len - dz) / (1 - dz)) / len;
  out.x = sx * k;
  out.y = sy * k;
  return out;
}

/** A gamepad button as the browser has it (GamepadButton), or null when the controller's gone. */
export interface RawButton {
  readonly pressed: boolean;
  readonly value: number;
}

/**
 * The button this frame, from last frame's and the gamepad's: pressed past PRESS and held until it
 * drops under RELEASE, `down` the frame it went down and `up` the frame it came up. A button the
 * browser says is pressed but gives no value (a digital one) is all the way down. Gone (null), it's up.
 */
export function readButton(prev: Btn, raw: RawButton | null | undefined): Btn {
  const v = !raw ? 0 : raw.pressed && !(raw.value > 0) ? 1 : Math.min(1, Math.max(0, raw.value || 0));
  const pressed = prev.pressed ? v > RELEASE : v >= PRESS;
  if (!pressed && !prev.pressed && v === 0) return IDLE;
  return { pressed, down: pressed && !prev.pressed, up: !pressed && prev.pressed, value: v };
}

/**
 * Snap turning on a stick's x: past SNAP_FIRE it turns once (+1 to the right, clockwise seen from
 * above; -1 to the left) and disarms; back under SNAP_REARM it's armed again.
 */
export function snapStep(armed: boolean, x: number): { armed: boolean; turn: -1 | 0 | 1 } {
  if (armed && Math.abs(x) > SNAP_FIRE) return { armed: false, turn: x > 0 ? 1 : -1 };
  if (!armed && Math.abs(x) < SNAP_REARM) return { armed: true, turn: 0 };
  return { armed, turn: 0 };
}

/**
 * The keys a stick holds down for what reads keys rather than the stick (the ladder, a fire pole, a
 * car): W/S past `at` forward or back, A/D past `at` to a side. y + is back, as sticks have it.
 */
export function stickKeys(x: number, y: number, at = 0.5): string[] {
  const keys: string[] = [];
  if (y < -at) keys.push('KeyW');
  if (y > at) keys.push('KeyS');
  if (x < -at) keys.push('KeyA');
  if (x > at) keys.push('KeyD');
  return keys;
}

/**
 * Where a trigger pull goes, settled when it goes down (and kept until it comes up, wherever the ray
 * wanders): onto the panel it's on; with a window up, into the world under it (the office builder's
 * floor, see PanelHost.worldClick); at something VR can't do yet, a toast; else it's E.
 */
export type TriggerRoute = 'panel' | 'world' | 'blocked' | 'key';
export function triggerRoute(o: { onPanel: boolean; windowUp: boolean; blocked: boolean }): TriggerRoute {
  if (o.onPanel) return 'panel';
  if (o.windowUp) return 'world';
  if (o.blocked) return 'blocked';
  return 'key';
}

/** A press of A: a tap shows or hides the keyboard; held past HOLD_MS where there's a 🎤 to talk to, it's push to talk. */
export function aPress(heldMs: number, mic: boolean): 'wait' | 'talk' | 'keyboard' {
  if (!mic) return 'keyboard';
  return heldMs >= HOLD_MS ? 'talk' : 'wait';
}

/**
 * With one controller (a flat battery, a broken one, one put down), how long the other must have been
 * missing before its jobs move over to the one there is: a controller can drop out for a moment.
 */
export const SOLO_AFTER_MS = 1500;
/** With one controller, B (or Y) held this long brings up the HUD sheet rather than going back. */
export const SHEET_HOLD_MS = 500;
/** With one controller, its stick clicked in and held this long opens the perf overlay. */
export const PERF_HOLD_MS = 1200;

/**
 * The hand that's on its own: the one controller the headset reports while the other has been
 * missing for SOLO_AFTER_MS, else null (both there, or neither). `seen` is when each was last there,
 * in performance.now()'s ms.
 */
export function soloHand(now: number, seen: Readonly<Record<Hand, number>>, there: Readonly<Record<Hand, boolean>>): Hand | null {
  if (there.left === there.right) return null;
  const only: Hand = there.left ? 'left' : 'right';
  return now - seen[only === 'left' ? 'right' : 'left'] >= SOLO_AFTER_MS ? only : null;
}

/**
 * One stick doing both sticks' jobs: leaning more to a side than forward or back, it snap-turns
 * (`turnX`); otherwise it walks forward or back (`walk`, + is back, as sticks have it), with no
 * sidestep. Written into `out`.
 */
export function soloStick(x: number, y: number, out = { turnX: 0, walk: 0 }): { turnX: number; walk: number } {
  const side = Math.abs(x) > Math.abs(y);
  out.turnX = side ? x : 0;
  out.walk = side ? 0 : y;
  return out;
}

/**
 * A button that does one thing held and another tapped: 'hold' the frame it has been down `holdMs`
 * (once a press: `done` says it already went), 'tap' when it comes up before that, else null.
 */
export function holdOrTap(b: Btn, heldMs: number, done: boolean, holdMs: number): 'hold' | 'tap' | null {
  if (done) return null;
  if (b.pressed && heldMs >= holdMs) return 'hold';
  if (b.up) return 'tap';
  return null;
}
