// The building: its floors, going between them, and what each floor holds.

import type { CabinetView } from '../cabinet.js';
import type { Decoration } from '../decor.js';
import type { DogState } from '../dog.js';
import type { Piece } from '../furniture.js';
import type { DeskLayout } from '../office-builder.js';
import type { FloorPlan, RoomOptions } from '../floorplan.js';
import type { GoatState } from './goat.js';
import type { HeliState } from './heli.js';
import type { PuttView } from './minigolf.js';
import type { StreetView } from './street.js';
import type { CarState } from '../garage.js';
import type { BallState } from '../hoop.js';
import type { HoopView } from './hoop.js';
import type { JukeboxState } from '../jukebox.js';
import type { StudioState, TickerState } from '../studio.js';
import type { WatchState } from './watch.js';
import type { WhiteboardView } from '../whiteboard.js';
import type { AgentProvider } from './agents.js';
import type { GhIssue, GhPull, GhState } from './github.js';
import type { MeetingState } from './meetings.js';
import type { PeerInfo } from './presence.js';
import type { QueueState } from './queue.js';
import type { ServicesState } from './settings.js';
import type { WorkerInfo } from './workers.js';

export interface ProjectInfo {
  name: string;
  dir: string;
  branch?: string;
  remote?: string;
  agentCmd: string;
  defaultProvider: AgentProvider;
  agentProviders: AgentProvider[];
}

/**
 * One floor of the building: a project in its own checkout, with its own desks, workers, boards
 * and queue. You go between them in the elevator.
 */
export interface FloorInfo {
  id: string;
  /** The repository's name, or the folder's when it isn't on GitHub. */
  name: string;
  /** owner/name on GitHub. */
  repo?: string;
  /** Its checkout on the office's machine. */
  dir: string;
  /** The branch that checkout is on ('HEAD' when detached); none when it isn't a git checkout. */
  branch?: string;
  /** Which of FLOOR_PALETTES it's painted in. */
  palette: number;
  /** Which of FLOOR_PALETTES the office builder painted it over its own (FloorPlan.look): its color on the building's outside too. */
  look?: number;
  /** Being cloned: on the elevator panel, but nobody can go there yet. */
  cloning?: boolean;
  /** How the clone is getting on, once git says. */
  clone?: CloneProgress;
  /** The project the office was started in (`agent-office <dir>`): the office keeps its own data in its checkout. */
  local?: boolean;
  addedBy: string;
  addedAt: number;
  /**
   * For the elevator panel: who's there and what they're up to. `workers` counts the ones hired onto
   * desks, bean bags and the meeting room's table, not the board agents at their kiosks.
   */
  workers: number;
  busy: number;
  /** Workers waiting on someone: a question, a permission, or a finished turn nobody looked at. */
  waiting: number;
  people: number;
  /** How many rows its back office is built out (see WING), for the building's outside. */
  wing: number;
}

/** How far a new floor's clone has got, from git's progress. */
export interface CloneProgress {
  /** What it's doing, in words: "Downloading", "Checking out files"… */
  step: string;
  /** How far through that step, 0–100, when git says. */
  percent?: number;
  /** How much has come down and how fast, like "231.4 MiB · 1.5 MiB/s". */
  detail?: string;
}

/** Where the elevator's "add a project" clones to: <dir>/<owner>/<repo> on the office's machine. */
export interface ProjectsDirState {
  /** For showing people: under the home folder it's ~/…. */
  dir: string;
  /** Set from ⚙️ Settings or --projects, rather than the office's default. */
  custom: boolean;
  by?: string;
  at?: number;
}

/** A repository the office's `gh` login can clone, for the elevator's "add a project". */
export interface RepoChoice {
  /** owner/name */
  name: string;
  description?: string;
  private: boolean;
  /** ISO time of the last push. */
  pushedAt?: string;
}

/** Everything that belongs to the floor you're on: sent when you walk in, and when you change floors. */

