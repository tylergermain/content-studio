import { LongShots } from './longshots.js';
import { PigGames } from './pig.js';
import { ballChanged } from './ws/handlers/ball.js';
import { ownerOf } from './ws/handlers/hoop.js';
import type { Ctx } from './office/context.js';

/**
 * The hoop's scoreboard, for the whole building: the longest shots and PIG winners (kept in
 * hoop.json), and the games of PIG on its floors, which hand the floor's ball about (see Court).
 */
export function hoopServices(ctx: Ctx, dataDir: string): { longShots: LongShots; pig: PigGames } {
  const longShots = new LongShots(dataDir);
  const pig = new PigGames({
    where(id) {
      const c = ctx.clients.get(id);
      return c && !c.out && !c.peer.lite ? { floor: c.peer.floor, x: c.peer.x, y: c.peer.y, z: c.peer.z } : undefined;
    },
    findOwner(floor, owner) {
      for (const c of ctx.clients.values()) if (!c.out && c.peer.floor === floor && ownerOf(c) === owner) return c.id;
      return undefined;
    },
    changed(floor, state) {
      const f = ctx.floors.get(floor);
      if (f) ctx.toFloor(f, { t: 'pig', pig: state });
    },
    ball(floor, reserved, holder) {
      const f = ctx.floors.get(floor);
      if (!f) return;
      const a = f.court.reserve(reserved);
      const b = holder !== undefined && f.court.hand(holder);
      if (a || b) ballChanged(ctx, f);
    },
    toast(floor, text) {
      ctx.toastFloor(ctx.floors.get(floor), text);
    },
    tell(id, msg) {
      const c = ctx.clients.get(id);
      if (!c) return;
      if ('text' in msg) ctx.sendTo(c, { t: 'toast', text: msg.text, level: 'info' });
      else ctx.sendTo(c, { t: 'pig.invited', from: msg.invitedBy.id, name: msg.invitedBy.name, until: msg.until });
    },
    won(winner) {
      longShots.win(winner);
      ctx.broadcast({ t: 'hoop.board', board: longShots.board() });
    },
    later(ms, fn) {
      const t = setTimeout(fn, ms);
      t.unref();
      return () => clearTimeout(t);
    },
    now: () => Date.now(),
  });
  return { longShots, pig };
}
