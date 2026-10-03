/**
 * The scoreboard beside the hoop: the building's longest shots on its face (and all of them, with the
 * PIG winners, in its window), and games of PIG for two: asking someone at the court, the ring to
 * match from, the letters over the players' heads, and the board following the game.
 */
import * as THREE from 'three';
import { HOOP } from '../../../shared/hoop';
import { metres, rimDistance } from '../../../shared/longshots';
import { COURT_REACH, MATCH_R, scoreLine } from '../../../shared/pig';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { clip } from '../../ui/dom';
import type { Person } from '../../world/character';
import type { Interactable } from '../../world/types';
import { PigMarks } from './pig';
import { inviteToast, openBoardWindow, type Partner } from './ui';
import type { FaceView } from './paint';
import { BOARD } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    scoreboard: true;
  }
}

export interface ScoreboardDeps {
  /** Everyone else on your floor, as you see them, by peer id. */
  remotes: ReadonlyMap<string, { person: Person }>;
  /** The basketball: whether it's in your hands, and the hint while it is. */
  hoops: { holding(): boolean; addBallHint(fn: () => Hint | null): void };
  /** What you're facing (or standing at), if anything. */
  target(): Interactable | null;
}

/** How long the make that last got on the board is picked out on it (ms), and a new record flashes it. */
const NEWEST_FOR = 10_000;
const FLASH_FOR = 4000;

