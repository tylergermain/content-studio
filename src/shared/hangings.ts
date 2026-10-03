// What hangs on a wall as furniture: a painting (the `painting` kind in shared/furniture.ts), a frame
// like the ones people hang with F (shared/decor.ts), but a piece of the layout: it's saved with the
// floor, it goes on any wall the builder has put up, and it works upstairs.

import { FRAME_BORDER, pictureSize } from './decor.js';
import type { Piece } from './furniture.js';

/** A painting nobody's set up yet: 1.2 m on its long side, landscape, its middle at eye level, in the gold frame. */
export const PAINTING = { size: 1.2, aspect: 4 / 3, lift: 1.6, frame: 3 } as const;

/** How much wall it takes, frame and all: `size` on its long side, shaped like its picture (`aspect`, width over height). */
export function hangSize(p: Pick<Piece, 'size' | 'aspect'>): { w: number; h: number } {
  const { w, h } = pictureSize(p.size ?? PAINTING.size, p.aspect ?? PAINTING.aspect);
  return { w: w + 2 * FRAME_BORDER, h: h + 2 * FRAME_BORDER };
}
