import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { employeeHireError } from './policy.js';
import { mayWork, readOnlyText } from '../../shared/floor-access.js';

/** Someone read-only on `floor` (shared/floor-access.ts) may look round it but not work there: why, when they are. */
export function floorAccessError(ctx: Ctx, floor: Floor, account: string | undefined): string | undefined {
  return mayWork(ctx.meOf(account), floor.id) ? undefined : readOnlyText(floor.def.name);
}

/** Employees cannot use an administrator's agent as a proxy for unrestricted hiring; nobody directs a worker on a floor they're read-only on. */
export function employeeWorkerError(ctx: Ctx, floor: Floor, account: string|undefined, id: string): string|undefined {
  return floorAccessError(ctx, floor, account) ?? workerRulesError(ctx, floor, account, id);
}

/** The org chart's rules alone (what a member may see of a worker on any floor, read-only or not). */
export function workerRulesError(ctx: Ctx, floor: Floor, account: string|undefined, id: string): string|undefined {
  if(ctx.meOf(account).admin)return;
  const info=floor.workers.get(id);if(!info)return 'No such worker';
  if(!account || floor.workers.ownerOf(id)!==account)return 'Employees may control only specialists hired on their own account';
  return employeeHireError(floor.dir,ctx.accounts,account,info.specialist,info.kind);
}

/**
 * Who may open the files a worker linked in a folder an admin shared: admins, the worker's owner
 * (within their org-chart roles), and, for a worker hired on no account, an employee whose position
 * is above its specialist role.
 */
export function employeeViewError(ctx: Ctx, floor: Floor, account: string|undefined, id: string): string|undefined {
  if(!workerRulesError(ctx,floor,account,id))return;
  const info=floor.workers.get(id);if(!info)return 'No such worker';
  if(!account || floor.workers.ownerOf(id)!==undefined || !info.specialist)return 'Only an admin or the employee who hired this worker can open the files it shared';
  return employeeHireError(floor.dir,ctx.accounts,account,info.specialist,info.kind);
}
