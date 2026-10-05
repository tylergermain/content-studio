/**
 * Sitting down: on a chair, a stool, the couch. Sitting there already, E gets you up, or
 * does what the seat's for (the TV from the couch, the bar's menu, and at the boss's desk whatever
 * features/boss-desk says: the desk's menu from the boss's chair, the call from a guest's).
 */
import { seatPlace, type SeatDef, type SeatPlace } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import type { Interactable } from '../../world/types';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    seat: true;
  }
}

export interface SeatingDeps {
  /** The screens shared on this floor, by who's sharing them (see features/voice). */
  shares(): [string, MediaStream][];
  /** Watches what's on the TV full screen (see features/voice). */
  watchShare(): void;
  /**
   * A seat at the boss's desk (see features/boss-desk): what the hint says of it, and what E does once
   * you're sitting in it. Null for any other seat.
   */
  desk(seatId: string): { note: string; use?: { label: string; run(): void } } | null;
  /** The bar's menu (see features/bar). */
  showBar(): void;
  /** What you can use where you are, and what's in the way of looking at it (see usable in input/pointer.ts). */
  usable(): (readonly Interactable[])[];
}

export function installSeating(ctx: Ctx, deps: SeatingDeps) {
  /** The free place on a seat nearest you, or null when everyone else on your floor has taken them all. */
  function freePlace(seat: SeatDef): SeatPlace | null {
    const taken = new Set<string>();
    for (const p of store.peers.values()) if (p.seat && p.id !== store.you && store.onMyFloor(p)) taken.add(p.seat);
    let best: SeatPlace | null = null;
    let bestD = Infinity;
    const player = ctx.player;
    for (let i = 0; i < seat.places.length; i++) {
      const place = seatPlace(seat, i);
      const d = Math.hypot(place.x - player.pos.x, place.z - player.pos.z);
      if (!taken.has(place.key) && d < bestD) {
        best = place;
        bestD = d;
      }
    }
    return best;
  }

  /** Someone else's screen is up on the TV. */
  function tvShowing(): boolean {
    return deps.shares().some(([who]) => who !== 'You');
  }

  /** E at a seat: sit down on it. Sitting there already, get up, or on the couch facing the TV, watch it. */
  function useSeat(seatId: string) {
    const seat = ctx.plan().seatingById.get(seatId);
    if (!seat) return;
    const player = ctx.player;
    if (player.seat?.seatId === seatId) {
      const desk = deps.desk(seatId);
      if (seat.tv && tvShowing()) deps.watchShare();
      else if (desk?.use) desk.use.run();
      else if (seat.bar) deps.showBar();
      else standUp();
      return;
    }
    const place = freePlace(seat);
    if (!place) {
      toast(`No room on that ${seat.label.replace(/^\S+ /, '').toLowerCase()} right now`, 'warn');
      return;
    }
    player.sit(place);
    ctx.me.sit(place.hips);
    ctx.net.send({ t: 'sit', seat: place.key });
    // The couch in front of the TV is where you watch whoever's sharing.
    if (seat.tv && tvShowing()) deps.watchShare();
  }

  function standUp() {
    ctx.player.stand();
    gotUp();
  }
  ctx.messages.on('sit.refused', (msg) => {
    // Somebody on the floor got there first: back on your feet, next to them.
    if (ctx.player.seat?.key === msg.seat) {
      ctx.player.stand();
      // On your feet as far as everyone's concerned (the office still has you where you sat before).
      gotUp();
      toast(`${msg.by} got there first`, 'warn');
    }
  });

  /** On your feet again, by E or by walking off. */
  function gotUp() {
    ctx.me.sit(null);
    ctx.net.send({ t: 'sit' });
  }
  ctx.player.onStand = gotUp;

  /** What you're sitting on, so it's what E is about unless you're looking at something else. */
  function mySeat(): Interactable | null {
    const id = ctx.player.seat?.seatId;
    return (id && deps.usable()[0].find((it) => it.kind === 'seat' && it.seatId === id)) || null;
  }

  /**
   * The seat E is about when you face `it`. Sitting at the boss's desk and looking at another chair
   * there (the person across from you), it stays your own: E is the desk's, not a move to their chair.
   */
  function about(it: Interactable): string | undefined {
    const own = ctx.player.seat?.seatId;
    return own && it.seatId && own !== it.seatId && deps.desk(own) && deps.desk(it.seatId) ? own : it.seatId;
  }

  ctx.interactions.define('seat', {
    reach: 3,
    hint: (it) => {
      const seat = ctx.plan().seatingById.get(about(it) ?? '');
      if (!seat) return { k: '', parts: [] };
      const desk = deps.desk(seat.id);
      if (ctx.player.seat?.seatId === seat.id) {
        const use = seat.tv && tvShowing() ? 'Watch the TV' : (desk?.use?.label ?? (seat.bar ? 'Order a drink' : ''));
        return { k: `${seat.id}|sitting|${use}`, parts: [hintTitle(seat.label), aside('sitting'), ...(use ? [key('E', use), key('W A S D', 'Get up')] : [key('E', 'Get up')])] };
      }
      const full = !freePlace(seat);
      return { k: `${seat.id}|${full}|${desk?.note ?? ''}`, parts: [hintTitle(seat.label), desk ? aside(desk.note) : seat.share ? aside('🖥️ shares your screen') : '', full ? aside('no room') : key('E', 'Sit down')] };
    },
    use: onE((it) => {
      const seatId = about(it);
      if (seatId) useSeat(seatId);
    }),
  });

  return { freePlace, standUp, mySeat };
}
