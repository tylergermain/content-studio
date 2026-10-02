import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { employeeHireError } from './policy.js';

/** Employees cannot use an administrator's agent as a proxy for unrestricted hiring. */
export function employeeWorkerError(ctx: Ctx, floor: Floor, account: string|undefined, id: string): string|undefined {
  if(ctx.meOf(account).admin)return;
  const info=floor.workers.get(id);if(!info)return 'No such worker';
  if(!account || floor.workers.ownerOf(id)!==account)return 'Employees may control only specialists hired on their own account';
  return employeeHireError(floor.dir,ctx.accounts,account,info.specialist,info.kind);
}
