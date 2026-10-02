// Marc, the office goat. The building has the one: he lives on its bottom floor, unless he has followed
// someone into the elevator since (see server/goat.ts). As with the dog, the server decides what he does
// and sends one GoatState per leg of his day; every browser on his floor works out from that where he is
// at any moment (dogAt in shared/dog.ts walks a leg's path), so everyone sees him in the same spot.

export const GOAT_NAME = 'Marc';

/**
 * What he does once he gets where he's going: stand about, look at someone, graze on a plant, nibble a
 * rug's corner, lie down, stop after a dash, headbutt a punching bag, or enjoy a pat.
 */
export type GoatAct = 'stand' | 'look' | 'graze' | 'nibble' | 'lie' | 'zoom' | 'butt' | 'pet';

export interface GoatState {
  /** This leg: from where he was when it began, on through each point in turn. Never empty. */
  path: [number, number][];
  /** Meters per second along the path. */
  speed: number;
  /** How long ago the leg began, in ms, as of when the server sent it. */
  elapsed: number;
  act: GoatAct;
  /** Which way he faces once he's there (rotation around y; 0 looks down +z). */
  face?: number;
  /** The person he has his eye on: his head turns to them. */
  watching?: string;
  /** The person he's tagging along after. */
  following?: string;
  /** Who last petted him. */
  petBy?: string;
  /** How many pats he's had since the office opened: a page tells a new one by it going up. */
  pets: number;
  /** The piece of furniture he's at: the plant he grazes on, the rug he nibbles, the bag he butts. */
  piece?: string;
  /** In the elevator, on his way after whoever he's following: out of sight once he's there. */
  riding?: boolean;
}

/** How fast he goes from which he's dashing (the zoomies), rather than walking or trotting. */
export const GOAT_DASH = 3.2;
/** A pat lasts this long, tail wagging. */
export const GOAT_PET_MS = 2600;
/** Headbutting the bag: this long after he gets to it he butts it, and again each time this much later, this many times. */
export const GOAT_BUTT = { first: 0.9, every: 1.5, times: 2 } as const;

export type GoatClientMsg =
  /** Give Marc a pat; he has to be on your floor and within reach. */
  { t: 'goat.pet' };

export type GoatServerMsg =
  /** What Marc is up to now, sent to the floor he's on at the start of each leg of his day; null when he has just left it. */
  { t: 'goat'; goat: GoatState | null };