export interface FloorView {
  /** The floor you're on; null while the building has none. */
  floor: string | null;
  project: ProjectInfo | null;
  workers: WorkerInfo[];
  issues: GhState<GhIssue>;
  pulls: GhState<GhPull>;
  queue: QueueState;
  /** Pictures on this floor's walls. */
  decor: Decoration[];
  /** The signs over this floor's desks, how far its back office is built out, and how it's arranged. */
  plan: FloorPlan;
  services: ServicesState;
  /** The floor's dog; null in a building with no floors yet. */
  dog: DogState | null;
  /** Marc, the building's goat, while he's on this floor; null on every other. */
  goat: GoatState | null;
  /** What the lounge jukebox is playing. */
  jukebox: JukeboxState;
  /** Who's at the arcade cabinet, what's on its screen, and the building's high scores. */
  cabinet: CabinetView;
  /** What's drawn on this floor's whiteboard, and who's drawing. */
  whiteboard: WhiteboardView;
  /** The meeting room: who's meeting about what, and the meetings before. */
  meeting: MeetingState;
  /** The basketball by the hoop: who has it, or how it was last thrown. */
  ball: BallState;
  /** The scoreboard beside the hoop: the building's longest shots and PIG winners, and this floor's game of PIG. */
  hoop: HoopView;
  /** The cars in the garage (see CARS in shared/garage.ts): where each one is, and who's in it. */
  cars: CarState[];
  /** What this floor's wall boards and kiosks are for, when it has made them its own, and what's posted on the boards. */
  studio: StudioState;
  /** The prices on this floor's ticker (none, when it has no ticker). */
  ticker: TickerState;
  /** The newest videos from the YouTube channels this floor watches (none, when it watches none). */
  watch: WatchState;
  /** Who on this floor has a dram from a whisky cabinet in their hand, by peer id (see shared/whisky.ts). */
  whisky: string[];
  /** Main Street's businesses: who has claimed which plot (see shared/mainstreet.ts). The building's, the same on every floor. */
  street: StreetView;
  /** Putt Street, the mini golf course on Main Street: the rounds being played and its records. The building's, the same on every floor. */
  putt: PuttView;
  /** Friday One, the helicopter: where it is and who's aboard. The building's, the same on every floor. */
  heli: HeliState;
}

export type FloorClientMsg =
  /**
   * Go to another floor; the server answers with `floor.enter`. By elevator you arrive in the car;
   * `at` is where you arrive instead: the same spot on the other floor (switching floors from the
   * floor list), or the ladder or fire pole you came by.
   */
  | { t: 'floor.go'; floor: string; at?: { x: number; y: number; z: number; rotY: number } }
  /** The repositories that could become a floor (admins only); answered with `floor.repos`. */
  | { t: 'floor.repos'; refresh?: boolean }
  /** Clone a repository and make it a new floor (admins only); answered with `floor.added` once it's there. */
  | { t: 'floor.add'; repo: string }
  /**
   * Make a folder on the office's machine a floor (admins only): no repository, nothing to do with
   * GitHub. The folder's made if it isn't there. Answered with `floor.added` (its `repo` is the folder).
   */
  | { t: 'floor.folder'; dir: string; name?: string }
  /** Rename a floor, or move it to storey `to` (0 is the bottom one): admins only. */
  | { t: 'floor.edit'; floor: string; name?: string; to?: number }
  /** Stop a floor's clone before it's there (admins only); the one who added it hears `floor.added` with why. */
  | { t: 'floor.cancel'; floor: string }
  /** Take a floor off the building (admins only). Its checkout stays on disk; everyone on it rides to another floor. */
  | { t: 'floor.remove'; floor: string }
  /** Where new floors are cloned from now on (admins only); '' goes back to the default. */
  | { t: 'floor.projectsDir'; dir: string };

export type PlanClientMsg =
  /** Hang a sign over a desk on your floor (a SIGN_COLORS color), or take it down with no text. */
  | { t: 'desk.label'; deskId: string; text: string; color?: string }
  /** Knock the back office out another row, with two more desks; or wall its last row back up (admins only). */
  | { t: 'floor.expand' }
  | { t: 'floor.shrink' }
  /**
   * Save the floor as the office builder arranged it (admins only): where its desks stand, its
   * furniture, its paint (`look`, one of FLOOR_PALETTES; none is the floor's own) and its room's own
   * fittings (`room`, see RoomOptions). `revision` is
   * the layout it was arranged from (FloorPlan.layoutRevision): a newer one saved meanwhile refuses it.
   */
  | { t: 'floor.layout'; desks: DeskLayout; furniture: Piece[]; look?: number; room?: RoomOptions; revision: number };

export type FloorServerMsg =
  /** You arrived on another floor: everything on it, replacing the last one's, and where everyone is now. */
  | ({ t: 'floor.enter'; peers: PeerInfo[] } & FloorView)
  | { t: 'floors'; floors: FloorInfo[] }
  /** Sent to whoever asked. */
  | { t: 'floor.repos'; repos: RepoChoice[]; error?: string }
  /** Sent to whoever asked for the floor, once it's cloned (or couldn't be). */
  | { t: 'floor.added'; repo: string; floor?: string; error?: string }
  /** The projects folder moved (see floor.projectsDir). */
  | { t: 'projectsDir'; state: ProjectsDirState }
  /** Your floor's signs changed, its back office was built out or walled up, or the office builder rearranged it. */
  | { t: 'plan'; plan: FloorPlan };
