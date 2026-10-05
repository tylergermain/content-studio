// Putt Street's holes as data, which both sides read: the office rolls every putt over them
// (physics.ts) and the page builds the course from them (features/minigolf/world.ts). Everything is in
// the street frame (shared/mainstreet.ts): x and z on the ground, heights above the street. A hole sits
// in its cell (PUTT_CELLS), 10 m square.
//
// Headings are as everywhere else in the office: yaw 0 looks down +z (south, away from Main Street),
// yaw π/2 down +x (east). Looking along a yaw, its right is (-cos yaw, sin yaw): west when you face
// south, south when you face east.

/** A point on the ground. */
export interface XZ {
  x: number;
  z: number;
}

/**
 * A patch of felt the ball rolls on: a convex polygon (its corners in order round it), at `h` above
 * the street at its first corner, level or sloped (`slope`: how much it rises per meter along x and
 * along z: a ramp, a banked bend). Neighbouring patches meet at the same height, so the ball rolls
 * from one to the next; where patches overlap, the higher one is the felt. A ball rolling off one of
 * its `lips` (edge i runs from corner i to the next) is launched into the air rather than rolling on
 * to what's next (the jump).
 */
export interface Felt {
  poly: XZ[];
  h: number;
  slope?: XZ;
  lips?: number[];
}

/**
 * A cone of felt the ball rolls up and over (the volcano), standing on felt at `h`: it rises straight
 * from its foot, `r` round (x, z), to `height` at its top, or at the rim of its crater, which dips
 * `depth` back down to the crater's middle (where the cup is), `r` round. heightAt in physics.ts is
 * its shape.
 */
export interface Cone {
  x: number;
  z: number;
  r: number;
  h: number;
  height: number;
  crater?: { r: number; depth: number };
}

/** A grassy mound the ball can't roll up (the three tunnels' hill): its foot is a wall, but for its tunnels' mouths. */
export interface Hill {
  x: number;
  z: number;
  /** Half-sizes of its oval foot, along x and z. */
  rx: number;
  rz: number;
  height: number;
}

/**
 * A wall along `pts` (a bend is several points), `height` over the felt at its foot, keeping `bounce`
 * of the speed into it (0.75 when it doesn't say) and most of the speed along it. The white kerbs round
 * the felt are walls too. A wall has a point wherever the felt under it changes slope (a ramp's foot
 * and top), so its foot is the felt's height at each point and straight between them.
 */
export interface Wall {
  pts: XZ[];
  height: number;
  bounce?: number;
  /** How it's drawn: a kerb you can step over, a timber rail, a stone wall, the mill's house. */
  look?: 'kerb' | 'rail' | 'stone' | 'house';
}

/** A round bumper post; it gives back `bounce` of the speed into it (0.85 when it doesn't say), never more than all of it. */
export interface Bumper {
  x: number;
  z: number;
  r: number;
  bounce?: number;
}

/**
 * The windmill: its house `base` square at (x, z), turned `yaw`, `height` tall, with a tunnel `tunnel`
 * wide through its foot along its yaw (the way the ball goes through). Its `blades` sails turn on the
 * face the ball goes in at (the side the tee is on), once every `period` seconds on the office's clock.
 * Drawn turned millAngle(mill, officeMs) from a sail pointing straight down over the tunnel's mouth,
 * a sail covers the mouth for `shut` of each sail's turn, half of it either side of straight down:
 * exactly while millOpen (physics.ts) says it's shut.
 */
export interface Mill {
  x: number;
  z: number;
  yaw: number;
  base: number;
  height: number;
  tunnel: number;
  blades: number;
  period: number;
  shut: number;
}

/**
 * The loop-the-loop: in at `entry` heading `yaw`, a circle `r` round standing on the felt, coming out
 * `offset` to the right of where it went in (looking along yaw; to the left when it's negative), still
 * heading `yaw`. Slower than `minSpeed` at its foot, the ball rolls back out the way it came. Its track
 * is `width` wide (LOOP_WIDTH when it doesn't say), as the chutes in and out of it are.
 */
export interface Loop {
  entry: XZ;
  yaw: number;
  r: number;
  offset: number;
  minSpeed: number;
  width?: number;
}

/**
 * A tunnel through a hill: in at `mouth` (`r` wide either side of it, on the hill's foot), out at
 * `exit` heading `yaw`, `delay` seconds later and a little slower than it went in (ROLL in physics.ts).
 */
export interface Tunnel {
  mouth: XZ;
  r: number;
  exit: XZ;
  yaw: number;
  delay: number;
}

/** Water, a convex polygon, its surface at `h`: a ball in it costs a stroke and goes back where it was putted from. */
export interface Water {
  poly: XZ[];
  h: number;
}

/**
 * The Friday Tower arch the ball goes under on the last hole: decoration, standing across the lane at
 * (x, z) with the ball going under it along `yaw`, its two posts `width` apart (outside the lane's
 * kerbs, so the ball never meets them) and `height` tall.
 */
export interface Arch {
  x: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
}

export interface Hole {
  /** 1..9. */
  n: number;
  name: string;
  par: number;
  /** Its cell's middle (PUTT_CELLS in shared/mainstreet.ts). */
  cell: XZ;
  /** Where the ball is teed up, and the cup. Their heights are the felt's there (heightAt in physics.ts). */
  tee: XZ;
  cup: XZ;
  felt: Felt[];
  cones?: Cone[];
  hills?: Hill[];
  walls: Wall[];
  bumpers?: Bumper[];
  mill?: Mill;
  loop?: Loop;
  tunnels?: Tunnel[];
  water?: Water[];
  arch?: Arch;
  /**
   * Where a ball can come to rest but nobody could stand to putt it (under the arch, on a slope, up
   * the volcano, in the windmill's tunnel): it's moved a club length (CLUB) out of these.
   */
  keepOff?: XZ[][];
}

/** The ball's radius: golf's (features/golf/tee.ts), so the two balls look alike. */
export const BALL_R = 0.05;
/** The cup: its radius as drawn; it takes a ball whose middle comes within `take` of its middle slower than `speed` (m/s). */
export const CUP = { r: 0.054, take: 0.11, speed: 1.4 } as const;
/** How far a ball that stops where it can't be putted from is moved, to the nearest spot it can be. */
export const CLUB = 0.9;
/** You stand this far from your ball, side-on to it, to putt. */
export const STANCE = 0.45;
/** The physics' steps a second (golf's own rate, so a fast ball can't step through a kerb or a bumper). */
export const STEPS = 240;
/**
 * The putting meter has golf's shape (features/golf/controller.ts METER): from nothing to full in `up`
 * seconds while Space is held, then back down in as long again. Slower than golf's, and puttSpeed
 * (physics.ts) gives the low end of it more room, so a straight 3 m putt has a window of at least
 * 120 ms to drop (tests/minigolf.test.ts holds it to that).
 */
export const PUTT_METER = { up: 1.8 } as const;
/** A loop-the-loop's track, and the chutes in and out of it, are this wide when it doesn't say. */
export const LOOP_WIDTH = 0.5;
