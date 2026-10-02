import { BALL, HOOP, WIND_UP } from './hoop.js';

/** Charging saturates rather than cycling back to an easy shot after a long hold. */
export function throwCharge(held: number): number {
  return Math.max(0, Math.min(1, held / WIND_UP));
}

/** Aim and charge alone set launch velocity. No correction toward the hoop. */
export function physicalThrow(from: { x: number; y: number; z: number }, heading: number, pitch: number, held: number) {
  const speed = BALL.maxSpeed * throwCharge(held);
  const c = Math.cos(pitch);
  return { ...from, vx: Math.sin(heading) * c * speed, vy: Math.sin(pitch) * speed, vz: Math.cos(heading) * c * speed };
}

/** A close downward release from above the ring can earn a dunk if physics scores it. */
export function dunkRelease(from: { x: number; y: number; z: number }, grounded: boolean, pitch: number): boolean {
  return !grounded && from.y >= HOOP.rim.y + BALL.r && pitch < 0
    && Math.hypot(from.x - HOOP.rim.x, from.z - HOOP.rim.z) <= HOOP.rim.r + BALL.r;
}
