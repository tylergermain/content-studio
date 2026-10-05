// How you move (see PlayerController in index.ts): in m/s, and m/s² for gravity. No three.js, for the tests.

export const WALK = 4.6;
export const RUN = 7.5;
export const JUMP_V = 6.4;
export const GRAVITY = 18;
/** How high a plain jump takes your feet: a ledge (or a railing) lower than this you can hop up onto. */
export const JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAVITY);
