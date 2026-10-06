/**
 * The builder's two levels: the office floor, and upstairs on a floor whose room has a deck to furnish
 * (the big mezzanine, or the corner loft once the boss's office is out of it: see shared/mezzanine.ts).
 * You work on one at a time: the camera, the grid and what the mouse picks up are that level's, and a
 * new piece lands on it. It also moves a piece between the two, and stands the starter rooms.
 */
import { DECK_Y, deckOf } from '../../../shared/mezzanine';
import type { DraftLayout } from './draft';
import type { BuilderCamera, BuilderGizmo } from './view';

export type Level = 0 | 1;

export interface LevelsDeps {
  draft: DraftLayout;
  cam: BuilderCamera;
  gizmo: BuilderGizmo;
  /** What's picked, if anything is, and picking something else (or nothing). */
  picked(): string | null;
  select(id: string | null): void;
  /** A save's on its way: nothing changes meanwhile. */
  busy(): boolean;
  say(text: string | undefined, tone?: 'info' | 'warn'): void;
  /** The draft changed: the room shows it. */
  show(): void;
}

/** What the panels show of the floor's upstairs, as the draft has it. */
export interface Upstairs {
  /** There's a deck to furnish. */
  there: boolean;
  /** It's the big mezzanine, which the starter rooms are for. */
  big: boolean;
  /** How many pieces are up there. */
  pieces: number;
}

export function createLevels(deps: LevelsDeps) {
  const { draft, cam, gizmo } = deps;
  let level: Level = 0;
  /** Where there is to furnish upstairs, in the room as the draft has it. */
  const floor = () => deckOf(draft.now.room)?.floor;

  /** The camera and the grid, on the level being worked on. */
  function look() {
    const y = level ? DECK_Y : 0;
    cam.setLevel(y);
    gizmo.setLevel(y, level ? floor() : undefined);
  }

  function go(to: Level) {
    const area = floor();
    if (to === level || (to && !area)) return;
    level = to;
    if (area && to) {
      // Over the deck, near enough to see what's on it: the middle of the loft, or the stretch of the mezzanine you were over.
      const wide = area.maxX - area.minX;
      const edge = Math.min(wide / 2, 8);
      cam.x = Math.max(area.minX + edge, Math.min(area.maxX - edge, cam.x));
      cam.z = (area.minZ + area.maxZ) / 2;
      cam.dist = Math.min(cam.dist, Math.max(18, wide * 1.1));
    }
    look();
    cam.place();
    const id = deps.picked();
    if (id && draft.levelOf(id) !== level) deps.select(null);
    deps.say(to ? 'Upstairs: what you add lands up here.' : '');
    deps.show();
  }

  return {
    get now(): Level {
      return level;
    },
    /** After any change to the draft: back down on the office floor when the deck's gone, and the grid over the deck as it is now. */
    follow() {
      if (level && !floor()) level = 0;
      look();
    },
    state: {
      level: (): Level => level,
      upstairs: (): Upstairs => ({ there: !!floor(), big: deckOf(draft.now.room)?.kind === 'big', pieces: draft.upstairs }),
    },
    act: {
      level: go,
      /** The picked piece goes to the other level, and you with it. */
      relevel() {
        const id = deps.picked();
        if (!id || deps.busy()) return;
        const why = draft.relevel(id);
        if (!why) level = draft.levelOf(id);
        look();
        deps.say(why ?? (level ? 'It’s upstairs now. Drag it where you want it.' : 'It’s down on the office floor now.'), why ? 'warn' : 'info');
        deps.show();
      },
      /** Four rooms to start the big mezzanine with. */
      starter() {
        if (deps.busy()) return;
        const why = draft.starter();
        deps.say(why ?? 'Four rooms to start from. Pick a doorway to name its room, and move or remove any of it.', why ? 'warn' : 'info');
        deps.show();
      },
      /** The Software Factory's rooms and tables in place of the floor's furniture (Undo brings it back). */
      factory() {
        if (deps.busy()) return;
        const why = draft.factory();
        deps.say(why ?? 'Seven rooms off one hallway, each round a conference table. Save it, then set each room up for a repository from \u2630 \u203a Rooms.', why ? 'warn' : 'info');
        deps.show();
      },
      /** Everything upstairs, gone (Undo brings it back). */
      clearUp() {
        if (deps.busy()) return;
        const had = draft.upstairs;
        draft.clearUp();
        deps.select(null);
        deps.say(had ? `Cleared ${had} ${had === 1 ? 'piece' : 'pieces'} from upstairs. Undo brings them back.` : '');
        deps.show();
      },
    },
  };
}
