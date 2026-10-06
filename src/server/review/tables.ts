import { roomsOf } from '../factory-rooms.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import type { WorkerInfo } from '../../shared/protocol.js';

// A project table's review (http/routes/table-review.ts): what's sent from it goes to a new agent hired at the
// table's first free chair, in a worktree of the table's repository when it has one, its first task the review.

/** The key a table's review is kept under in server/review/store.ts, beside the workers' (whose ids are hex). */
export const tableKey = (room: string) => `room-${room}`;

/** Message ids already acted on, so a retried Send or Start hires nobody twice. */
const done = new Set<string>();

/** Hires a new agent at `room`'s table with `task` as its first request, on behalf of `account`; why not, as a string. */
export async function hireAtTable(ctx: Ctx, floor: Floor, room: string, task: string, by: string, account: string | undefined, requestId: string): Promise<WorkerInfo | string> {
  if (done.has(requestId)) return 'That was sent already';
  const table = roomsOf(floor).find((r) => r.id === room);
  if (!table) return 'There is no such table on this floor';
  if (!table.free) return `Every chair at ${table.name} is taken: send someone home first`;
  const denied = floor.workers.hiringPolicy?.(account, undefined, 'agent');
  if (denied) return denied;
  await floor.workers.fetchRoom(table.free);
  if (!ctx.floors.has(floor.id)) return 'The floor is gone';
  const hired = floor.workers.spawn(table.free, by, task, !!table.git, 'agent', undefined, undefined, undefined, undefined, account);
  if (typeof hired === 'string') return hired;
  done.add(requestId);
  if (done.size > 500) done.delete(done.values().next().value as string);
  ctx.toastFloor(floor, `\u{1f9d1}\u200d\u{1f4bb} ${by} put ${hired.name} to work at ${table.name}`);
  return hired;
}

/** The first request of an agent hired to get a table's app running, so it shows on the table's screen and in review. */
export function startAppTask(name: string): string {
  return `Get ${name}'s app running so it can be reviewed at this table: install its packages in your worktree, then run its dev server from there on a free port and leave it running. Its screen and Software review show it as soon as it answers. Say the address when it's up, and if it needs settings or keys it doesn't have, say which.`;
}
