/**
 * Pointing at things and using them: what's under the crosshair (first person) or what you're
 * standing at (third), within each kind's reach (see ctx.interactions), the note on the issues board
 * the mouse points at, and clicking the world to use what's there.
 */
import * as THREE from 'three';
import { buildTrees, wantTree } from '../core/ray-trees';
import { SLAB } from '../../shared/layout';
import type { GhIssue } from '../../shared/protocol';
import type { Ctx } from '../core/context';
import type { CoreState } from '../core/ctx';
import type { Parts } from '../core/parts';
import { interactionAvailable, type DeskKey } from '../interaction';
import { EYE_HEIGHT } from '../player';
import { store } from '../state';
import { modalOpen, toast } from '../ui/dom';
import type { Interactable } from '../world/types';

export type PointerParts = Pick<Parts, 'worlds' | 'rooftop' | 'place' | 'you' | 'boards' | 'cards' | 'seating' | 'hoops' | 'emotes' | 'hanging' | 'telescope' | 'hintbar'>;

/**
 * Something to aim with instead of the camera's crosshair: its ray this frame (null while it points at
 * nothing in the world, at a panel say), and the eye that each kind's reach is measured from.
 */
export interface Aim {
  ray(): THREE.Ray | null;
  eye(): THREE.Vector3;
}

