// Putt Street, the mini golf course on Main Street (shared/mainstreet.ts PUTT, the holes in
// shared/minigolf/). The office is the referee: groups of up to four take turns, the office rolls every
// putt with the shared physics and sends everyone the ball's path, timed on the office's clock, so
// every page shows the same roll in step with the windmill and nobody's score can be made up. The
// rounds and the records are the building's, the same on every floor (FloorView.putt).

/** Where a ball is: x and z in the street frame, y how high above the street its bottom is (the felt's height under it; its middle is BALL_R higher). */
export interface PuttBall {
  x: number;
  y: number;
  z: number;
}

/** Forming: people are joining, until it tees off. Playing: hole by hole. Over: the card's done (it goes soon after). */
export type PuttStage = 'forming' | 'playing' | 'over';

export interface PuttPlayer {
  /** Their PeerInfo id. */
  id: string;
  name: string;
  /** '#rrggbb': their ball's color too. */
  color: string;
  /** Strokes on each of the nine holes (penalties in), null until they've holed out or been picked up there. */
  strokes: (number | null)[];
  /** Where their ball lies on the hole being played; null before they've teed off there, and once it's down. */
  ball: PuttBall | null;
  /** Strokes taken on the hole being played so far, penalties in. */
  taken: number;
}

export interface PuttRound {
  id: string;
  stage: PuttStage;
  /** The hole being played, 0..8 (hole 1 is 0). */
  hole: number;
  /** Whose turn it is: an index into `players`. */
  turn: number;
  players: PuttPlayer[];
  /** Whoever started it: they can tee off before the others turn up (putt.start). */
  starter: string;
  /** When its stage, or the turn, began (ms since 1970, the office's clock). */
  since: number;
  /**
   * Forming: when it tees off by itself. Playing: when the turn is picked up, at PUTT_RULES.picked, if
   * nobody has putted by then (a warning comes PUTT_RULES.warn seconds before).
   */
  until: number;
  /** Its next hole still has an earlier group's balls on it: it waits, and the turn's clock doesn't run. */
  waiting?: boolean;
  /** A ball is rolling until then (office clock, ms): nobody putts before it stops. */
  rolling?: number;
}

/**
 * What a roll did along the way, for the sounds: off a wall or kerb (or the hill's grass); off a
 * bumper; off a windmill sail; into the loop; into a tunnel (a hill's, or through the windmill's
 * house); into the water; into the cup; lipped out of the cup (it was going too fast to drop); off the felt.
 */
export type PuttEvent = 'wall' | 'bumper' | 'mill' | 'loop' | 'tunnel' | 'splash' | 'cup' | 'lip' | 'off';

/** A putt, as the office rolled it. */
export interface PuttRoll {
  round: string;
  /** Who putted. */
  id: string;
  hole: number;
  /**
   * The ball's path: x, y, z one after another, PUTT_RULES.samples a second from `startAt`, to the
   * millimetre, y being its bottom as in PuttBall (round the loop, up the inside of its track; through a
   * hill's tunnel, under the street, out of sight). The last point is where it stopped: in the cup (just
   * under the felt), in the water, where it went off the felt, or at rest (before any move to `rest`).
   */
  path: number[];
  /** [seconds after startAt, what happened]. */
  events: [number, PuttEvent][];
  /** When the ball was struck (ms since 1970, the office's clock): pages play the path from then, skipping ahead if it came late. */
  startAt: number;
  /** How hard (0..1), for the putter's sound. */
  power: number;
  /** Where it ended up, after any penalty or club-length move: where it's played from next. */
  rest: PuttBall;
  holed: boolean;
  /** It went in the water, or off the felt: a penalty stroke, and it's played again from where it was putted. */
  out: 'water' | 'off' | null;
  /** It stopped where nobody can stand to putt it (in a tunnel, under the arch, on a slope): moved a club length to `rest`. */
  moved?: boolean;
  /** Their strokes on this hole now, penalties in. */
  taken: number;
}

/** The best anyone has gone round in, or done a hole in: the earlier one wins a tie. */
export interface PuttRecord {
  total: number;
  name: string;
  at: number;
}
export interface PuttBest {
  strokes: number;
  name: string;
  at: number;
}
export interface PuttAce {
  name: string;
  /** 0..8. */
  hole: number;
  at: number;
}
/** A finished round, for the last few kept: who played, and what each went round in. */
export interface PuttCard {
  names: string[];
  totals: number[];
  at: number;
}

/** Putt Street's records, kept in the office's minigolf.json. */
export interface PuttBoard {
  record: PuttRecord | null;
  /** The best on each hole, 0..8. */
  best: (PuttBest | null)[];
  /** The holes in one, newest first (the last 50: ACES_KEPT in server/minigolf/records.ts). */
  aces: PuttAce[];
  /** The last PUTT_RULES.kept rounds, newest first. */
  rounds: PuttCard[];
}

/** Putt Street for whoever arrives on a floor. */
export interface PuttView {
  rounds: PuttRound[];
  board: PuttBoard;
}

/**
 * The rules: at most `players` a group; it forms for `formS` seconds (or until its starter tees off);
 * `strokes` a hole and you're picked up, scoring `picked`; a turn left `idleS` seconds is picked up too,
 * with a warning `warnS` in; one putt each every `everyMs`; a putt is struck no later than `leadMs`
 * after the office hears it (and no sooner than `minLeadMs`); paths have `samples` points a second;
 * minigolf.json keeps the last `kept` rounds.
 */
export const PUTT_RULES = { players: 4, formS: 90, strokes: 6, picked: 7, idleS: 60, warnS: 45, everyMs: 600, leadMs: 150, minLeadMs: 20, samples: 30, kept: 20, holes: 9 } as const;

export const emptyPuttBoard = (): PuttBoard => ({ record: null, best: Array.from({ length: PUTT_RULES.holes }, () => null), aces: [], rounds: [] });

export type PuttClientMsg =
  /** At the putter rack: join a group that's still forming, or start one. */
  | { t: 'putt.play' }
  /** The starter tees off now, without waiting for anyone else. */
  | { t: 'putt.start'; round: string }
  /**
   * Putt your ball: `yaw` (radians, ±π, 0 down +z) and `power` (0..1), struck at `at` (the office's
   * clock as your page has it, a moment after you let go, for the putter's swing). Your turn only.
   */
  | { t: 'putt.stroke'; round: string; yaw: number; power: number; at: number }
  /** Leave the round (your card goes). */
  | { t: 'putt.quit'; round: string };

export type PuttServerMsg =
  /** The rounds changed (someone joined, putted, holed out, left): to everyone. */
  | { t: 'putt'; rounds: PuttRound[] }
  /** A putt, rolled: to everyone, ahead of the `putt` that follows it. */
  | ({ t: 'putt.rolled' } & PuttRoll)
  /** The records changed: to everyone. `latest` says what did it, for a toast and confetti. */
  | { t: 'putt.board'; board: PuttBoard; latest?: { name: string; what: 'record' | 'ace' | 'best'; hole?: number; total?: number } };
