import type { RoomOptions } from '../../../shared/floorplan';
import { LOFT } from '../../../shared/layout';
import { hasBoss } from '../../../shared/mezzanine';

// The boss's desk, up in the loft: the boss's chair on one side, two guest chairs across it, and a
// monitor facing each side. This is the part with no 3D and no page in it: where the desk stands, who
// counts as sitting at it, and the rules for what its monitors show (tests/boss-desk.test.ts).

/** Where the desk stands, the middle of its top's footprint on the loft's floor (as world/office/boss-office.ts builds it). */
export const BOSS_DESK = { x: (LOFT.minX + LOFT.maxX) / 2 + 0.5, y: LOFT.y, z: (LOFT.minZ + LOFT.maxZ) / 2 - 0.3 } as const;

/** The boss's chair (see SEATING), and what a peer's `seat` says while someone's in it. */
export const BOSS_SEAT = 'boss-chair';
export const BOSS_PLACE = 'boss-chair:0';
/** The chairs across the desk, west one first. Each has the one place. */
export const GUEST_SEATS = ['boss-guest-1', 'boss-guest-2'] as const;

/** Which side of the desk you're on. */
export type DeskRole = 'boss' | 'guest';
/** What a share the desk started is of: the boss's real screen, or the game on their monitor. */
export type ShareKind = 'screen' | 'game';

/**
 * Whether a floor with this room has the boss's desk at all. It goes with the boss's office: the corner
 * loft's, which a room that doesn't say has, and one that's all one level, has the big mezzanine or
 * keeps its loft empty hasn't. Everything that shows or runs the desk asks here, not the room itself.
 */
export function hasBossDesk(room: RoomOptions): boolean {
  return hasBoss(room);
}

/** The side of the desk the seat called `seatId` is on, or null for any other seat. */
export function deskSeat(seatId: string | undefined): DeskRole | null {
  if (seatId === BOSS_SEAT) return 'boss';
  return (GUEST_SEATS as readonly string[]).includes(seatId ?? '') ? 'guest' : null;
}

/** The side of the desk a peer's `seat` (like "boss-guest-1:0") puts them on, or null if it's no place at the desk. */
export function deskRole(seatKey: string | undefined): DeskRole | null {
  const m = /^([\w-]+):0$/.exec(seatKey ?? '');
  return m ? deskSeat(m[1]) : null;
}

/** As much of someone as the desk goes by: you, or a peer on your floor. */
export interface DeskPerson {
  id: string;
  name: string;
  /** Where they're sitting (see SeatPlace.key). */
  seat?: string;
  /** They've a screen share up. */
  sharing?: boolean;
  /** What the window they have open says they're doing ("playing Snake"). */
  doing?: string;
}

/** Who's at the desk, of the people on one floor (the caller hands in only those, itself included): the guests by chair, west first. */
export function deskPeople<P extends DeskPerson>(people: Iterable<P>): { boss: P | null; guests: P[] } {
  let boss: P | null = null;
  const guests: P[] = [];
  for (const p of people) {
    const role = deskRole(p.seat);
    if (role === 'boss') boss ??= p;
    else if (role === 'guest') guests.push(p);
  }
  guests.sort((a, b) => (a.seat! < b.seat! ? -1 : a.seat! > b.seat! ? 1 : 0));
  return { boss, guests };
}

/** Who's on the other side of the desk from someone sitting as `role`: never `you`. */
export function across<P extends DeskPerson>(role: DeskRole, at: { boss: P | null; guests: P[] }, you: string): P[] {
  const others = role === 'boss' ? at.guests : at.boss ? [at.boss] : [];
  return others.filter((p) => p.id !== you);
}

/**
 * Whether the game on the boss's monitor should be going out to the guests as a share: you're the boss,
 * a game's open, and someone's sitting across. A screen you chose to share is never taken down for it:
 * the game only goes out when nothing of yours is up, or what's up is the game already.
 */
export function mirrorWanted(s: { role: DeskRole | null; playing: boolean; guests: number; sharing: boolean; kind: ShareKind | null }): boolean {
  return s.role === 'boss' && s.playing && s.guests > 0 && (s.kind === 'game' || !s.sharing);
}

/** What the desk's monitors say when there's no picture to show: who's at the desk and what they're up to. */
export function deskCard(boss: DeskPerson | null, connecting = false): { icon: string; title: string; line: string } {
  if (!boss) return { icon: '👑', title: "Boss's desk", line: 'Nobody at the desk' };
  if (connecting) return { icon: '🖥️', title: boss.name, line: `Connecting to ${boss.name}'s screen…` };
  return { icon: '👑', title: boss.name, line: boss.doing || 'At the desk' };
}

/** What the boss did at the desk last time, kept in this browser: 'share', or a game's id. */
const KEY = 'agent-office.bossdesk';

export function recall(storage?: Pick<Storage, 'getItem'>): string | null {
  try {
    return (storage ?? localStorage).getItem(KEY);
  } catch {
    return null;
  }
}

export function remember(what: string, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(KEY, what);
  } catch {
    // private window: it's only for this visit then
  }
}