/** Listens for the mouse over the canvas, registers the aim tick ('aim'), and takes the player's clicks. */
export function installPointer(ctx: Ctx, core: CoreState, parts: PointerParts) {
  const { player, camera, canvas, office } = ctx;
  const { plan } = parts.worlds;
  const reach = () => parts.you.reach();

  let target: Interactable | null = null;
  /** The note on the issues board under the crosshair (or, in third person, the mouse), which E takes. */
  let aimedNote: GhIssue | null = null;
  /** Where the mouse is over the scene, for pointing at notes in third person; null when it's off it. */
  let pointer: THREE.Vector2 | null = null;

  function pickTarget(): Interactable | null {
    // Nearly everything you can use is upstairs; down on the street you're under it all, but for the
    // elevator's stop in the garage.
    const below = player.pos.y < -SLAB - 1;
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const list of usable()) {
      for (const it of list) {
        if (it.off) continue;
        if (below !== (it.y ?? 0) < -SLAB - 1) continue;
        // Up on the loft, or down underneath it.
        if (Math.abs((it.y ?? 0) - player.pos.y) > 1.5) continue;
        const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
        if (d < it.radius && d < bestD) {
          best = it;
          bestD = d;
        }
      }
    }
    return best;
  }

  /** What you can use where you are, and what's in the way of looking at it. */
  function usable(): (readonly Interactable[])[] {
    const roof = parts.rooftop.roof();
    if (core.upTop && roof) return [roof.interactables];
    return [office.interactables, ...ctx.usables.lists()];
  }

  /** `note` is the issue note you're pointing at on the issues board, if any (see aimedNote). */
  function interact(target: Interactable | null, key: DeskKey, note = aimedNote) {
    if (!target) return;
    if (target.kind !== 'issues') note = null;
    const carrying = core.carrying;
    if (key === 'E' && carrying && parts.cards.dropCard(target, carrying, note)) return;
    // What each kind of thing does is defined with it (see ctx.interactions).
    ctx.interactions.use(target, key, note);
  }

  /** Keys that use what you're facing: at a desk, each does something else (see interact). */
  function use(it: Interactable | null, key: DeskKey, note = aimedNote): boolean {
    const worker = it?.deskId ? store.workerAtDesk(it.deskId) : undefined;
    const room = !!(it?.deskId && plan().byId.get(it.deskId)?.room);
    if (!interactionAvailable(it, key, { worker, room, note, carrying: !!core.carrying })) return false;
    reach();
    interact(it, key, note);
    return true;
  }

  // ---- Clicking the world: use what's under the crosshair (first person) or the mouse (third) ----------
  const raycaster = new THREE.Raycaster();
  const CROSSHAIR = new THREE.Vector2(0, 0);
  const eye = new THREE.Vector3();
  /** What aims instead of the crosshair, if anything: a VR controller's ray (see features/vr/interact.ts). */
  let aim: Aim | null = null;

  /** The furthest anything can be used from (the longest reach of any kind), once they're all defined. */
  let longest = 0;

  /**
   * What the crosshair could land on: everything shown within reach of your eye (and of the camera, behind
   * you in third person), gathered every few frames, or as soon as you've moved, rather than the ray going
   * through the whole floor every frame. Things move a little between gatherings, which the slack allows.
   */
  const near: THREE.Object3D[] = [];
  const gathered = { x: Infinity, y: Infinity, z: Infinity, frame: -Infinity, roots: [] as THREE.Object3D[] };
  const NEAR_SLACK = 3;
  const GATHER_EVERY = 8;
  let frameNo = 0;
  const sphere = new THREE.Sphere();
  function nearby(roots: THREE.Object3D[], from: THREE.Vector3, reach: number): THREE.Object3D[] {
    const moved = Math.hypot(from.x - gathered.x, from.y - gathered.y, from.z - gathered.z);
    const same = roots.length === gathered.roots.length && roots.every((r, i) => r === gathered.roots[i]);
    if (same && moved < 1 && frameNo - gathered.frame < GATHER_EVERY) return near;
    near.length = 0;
    for (const root of roots) {
      root.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (!(m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) || !m.geometry) return;
        const g = m.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingSphere) return;
        sphere.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
        if (sphere.center.distanceTo(from) - sphere.radius > reach) return;
        near.push(o);
        // A big one gets a tree, so the ray finds its triangles quickly (core/ray-trees.ts).
        wantTree(o);
      });
    }
    Object.assign(gathered, { x: from.x, y: from.y, z: from.z, frame: frameNo, roots: [...roots] });
    return near;
  }

  /**
   * What the ray through `ndc` lands on first (or the one `aim` gives, measuring reach from its eye),
   * whether it is within reach (plus `slack` meters), and where it hit. `near` alone (what's aimed at
   * each frame) looks no further along the ray than anything could be in reach from the eye: whatever's
   * beyond is out of reach anyway, and the ray needn't be tested against the whole floor for it.
   */
  function aimedAt(ndc: THREE.Vector2, slack = 0, near = false): { it: Interactable; near: boolean; hit: THREE.Intersection } | null {
    if (aim) {
      const ray = aim.ray();
      if (!ray) return null;
      raycaster.set(ray.origin, ray.direction);
      raycaster.camera = camera;
      eye.copy(aim.eye());
    } else {
      raycaster.setFromCamera(ndc, camera);
      eye.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
    }
    longest ||= Math.max(0, ...ctx.interactions.kinds().map((k) => ctx.interactions.reach(k)));
    raycaster.far = near ? longest + slack + raycaster.ray.origin.distanceTo(eye) + 0.01 : Infinity;
    const roof = parts.rooftop.roof();
    const roots = core.upTop && roof ? roof.pickables : [office.group, ...ctx.usables.pickables()];
    // Each frame's aim tries only what's near (nearby); a click goes through everything.
    const hits = near ? raycaster.intersectObjects(nearby(roots, eye, raycaster.far + NEAR_SLACK), false) : raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let it: Interactable | undefined;
      let shown = true;
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (!o.visible) shown = false;
        it ??= o.userData.interact as Interactable | undefined;
      }
      if (!shown) continue;
      if (!it || it.off) return null; // a wall, the floor, a plant… is in the way
      // How close you must be to use it is each kind's own (see ctx.interactions).
      return { it, near: hit.point.distanceTo(eye) <= ctx.interactions.reach(it.kind) + slack, hit };
    }
    return null;
  }

  /** The issue whose note on the issues board an aim lands on, or null (bare cork, the frame, anything else). */
  function noteUnder(aim: { it: Interactable; hit: THREE.Intersection } | null): GhIssue | null {
    if (aim?.it.kind !== 'issues' || aim.hit.object !== ctx.world().boardMeshes.issues || !aim.hit.uv) return null;
    const n = parts.boards.issuesTex.noteAt(aim.hit.uv);
    return n === undefined ? null : (store.issues.items.find((i) => i.number === n) ?? null);
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    (pointer ??= new THREE.Vector2()).set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  });
  canvas.addEventListener('pointerleave', () => (pointer = null));
  // What you're pointing at (first person) or standing at (third), and what the hint bar says about it.
  ctx.ticks.add('aim', () => {
    frameNo++;
    buildTrees();
    const { seating, hoops } = parts;
    const firstPerson = player.view === 'first';
    aimedNote = null;
    if (modalOpen() || parts.telescope.active || ctx.activities.busy()) target = null;
    else if (firstPerson) {
      const aim = aimedAt(CROSSHAIR, 0, true);
      target = aim?.near ? aim.it : (seating.mySeat() ?? hoops.ballAtFeet());
      if (aim?.near) aimedNote = noteUnder(aim);
    } else {
      target = seating.mySeat() ?? pickTarget();
      // By the issues board, the mouse points at the note you'd take.
      if (target?.kind === 'issues' && pointer) {
        const aim = aimedAt(pointer, 2.5, true);
        if (aim?.near) aimedNote = noteUnder(aim);
      }
    }
    parts.boards.issuesTex.lift(aimedNote?.number ?? null);
    parts.hintbar.renderHint();
    parts.hintbar.renderCrosshair();
  });

  player.onClick = (ndc) => {
    const { emotes, hoops } = parts;
    // At the tee, a click is you steadying the mouse to aim: nothing else is in reach.
    // At the dart board or the axe lane, the button throws (see Thrower).
    if (modalOpen() || ctx.activities.any('takesCamera')) return;
    if (emotes.emoteWheel.isOpen) return emotes.emoteWheel.click();
    // The ball in your hands: press to wind up, let go (or click again, with no mouse captured) to shoot.
    if (hoops.holding()) {
      if (hoops.winding() && !player.locked) hoops.letFly();
      else hoops.windUp();
      return;
    }
    const { hanger } = parts.hanging;
    if (hanger.active) {
      reach();
      hanger.place(ndc);
      return;
    }
    if (player.view === 'first') {
      // Reach out even at nothing, like poking the air.
      reach();
      if (target) interact(target, 'E');
      return;
    }
    const aim = aimedAt(ndc, 2.5);
    if (!aim) return;
    if (!aim.near) {
      toast('Walk closer to that first');
      return;
    }
    use(aim.it, 'E', noteUnder(aim));
  };

  return {
    /** What you're pointing at (first person) or standing at (third), if anything. */
    target: () => target,
    /** Lets go of what you were pointing at (looking through the telescope, say). */
    clearTarget: () => void (target = null),
    aimedNote: () => aimedNote,
    usable,
    use,
    /** Aims with `a` instead of the crosshair (a VR controller), or with the crosshair again (null). */
    setAim: (a: Aim | null) => void (aim = a),
  };
}
