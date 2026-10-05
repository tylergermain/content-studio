/**
 * Which free seats show their "+" (world/office/hire-marker.ts). One over every empty desk made a long
 * bench look unfinished, so a "+" shows on the free seats near you and on the one you look at, fading
 * in and out, and on every free seat while you're in the office builder or have the Workers list open,
 * to see where there's room to hire.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { markerIn, showMarker } from '../../world/office/hire-marker';

/** How near you (meters) a free seat shows its "+", and how far you go before it fades again. */
export const NEAR = 5;
export const LEAVE = 5.6;
/**
 * The seat you look at: the middle of your view passes within LOOK_MISS meters of it, from its "+" down
 * SEAT_DROP meters to near the floor (the desk, the chair or the bean bag), at most LOOK_FAR away.
 */
export const LOOK_MISS = 1.1;
export const SEAT_DROP = 1.1;
export const LOOK_FAR = 22;
/**
 * A "+" further than KEEP_FROM meters from the camera grows to stay the size it is from there, up to
 * MAX_GROW times its own: the desk you look at across the room, every one from up over the builder.
 */
export const KEEP_FROM = 8;
export const MAX_GROW = 3;
/** Seconds to fade in, and to fade out. */
export const FADE_IN = 0.25;
export const FADE_OUT = 0.5;
/** Where "you" are, over your feet: about as high as the "+" floats. */
const CHEST = 1.3;

interface P {
  x: number;
  y: number;
  z: number;
}

/**
 * How far a seat whose "+" is at `p` is off the middle of the view from `eye` along `dir` (a unit
 * vector), as the tangent of the angle; Infinity when it's behind you, over LOOK_FAR away or more than
 * LOOK_MISS off to the side. The seat is the upright line from `p` down `drop` meters, and what's
 * measured is the point of it at the height your view is as it passes.
 */
export function offView(eye: P, dir: P, p: P, drop = SEAT_DROP): number {
  const flat = dir.x * dir.x + dir.z * dir.z;
  const t = flat > 1e-6 ? ((p.x - eye.x) * dir.x + (p.z - eye.z) * dir.z) / flat : 0;
  const vx = p.x - eye.x;
  const vy = Math.min(p.y, Math.max(p.y - drop, eye.y + t * dir.y)) - eye.y;
  const vz = p.z - eye.z;
  const along = vx * dir.x + vy * dir.y + vz * dir.z;
  if (along < 0.3 || along > LOOK_FAR) return Infinity;
  const miss = Math.hypot(vx - along * dir.x, vy - along * dir.y, vz - along * dir.z);
  return miss > LOOK_MISS ? Infinity : miss / along;
}

/** Whether a "+" `d` meters from you is near enough to show: one showing already stays out to LEAVE. */
export const nearYou = (d: number, showing: boolean) => d < (showing ? LEAVE : NEAR);

/** How many times its size a "+" `d` meters from the camera is drawn (see KEEP_FROM). */
export const growAt = (d: number) => Math.min(MAX_GROW, Math.max(1, d / KEEP_FROM));

/** A "+" at `opacity`, `dt` seconds on toward showing (1) or gone (0). */
export function fade(opacity: number, want: boolean, dt: number): number {
  return want ? Math.min(1, opacity + dt / FADE_IN) : Math.max(0, opacity - dt / FADE_OUT);
}

/** Fades each free seat's "+" in or out every frame (see above). */
export function createHireMarkers(ctx: Ctx) {
  const { camera, player, settings, activities } = ctx;
  const eye = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const at = new THREE.Vector3();
  const you = new THREE.Vector3();

  /** The "+" of each free seat that's out, with nothing done to the rest but putting theirs away. */
  function* free(): Generator<THREE.Sprite> {
    for (const view of ctx.world().desks.values()) {
      const plus = markerIn(view.vacancy);
      if (!plus) continue;
      if (view.vacancy.visible && view.group.visible) yield plus;
      else if (plus.visible) showMarker(plus, 0);
    }
  }

  ctx.ticks.add('world', ({ dt }) => {
    const all = activities.running('office-builder') || settings.hud.workers;
    camera.getWorldPosition(eye);
    camera.getWorldDirection(dir);
    you.set(player.pos.x, player.pos.y + CHEST, player.pos.z);
    // The one you look at: nearest the middle of your view, the "+" or the seat under it.
    let looked: THREE.Sprite | null = null;
    let best = Infinity;
    if (!all) {
      for (const plus of free()) {
        const off = offView(eye, dir, at.setFromMatrixPosition(plus.matrixWorld));
        if (off < best) {
          best = off;
          looked = plus;
        }
      }
    }
    for (const plus of free()) {
      at.setFromMatrixPosition(plus.matrixWorld);
      const opacity = plus.material.opacity;
      const want = all || plus === looked || nearYou(at.distanceTo(you), opacity > 0);
      if (want || opacity > 0) showMarker(plus, fade(opacity, want, dt), growAt(at.distanceTo(eye)));
    }
  });
}
