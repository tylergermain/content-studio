import { BALL, HOOP } from './hoop.js';

/** Reach the rim near the top of a normal jump, without requiring perfect aim. */
export function canDunk(pos: { x: number; y: number; z: number }, grounded: boolean): boolean {
  return !grounded && [pos.x, pos.y, pos.z].every(Number.isFinite)
    && pos.y >= 0.7 && pos.y <= 1.6
    && Math.hypot(pos.x - HOOP.rim.x, pos.z - HOOP.rim.z) <= 1.4;
}

/** Put the ball down through the center, using the regular shared ball simulation. */
export function dunkShot() {
  return { x: HOOP.rim.x, y: HOOP.rim.y + BALL.r + 0.15, z: HOOP.rim.z, vx: 0, vy: -3, vz: 0 };
}
