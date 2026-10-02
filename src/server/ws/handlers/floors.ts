// The building's floors: riding the elevator between them and up to the roof, and adding and taking
// off floors. Anyone rides; managing the building (adding a project, stopping its clone, taking a
// floor off, renaming or moving one, moving the workspace folder) is the admins'.
import type { FloorClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/rooftop.js';
import { arrivalSpot, str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const projectView: ViewPieces['project'] = (_ctx, floor) => floor?.project ?? null;

/** What anyone else is told: a new floor is a clone on the office's machine, with its gh login, that everyone's workers then run in. */
const ADMINS_ADD = 'Only admins can add a project to the building';

export const floorHandlers = {
  'floor.go'(ctx, c, msg) {
    if (msg.floor === ROOF) {
      if (ctx.floors.size) ctx.goToRoof(c);
      else ctx.warn(c, 'There is no building to go up on yet');
      return;
    }
    const floor = ctx.floors.get(str(msg.floor, 64));
    if (!floor) ctx.warn(c, ctx.building.pending().some((d) => d.id === msg.floor) ? "That floor is still being cloned — it'll be ready in a moment" : 'No such floor');
    else ctx.goToFloor(c, floor, arrivalSpot(msg.at));
  },
  'floor.repos'(ctx, c, msg) {
    // What the office's own gh login can see, there to pick a new floor from: it's for whoever may add one.
    if (!ctx.meOf(c.accountId).admin) return ctx.sendTo(c, { t: 'floor.repos', repos: [], error: ADMINS_ADD });
    void ctx.building.repos(msg.refresh === true).then(
      (repos) => ctx.sendTo(c, { t: 'floor.repos', repos }),
      (err: Error) => ctx.sendTo(c, { t: 'floor.repos', repos: [], error: `Couldn't list your repositories with gh: ${err.message}` }),
    );
  },
  'floor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const repo = str(msg.repo, 200);
    if (!ctx.meOf(c.accountId).admin) return ctx.sendTo(c, { t: 'floor.added', repo, error: ADMINS_ADD });
    void ctx.building
      .add(
        repo,
        who,
        (def) => {
          ctx.floorsChanged();
          ctx.toastAll(`🛗 ${who} is adding a floor for ${def.repo ?? def.name}…`);
        },
        c.accountId,
      )
      .then((r) => {
        ctx.floorsChanged();
        if (typeof r === 'string') return ctx.sendTo(c, { t: 'floor.added', repo, error: r });
        const floor = ctx.openFloor(r);
        if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo, error: `Cloned ${r.repo}, but couldn't open its floor — see the office's log` });
        console.log(`  ${who} added a floor for ${r.repo} (${r.dir})`);
        ctx.toastAll(`🛗 New floor: ${r.name}, added by ${who}`);
        ctx.sendTo(c, { t: 'floor.added', repo, floor: floor.id });
      });
  },
  'floor.cancel'(ctx, c, msg) {
    const who = c.peer.name;
    // Only admins add a floor, so only they stop one on its way.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can stop a floor being cloned');
    const id = str(msg.floor, 64);
    const def = ctx.building.pending().find((d) => d.id === id);
    const err = ctx.building.cancel(id, `${who} stopped the clone`, () => true);
    if (err) ctx.warn(c, err);
    else ctx.toastAll(`🛗 ${who} stopped cloning ${def?.repo ?? def?.name ?? 'a floor'}`);
  },
  'floor.folder'(ctx, c, msg) {
    const who = c.peer.name;
    const dir = str(msg.dir, 1024);
    // It's a folder on the office's machine that workers will run in: admins pick it.
    const r = ctx.meOf(c.accountId).admin ? ctx.building.addFolder(dir, str(msg.name, 100), who) : 'Only admins can make a folder a floor';
    if (typeof r === 'string') return ctx.sendTo(c, { t: 'floor.added', repo: dir, error: r });
    const floor = ctx.openFloor(r);
    ctx.floorsChanged();
    if (!floor) return ctx.sendTo(c, { t: 'floor.added', repo: dir, error: `Added ${r.name}, but couldn't open its floor — see the office's log` });
    console.log(`  ${who} added a floor for the folder ${r.dir} (${r.name})`);
    ctx.toastAll(`🛗 New floor: ${r.name}, added by ${who}`);
    ctx.sendTo(c, { t: 'floor.added', repo: dir, floor: floor.id });
  },
  'floor.edit'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can rename or move a floor');
    const id = str(msg.floor, 64);
    const was = ctx.building.list().find((d) => d.id === id)?.name;
    const r = ctx.building.edit(id, { name: msg.name === undefined ? undefined : str(msg.name, 100), to: typeof msg.to === 'number' ? msg.to : undefined });
    if (typeof r === 'string') return ctx.warn(c, r);
    // The floors go by the building's order: the elevator's buttons, and the storeys from the street up.
    const open = new Map(ctx.floors);
    ctx.floors.clear();
    for (const d of ctx.building.list()) if (open.has(d.id)) ctx.floors.set(d.id, open.get(d.id)!);
    const floor = ctx.floors.get(id);
    if (floor) floor.project.name = r.name;
    ctx.floorsChanged();
    if (was && was !== r.name) ctx.toastAll(`🛗 ${c.peer.name} renamed the ${was} floor to ${r.name}`);
  },
  'floor.remove'(ctx, c, msg) {
    const who = c.peer.name;
    // Everyone's workers on it stop: admins do it.
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can take a floor off the building');
    const id = str(msg.floor, 64);
    const r = ctx.building.remove(id, who);
    if (typeof r === 'string') return ctx.warn(c, r);
    console.log(`  ${who} took the ${r.name} floor off the building (${r.dir} stays where it is)`);
    const floor = ctx.floors.get(id);
    if (floor) ctx.closeFloor(floor, who);
    else ctx.floorsChanged();
  },
  'floor.projectsDir'(ctx, c, msg) {
    const who = c.peer.name;
    // It's a folder on the office's machine that `gh` writes into: admins pick it.
    const err = ctx.meOf(c.accountId).admin ? ctx.building.setProjectsDir(str(msg.dir, 1024), who) : 'Only admins can move the workspace folder';
    ctx.warn(c, err);
    if (err) return;
    const state = ctx.building.projectsDirState();
    ctx.broadcast({ t: 'projectsDir', state });
    ctx.toastAll(state.custom ? `📁 ${who} moved the workspace folder to ${state.dir}` : `📁 ${who} put the workspace folder back to ${state.dir}`);
  },
} satisfies HandlerMap<FloorClientMsg>;
