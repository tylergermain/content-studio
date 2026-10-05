import { WING } from '../../shared/layout';

// Managing the building is the admins' job: adding a project as a floor, taking one off, renaming or
// moving it, and building the back office out. Everyone else rides the elevator and reads the sign on
// the wall. What each of them is told is here, with no DOM and no store in it, so a test can read it.

/** What the elevator's panel says around its floors. */
export interface ElevatorWords {
  title: string;
  /** Under the heading, on the first-run panel only. */
  intro: string | null;
  /** Along the bottom. */
  footer: string;
}

/**
 * The elevator's words for whoever has it open. `setup` is the first-run panel (you're in the lobby,
 * on no floor yet), and `floors` how many the building has.
 */
export function elevatorWords(o: { admin: boolean; setup: boolean; floors: number }): ElevatorWords {
  if (!o.setup) return { title: '🛗 Elevator', intro: null, footer: 'Pick a floor · Esc to stay here' };
  const intro = o.floors
    ? `Every project is a floor of this building. Pick a floor to ride to${o.admin ? ', or add another project' : ''}.`
    : o.admin
      ? "Every project is a floor of this building, and it doesn't have any yet. Pick one of your repositories: the office clones it and it becomes the first floor."
      : "Every project is a floor of this building, and it doesn't have any yet. An admin has to add the first floor: ask one, and it shows up here as soon as it's there.";
  return { title: '🏢 Welcome to Agent Office', intro, footer: 'Your office, one floor per project · Esc to look around first' };
}

/** The hint at the "Room to grow" sign in the back office. */
export interface ExpandSign {
  /** Changes whenever the hint needs redrawing. */
  k: string;
  title: string;
  aside: string;
  /** What E does there; null for anyone but an admin, who only reads the sign. */
  action: string | null;
}

/** What the sign says with the back office built out `level` rows, to an admin and to everyone else. */
export function expandSign(level: number, admin: boolean): ExpandSign {
  const full = level >= WING.rows;
  const title = full ? '🏢 Back office' : level ? '🚧 Room to grow' : '🚧 Room to grow through the wall';
  const built = full ? 'built all the way out' : level ? `${level} of ${WING.rows} rows built` : 'the office can get bigger here';
  if (!admin) return { k: `member|${level}`, title, aside: full ? built : `${built} · an admin builds it out`, action: null };
  return { k: full ? 'full' : String(level), title, aside: built, action: full ? 'Wall a row up' : level ? 'Another row: 2 more desks' : 'Knock through: 2 more desks' };
}

/** What anyone but an admin is told at the sign (the office says the same, if asked anyway). */
export const ADMINS_BUILD = 'Only admins can build the back office out or wall it up';
