import type { Me } from './protocol.js';

// Which floors someone may work on (an account's `floors`, see server/accounts.ts): an admin every floor, a member
// the ones they were given (every floor when they weren't given a list). On the rest they're read-only: they ride
// there, look round, and read its workers' chats, files and reviews, but hire, direct, approve and change nothing.

/** A floor id as an account keeps it. */
export const FLOOR_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function mayWork(me: Pick<Me, 'admin' | 'floors'>, floor: string | null | undefined): boolean {
  return me.admin || !me.floors || (!!floor && me.floors.includes(floor));
}

/** What someone read-only on `floorName` is told when they try. */
export const readOnlyText = (floorName: string) => `You can look round ${floorName}, but not work there: ask an admin to give you ${floorName}`;

/** A list of floors from somewhere it can't be trusted: the well formed ids, each once; undefined for every floor. */
export function cleanFloors(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === 'all') return undefined;
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(raw.filter((f): f is string => typeof f === 'string' && FLOOR_ID.test(f)))].slice(0, 200);
}
