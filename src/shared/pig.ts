// A game of PIG at the hoop, for two: the rules, as the office plays them (see server/pig.ts) and the
// pages show them. The leader shoots from anywhere they like; if it goes in, the other has to sink the
// same shot from the same spot, and a miss there is a letter (P, then I, then G). A leader who misses
// hands the lead over. The first to spell PIG loses.

import { shotDistance } from './longshots.js';

export const PIG_WORD = 'PIG';
/** How near the leader's spot (m, along the floor) the follower has to shoot from: the ring on the floor. */
export const MATCH_R = 0.5;
/** A little more than the ring, as the office checks it: where someone stood is worked out from their throw. */
const MATCH_SLACK = 0.1;
/** How near the hoop (m, along the floor) someone has to be to ask, or be asked, to play: at the court. */
export const COURT_REACH = 10;
/** How far in front of someone's feet a shot leaves their hands, along its way (see shotAim in features/basketball). */
export const HANDS_OUT = 0.3;

export interface PigPlayer {
  /** Their connection (a PeerInfo id) now. */
  id: string;
  name: string;
  color: string;
  /** Letters of PIG they have: 0 to 3. */
  letters: number;
}

/** Where the leader made it from: the follower matches from here. */
export interface PigSpot {
  x: number;
  z: number;
  /** From the hoop (m, to a tenth). */
  dist: number;
}

export interface PigState {
  /** Two: whoever asked first, then whoever said yes. */
  players: PigPlayer[];
  /** Who sets the shot to match (an index of players). */
  leader: number;
  /** Whose shot it is now. */
  turn: number;
  /** Where the follower has to match from; none while the leader is up, who shoots from anywhere. */
  spot: PigSpot | null;
  /** A shot of theirs is on its way: the office says how it went once it lands. */
  inAir: boolean;
  /** Who won, once it's over. */
  winner: number | null;
  /** How it ended: someone spelled PIG, or walked off (or gave up, or dropped out). */
  end: 'pig' | 'forfeit' | null;
  /** What just happened, in a few words: for the board, and the players' toasts. */
  news: string;
  /** Goes up with every change, so a page can tell new news from old. */
  seq: number;
}

/** A game between `a` (who asked, and shoots first) and `b`. */
export function newGame(a: Omit<PigPlayer, 'letters'>, b: Omit<PigPlayer, 'letters'>): PigState {
  return {
    players: [
      { ...a, letters: 0 },
      { ...b, letters: 0 },
    ],
    leader: 0,
    turn: 0,
    spot: null,
    inAir: false,
    winner: null,
    end: null,
    news: `${a.name} shoots first: anywhere you like`,
    seq: 1,
  };
}

/** The letters of PIG someone has: '', 'P', 'PI' or 'PIG'. */
export function letters(n: number): string {
  return PIG_WORD.slice(0, Math.max(0, Math.min(PIG_WORD.length, n)));
}

/** Where someone stood for a throw: back from where it left their hands, the way it went. */
export function feetOf(s: { x: number; z: number; vx: number; vz: number }): { x: number; z: number } {
  const v = Math.hypot(s.vx, s.vz);
  if (v < 1e-6) return { x: s.x, z: s.z };
  return { x: s.x - (s.vx / v) * HANDS_OUT, z: s.z - (s.vz / v) * HANDS_OUT };
}

/** A shot of whoever's turn it is is on its way. */
export function shotTaken(g: PigState): PigState {
  return { ...g, inAir: true, seq: g.seq + 1 };
}

/**
 * How the shot of whoever's turn it was went: `made` or not, from `feet` (where they stood). Returns
 * the game after it; the same game if it's already over.
 */
export function shotResult(g: PigState, made: boolean, feet: { x: number; z: number }): PigState {
  if (g.winner !== null) return g;
  const players = g.players.map((p) => ({ ...p }));
  const shooter = players[g.turn];
  const other = (g.turn + 1) % players.length;
  const next: PigState = { ...g, players, inAir: false, seq: g.seq + 1 };
  if (g.turn === g.leader) {
    if (made) {
      const spot = { x: feet.x, z: feet.z, dist: shotDistance(feet) };
      return { ...next, spot, turn: other, news: `${shooter.name} sank one from ${spot.dist.toFixed(1)} m: ${players[other].name} to match it` };
    }
    // The lead goes over.
    return { ...next, spot: null, leader: other, turn: other, news: `${shooter.name} missed: ${players[other].name}'s shot, from anywhere` };
  }
  const leader = players[g.leader];
  if (made) return { ...next, spot: null, turn: g.leader, news: `${shooter.name} matched it: ${leader.name} shoots again` };
  shooter.letters++;
  if (shooter.letters >= PIG_WORD.length) return { ...next, spot: null, winner: g.leader, end: 'pig', news: `${shooter.name} spelled PIG — ${leader.name} wins` };
  return { ...next, spot: null, turn: g.leader, news: `${shooter.name} missed: that's ${letters(shooter.letters)}. ${leader.name} shoots again` };
}

/** `loser` (an index) is out of it: walked off, left, or gave up. The other wins. */
export function forfeit(g: PigState, loser: number, why: string): PigState {
  if (g.winner !== null) return g;
  const winner = (loser + 1) % g.players.length;
  return { ...g, inAir: false, spot: null, winner, end: 'forfeit', news: `${g.players[loser].name} ${why} — ${g.players[winner].name} wins`, seq: g.seq + 1 };
}

/** Why `id` may not throw the ball now (a shot of theirs, not a drop), or null if they may. `feet` is where they stand. */
export function shotRefused(g: PigState, id: string, feet: { x: number; z: number }): string | null {
  if (g.winner !== null) return null;
  const at = g.players.findIndex((p) => p.id === id);
  if (at < 0) return null;
  if (g.turn !== at) return `🐷 It's ${g.players[g.turn].name}'s shot`;
  if (g.inAir) return '🐷 Your last shot is still in the air';
  if (!g.spot) return null;
  const off = Math.hypot(feet.x - g.spot.x, feet.z - g.spot.z);
  if (off <= MATCH_R + MATCH_SLACK) return null;
  return `🐷 Match ${g.players[g.leader].name}'s shot from the ring on the floor (you're ${off.toFixed(1)} m off)`;
}

/** The game in a line, as the board says it: "TYLER P · GAVIN PI". */
export function scoreLine(g: PigState): string {
  return g.players.map((p) => `${p.name.toUpperCase()}${p.letters ? ` ${letters(p.letters)}` : ''}`).join(' · ');
}
