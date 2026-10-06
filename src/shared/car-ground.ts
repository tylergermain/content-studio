import { FARM, LAKE, shoreX, CREEK } from './scenic.js';

// What's under a car's wheels, off the road too (see paved in shared/garage.ts for the road): the grass
// everywhere round the town and the loop, the farm's fields, the beach's sand and the creek's
// shallows, each with how well the tyres hold on it and how fast a car can go there. The sea, the lake
// and past the edge of the map nobody drives into; what stands on the ground (trees, walls, the
// mountains' feet, the farm's buildings) is the driver's page to run into (world colliders).

export type SurfaceName = 'road' | 'dirt' | 'grass' | 'sand' | 'water';

export interface Surface {
  name: SurfaceName;
  /** How well the tyres hold (1 on the road): how hard it can corner and brake. */
  grip: number;
  /** How much of its top speed a car makes on it. */
  top: number;
  /** How much more it drags (m/s²) than the road: rolling through it slows a car down. */
  drag: number;
}

export const SURFACES: Record<SurfaceName, Surface> = {
  road: { name: 'road', grip: 1, top: 1, drag: 0 },
  dirt: { name: 'dirt', grip: 0.72, top: 0.72, drag: 2 },
  grass: { name: 'grass', grip: 0.62, top: 0.64, drag: 3 },
  sand: { name: 'sand', grip: 0.46, top: 0.46, drag: 6 },
  water: { name: 'water', grip: 0.38, top: 0.26, drag: 14 },
};

/** How far out a car can go, every way: past the loop to the foot of the mountains, the sea and the woods. */
export const MAP = { minX: -300, maxX: 330, minZ: -160, maxZ: 420 } as const;
/** How wide the creek's water is either side of its middle. */
const CREEK_HALF = 3.2;

/** How far (x, z) is from the creek's middle, as the crow flies. */
function fromCreek(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < CREEK.length - 1; i++) {
    const [ax, az] = CREEK[i];
    const [bx, bz] = CREEK[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * k, z - az - ez * k));
  }
  return best;
}

/** Whether (x, z) is in the lake, its muddy edge included. */
function inLake(x: number, z: number): boolean {
  return ((x - LAKE.x) / (LAKE.rx + 1.5)) ** 2 + ((z - LAKE.z) / (LAKE.rz + 1.5)) ** 2 <= 1;
}

/**
 * The ground at (x, z) off the road, or null where no car goes: in the sea or the lake, or off the
 * map. `paved` is whether it's the road (shared/garage.ts says), passed in to keep this off it.
 */
export function groundAt(x: number, z: number, paved: boolean): Surface | null {
  if (paved) return SURFACES.road;
  if (x < MAP.minX || x > MAP.maxX || z < MAP.minZ || z > MAP.maxZ) return null;
  const shore = shoreX(z);
  if (x < shore + 1 || inLake(x, z)) return null;
  if (x < shore + 14) return SURFACES.sand;
  if (x > 100 && z > 160 && z < 210 && fromCreek(x, z) < CREEK_HALF) return SURFACES.water;
  if (FARM.fields.some((f) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ)) return SURFACES.dirt;
  return SURFACES.grass;
}
