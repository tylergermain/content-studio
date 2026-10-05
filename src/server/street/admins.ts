// Who runs Main Street. A street admin claims, changes and releases plots and flies Friday One. For
// now that's the office's own admins (Tyler and Gavin), and anyone in on the shared password, as for
// everything office-wide; once businesses have accounts of their own it becomes the host's admins
// (Me.street), and this is the one place on the server that changes.
import type { Client } from '../office/client.js';
import type { Ctx } from '../office/context.js';

/** Whether `c` is a street admin, asked of the accounts as they are now: ask it on every write. */
export function isStreetAdmin(ctx: Ctx, c: Client): boolean {
  return !c.out && ctx.meOf(c.accountId).admin;
}
