/**
 * A card off the builder's catalog: click it and the piece lands in the middle of the view; drag it
 * out over the floor and it goes where you let go (back onto a panel, or somewhere it can't stand, and
 * it's gone). It lands on the level being worked on, and a painting rides the nearest wall all the way.
 */
import { SNAP } from '../../../shared/office-builder';
import { kindDef, type FurnitureKind } from '../../../shared/furniture';
import { snap, type DraftLayout } from './draft';
import type { BuilderCamera } from './view';

export interface PlacingDeps {
  draft: DraftLayout;
  cam: BuilderCamera;
  /** The room, between the panels: where a point on the screen is on the floor. */
  view: HTMLElement;
  /** A save's on its way: nothing's added meanwhile. */
  busy(): boolean;
  /** The level being worked on: 1 is upstairs. */
  level(): number;
  /** A click on the card: the piece is added in the middle of the view. */
  add(kind: FurnitureKind): void;
  /** The piece just made is what's picked. */
  made(id: string): void;
  /** Drags the piece to under the mouse (see dragTo in mode.ts): a painting onto a wall no further than `within`. */
  dragTo(id: string, e: PointerEvent, dx: number, dz: number, within?: number): void;
  /** Lets go of it: where it can't stand, the draft's back as it was `before`. */
  drop(id: string, before: string): void;
  /** Nothing came of it: the draft's back as it was `before`. */
  cancel(before: string): void;
}

/** What a press on a catalog card does (see BuilderActions.place). */
export function createPlacing(deps: PlacingDeps) {
  const { draft, cam } = deps;
  return function place(kind: FurnitureKind, e: PointerEvent) {
    if (deps.busy() || e.button !== 0) return;
    e.preventDefault();
    // What the office has one of isn't dragged out of the catalog: a click puts it back, or finds it.
    const single = !!kindDef(kind).fixed;
    const before = draft.key();
    let made: string | null = null;
    const onMove = (ev: PointerEvent) => {
      if (!made) {
        if (single || Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        const at = cam.floorAt(ev, deps.view) ?? { x: cam.x, z: cam.z };
        made = draft.spawn(kind, snap(at.x, SNAP), snap(at.z, SNAP), deps.level());
        deps.made(made);
      }
      // A new painting's never in mid-air: it's on the nearest wall, however far that is.
      if (made) deps.dragTo(made, ev, 0, 0, Infinity);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!made) return deps.add(kind);
      if (ev.type === 'pointercancel' || document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ob-panel')) return deps.cancel(before);
      deps.drop(made, before);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
}
