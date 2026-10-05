import test from 'node:test';
import assert from 'node:assert/strict';
import { HOOP, SWEET, backboard, hoopArms, lookAtRim, throwPitch, type Solid } from '../src/shared/hoop.js';
import { farAim, farRelease, farShot } from '../src/shared/hoop-range.js';
import { rimDistance } from '../src/shared/longshots.js';
import { DEFAULT_FURNITURE } from '../src/shared/furniture.js';
import { roomOf } from '../src/shared/floorplan.js';
import { flyShot, floorSolids } from '../src/server/shot-judge.js';
import { ballSolids, hoop } from '../src/client/features/basketball/world.js';
import type { Site } from '../src/client/world/office/fixture.js';
import type { Adopted } from '../src/client/world/office/furnish.js';

// The hoop as a page has it and as the office has it. A page flies a throw past the floor's own list of
// what's in the way, the backboard and its arms on it as the page puts the hoop up; the office flies it
// past its own (server/shot-judge.ts). A heave can go through the thin board into the arms behind it
// between one step and the next, and pushed out of them twice it comes out another way than pushed out
// once: a basket on the page the office doesn't count, or one on the board that nobody saw go in.

const HOOP_PIECE = DEFAULT_FURNITURE.find((p) => p.kind === 'hoop')!;

/**
 * The floor's list of what's in the way, with the hoop put up on it the way the page puts it up (see
 * buildOffice in client/world/office/build.ts): its fixture builds it, the furniture stands it where
 * the floor has it there and then (adopt and stand in client/world/office/furnish.ts), and whatever
 * colliders the fixture hands back go on the list too. And the office builder taking it down, and
 * putting it back up.
 */
function pageFloor() {
  const colliders: Solid[] = [];
  let adopted: Adopted | undefined;
  const site = {
    colliders,
    wall: () => ({ wall: 'west', u0: 0, u1: 0, y0: 0, y1: 0 }),
    get: (key: string) => {
      assert.equal(key, 'furniture');
      return {
        adopt: (_kind: string, parts: Adopted) => {
          adopted = parts;
          parts.moved?.(HOOP_PIECE);
        },
      };
    },
  } as unknown as Site;
  const built = hoop(site);
  colliders.push(...(built.colliders ?? []));
  return { colliders, down: () => adopted!.moved?.(undefined), up: () => adopted!.moved?.(HOOP_PIECE) };
}

const same = (a: Solid, b: Solid) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ && a.top === b.top && (a.bottom ?? 0) === (b.bottom ?? 0) && !!a.board === !!b.board;
const theHoop = (c: Solid) => same(c, backboard()) || same(c, hoopArms());

/** The floor as the office flies a throw past it, and all of that but the hoop. */
const office = floorSolids({ furniture: DEFAULT_FURNITURE, room: roomOf(undefined) });
const rest = office.filter((c) => !theHoop(c));

test("the page puts the hoop's backboard and arms in the way once, and takes them away with it", () => {
  const floor = pageFloor();
  const count = (c: Solid) => floor.colliders.filter((d) => same(d, c)).length;
  assert.deepEqual([count(backboard()), count(hoopArms())], [1, 1]);
  assert.equal(floor.colliders.length, 2, 'nothing else of the hoop');
  floor.down();
  assert.deepEqual([count(backboard()), count(hoopArms())], [0, 0], 'taken down');
  floor.up();
  floor.up();
  assert.deepEqual([count(backboard()), count(hoopArms())], [1, 1], 'put back up, once');
  // Anything else on the list twice (a piece of furniture the office's own features built can be: see
  // stand in furnish.ts), a throw still flies past it once.
  const twice = ballSolids([...floor.colliders, ...rest, ...floor.colliders, rest[2]]);
  assert.equal(twice.length, new Set(twice).size);
  assert.equal(twice.length, rest.length + 2);
});

test('a throw flies past the hoop on the page as it does in the office: the same baskets on both', () => {
  // The rest of the floor as the office has it, and the hoop as the page puts it up.
  const page = ballSolids([...rest, ...pageFloor().colliders]);
  const doubled = [...page, backboard(), hoopArms()];
  // From where heaves let go of late in the green went through the board into its arms: way out to the
  // side of the court, eyes up as in third person and first.
  let differ = 0;
  for (const [x, z, y] of [
    [12.5, 7.5, 1.95],
    [16.5, 5.5, 1.4],
    [16.5, 5.5, 1.95],
  ]) {
    const toRim = Math.atan2(HOOP.rim.x - x, HOOP.rim.z - z);
    const from = { x: x + Math.sin(toRim) * 0.3, y, z: z + Math.cos(toRim) * 0.3 };
    const aim = farAim(from, throwPitch(lookAtRim(from)), rimDistance(from))!;
    const shot = farShot(from, aim, page);
    // The whole meter, and every bit of the green and either side of it more finely.
    const powers = [...Array.from({ length: 201 }, (_, i) => i / 200), ...Array.from({ length: 401 }, (_, i) => SWEET.at - aim.width + (i / 400) * aim.width * 2)];
    for (const power of powers) {
      const out = farRelease(from, aim.heading, shot, power, page);
      const c = Math.cos(out.pitch);
      const t = { ...from, vx: Math.sin(aim.heading) * c * out.speed, vy: Math.sin(out.pitch) * out.speed, vz: Math.cos(aim.heading) * c * out.speed };
      const made = flyShot(t, office).made;
      assert.equal(flyShot(t, page).made, made, `from ${rimDistance(from).toFixed(1)} m (standing at ${x}, ${z}, eyes ${y} m up) let go at ${power.toFixed(4)}: ${made ? 'in' : 'out'} in the office`);
      if (flyShot(t, doubled).made !== made) differ++;
    }
  }
  // Flown past the board and its arms twice, as the page used to, some of these go another way.
  assert.ok(differ > 0, 'throws that go through the board into its arms');
});
