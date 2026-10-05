// Friday Tower's shape over its real floors, for the page that draws it (world/facade.ts re-exports it)
// and for the office's server, which keeps Friday One out of it (see shared/heli.ts). Numbers only.

/**
 * The tower: `storeys` tall from the bottom office floor (storey 0) up, however many floors there
 * are. The real floors are the bottom ones; over them it's three bars of glass stacked and shifted
 * like the Friday Labs mark, each from storey `from` up to (not including) `to`, `minX`..`maxX` along
 * the building (its z is the building's). A storey of a bar is a `spandrel`, `glass`, a `spandrel`
 * and `glass` again, with a mullion every `mullion`; at each bar's foot a `seam` `height` high, from
 * `below` under that storey's floor, set back `inset`.
 */
export const TOWER = {
  storeys: 15,
  bars: [
    { from: 3, to: 7, minX: -15.9, maxX: 18.3 },
    { from: 7, to: 11, minX: -20.7, maxX: 15.9 },
    { from: 11, to: 15, minX: -18.3, maxX: 18.3 },
  ],
  glass: 3.25,
  spandrel: 0.3,
  mullion: 2.44,
  seam: { below: 0.3, height: 1.2, inset: 0.5 },
} as const;