export function installScoreboard(ctx: Ctx, deps: ScoreboardDeps) {
  const { office } = ctx;
  const marks = new PigMarks();
  office.group.add(marks.group);

  /** Invites to play, by who asked: their name, and until when (performance.now()), with the toast to take down. */
  const invites = new Map<string, { name: string; until: number; done: () => void }>();

  // ---- Who's at the court -------------------------------------------------------------------------

  /** Whether something standing at (x, y, z) is at the court: on the floor (not upstairs), near the hoop. */
  const atCourt = (p: { x: number; y: number; z: number }) => Math.abs(p.y) < 1.5 && rimDistance(p) <= COURT_REACH;
  const youAtCourt = () => !office.hoop.away && !ctx.upTop() && atCourt(ctx.player.pos);

  /** The others at the court to play PIG with, nearest you first (someone who's asked you, first of all). */
  function partners(): Partner[] {
    if (!youAtCourt()) return [];
    const me = ctx.player.pos;
    const out: (Partner & { d: number })[] = [];
    for (const [id, p] of store.peers) {
      if (id === store.you || p.lite || p.floor !== store.floor || !atCourt(p)) continue;
      const asked = (invites.get(id)?.until ?? 0) > performance.now();
      out.push({ id, name: p.name, asked, d: asked ? -1 : Math.hypot(p.x - me.x, p.z - me.z) });
    }
    return out.sort((a, b) => a.d - b.d).map(({ d: _, ...p }) => p);
  }

  /** Whether you're in the game of PIG on the floor (and it's not over). */
  const playing = () => !!store.pig && store.pig.winner === null && store.pig.players.some((p) => p.id === store.you);
  /** The one P asks (or says yes to), and the hint's key for it; null when there's nobody, or a game is on. */
  function pigKey(): { partner: Partner; hint: Hint } | null {
    if (store.pig && store.pig.winner === null) return null;
    const partner = partners()[0];
    if (!partner) return null;
    const name = clip(partner.name, 14);
    return { partner, hint: { k: `pig|${partner.id}|${partner.asked}`, parts: [key('P', `Play PIG with ${name}`), partner.asked ? aside(`${name} asked you`) : ''] } };
  }

  function invite(id: string) {
    ctx.net.send({ t: 'pig.invite', to: id });
  }

  // ---- Keys and hints -------------------------------------------------------------------------------

  // P at the hoop (the ball in your hands, or facing the board) asks the nearest person at the court to
  // play, or says yes to whoever asked you.
  ctx.keys.add('activity', (e) => {
    if (e.code !== 'KeyP') return false;
    const there = deps.hoops.holding() || deps.target()?.kind === 'scoreboard' || deps.target()?.kind === 'ball';
    const asked = [...invites.values()].some((v) => v.until > performance.now());
    if (!(there || (asked && youAtCourt()))) return false;
    const k = pigKey();
    if (!k) return false;
    if (!e.repeat) invite(k.partner.id);
    e.preventDefault();
    return true;
  });

  // With the ball in your hands: asking someone to play, or how your game's going.
  deps.hoops.addBallHint(() => {
    const pig = store.pig;
    if (pig && playing()) {
      const mine = pig.players[pig.turn]?.id === store.you;
      if (!mine) return { k: 'pig|wait', parts: [aside('🐷 not your shot')] };
      if (!pig.spot || pig.turn === pig.leader) return { k: 'pig|lead', parts: [aside('🐷 your shot: from anywhere')] };
      const off = Math.hypot(ctx.player.pos.x - pig.spot.x, ctx.player.pos.z - pig.spot.z);
      return { k: `pig|match|${off <= MATCH_R}`, parts: [aside(off <= MATCH_R ? '🐷 in the ring: sink it!' : '🐷 match it from the ring')] };
    }
    return pigKey()?.hint ?? null;
  });

  ctx.interactions.define('scoreboard', {
    // It's read from across the court.
    reach: 9,
    hint: () => {
      const pig = store.pig;
      const best = store.hoopBoard.shots[0];
      const what = pig ? scoreLine(pig) : best ? `record ${metres(best.dist)}, ${clip(best.name, 14)}` : 'no makes yet';
      const k = pigKey();
      return { k: `${what}|${k?.hint.k ?? ''}`, parts: [hintTitle('🏀 Longest shots'), aside(what), key('E', 'See all'), ...(k ? k.hint.parts : [])] };
    },
    use: onE(() => openWindow()),
  });

  // ---- The window -----------------------------------------------------------------------------------

  let board: ReturnType<typeof openBoardWindow> | null = null;
  function openWindow() {
    board = openBoardWindow({ partners, invite, quit: () => ctx.net.send({ t: 'pig.quit' }) });
  }
  const refresh = () => {
    if (board?.open()) board.refresh();
    ctx.hint.invalidate();
  };
  store.on('hoopBoard', refresh);
  store.on('pig', refresh);

  // ---- Invites, and the game starting and ending ----------------------------------------------------

  ctx.messages.on('pig.invited', (m) => {
    invites.get(m.from)?.done();
    const ms = Math.max(5000, Math.min(30_000, m.until - Date.now()));
    const done = inviteToast(m.name, ms, (yes) => ctx.net.send({ t: 'pig.answer', from: m.from, yes }));
    invites.set(m.from, { name: m.name, until: performance.now() + ms, done });
    refresh();
  });
  let wasOn = false;
  store.on('pig', () => {
    const pig = store.pig;
    // A game of yours started: the invites are done with.
    if (playing()) for (const [id, v] of invites) {
      v.done();
      invites.delete(id);
    }
    const on = !!pig && pig.winner === null;
    // Over, with a winner: confetti over the hoop.
    if (wasOn && pig && pig.winner !== null && pig.end === 'pig') ctx.confetti.burst(HOOP.rim.x + 0.3, HOOP.rim.y, HOOP.rim.z, 160, 0.8);
    wasOn = on;
  });
  ctx.messages.on('hoop.board', (m) => {
    // A new record: confetti off the board.
    if (m.latest?.first && !office.hoop.away) ctx.confetti.burst(HOOP.face + 0.6, BOARD.y + 0.4, BOARD.z, 140, 0.6);
  });

  // ---- Every frame: the board's face, the ring and the letters --------------------------------------

  /** Where `id` stands, or null when you can't see them there (you, in first person). */
  function feetOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const who = id === store.you ? (ctx.player.view === 'first' ? null : ctx.me) : (deps.remotes.get(id)?.person ?? null);
    return who ? out.copy(who.root.position) : null;
  }
  let painted = 0;
  ctx.ticks.add('world', ({ t, now }) => {
    const away = office.hoop.away || ctx.upTop();
    marks.group.visible = !away;
    marks.update(away ? null : store.pig, t, feetOf);
    if (away || now - painted < 100) return;
    painted = now;
    office.scoreboard.show(face(now));
  });

  /** What the board's face shows now. */
  function face(now: number): FaceView {
    const pig = store.pig;
    if (pig) return { page: 'pig', pig, blink: Math.floor(now / 500) % 2 === 0 };
    const l = store.hoopLatest;
    const fresh = !!l && now - l.at < NEWEST_FOR;
    const flash = fresh && l!.first && now - l!.at < FLASH_FOR;
    return { page: 'shots', shots: store.hoopBoard.shots, latest: fresh ? { name: l!.name, rank: l!.rank } : null, flash, blink: fresh ? Math.floor(now / 350) % 2 === 0 : false };
  }

  return { openWindow, partners };
}
