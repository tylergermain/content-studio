import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { normalizeRepo, sameRepo } from '../shared/floors.js';
import { checkoutAt } from './building.js';
import { CloneRun, dropLog } from './clone.js';
import { gh } from './github.js';
import { projectRoomAt } from '../shared/project-rooms.js';
import type { RoomView } from '../shared/factory.js';
import type { Floor } from './floor.js';
import type { Ctx } from './office/context.js';
import { layoutFurniture } from '../shared/office-builder.js';

// A floor's project rooms as the Rooms panel shows them (client/ui/rooms/): each with its name, the GitHub repository
// it's for, the chairs in it and who's at them. Setting one up for a repository clones it (Building.checkout) into
// the projects folder, where a floor of it would be, and the room keeps that checkout as its project: whoever's
// hired there works in a worktree of it (WorkerManager.spawn). Taking a room's repository away keeps the clone.

/** Project rooms' clones under way, by lower-cased repository: two rooms of one repository wait for the one clone. */
const clones = new Map<string, Promise<{ repo: string; dir: string } | string>>();

/**
 * A checkout of `input` (owner/name) for a project room: a floor's of it, one already in the projects folder where a
 * floor would clone it, or a fresh clone there (CloneRun, logged in the office's clones folder). The repository's real
 * name and the folder, or why not.
 */
export async function checkoutRepo(ctx: Ctx, input: string): Promise<{ repo: string; dir: string } | string> {
  const wanted = normalizeRepo(input);
  if (!wanted) return 'Pick a repository, or type it as owner/name';
  let repo: string;
  let empty = false;
  try {
    const view = JSON.parse(await gh(['repo', 'view', wanted, '--json', 'nameWithOwner,isEmpty'], ctx.cfg.dataDir, 30_000)) as { nameWithOwner?: string; isEmpty?: boolean };
    repo = normalizeRepo(view.nameWithOwner) ?? wanted;
    empty = view.isEmpty === true;
  } catch (err) {
    return `Couldn't find ${wanted} on GitHub: ${(err as Error).message}`;
  }
  const key = repo.toLowerCase();
  const going = clones.get(key);
  if (going) return going;
  const run = (async (): Promise<{ repo: string; dir: string } | string> => {
    const floor = ctx.building.list().find((d) => sameRepo(d.repo, repo) && existsSync(d.dir));
    if (floor) return { repo, dir: floor.dir };
    const [owner, name] = repo.split('/');
    const dir = path.join(ctx.building.projectsDir, owner, name);
    const there = checkoutAt(dir, repo, empty);
    if (there === 'ok') return { repo, dir };
    if (there !== 'none') return there;
    const logs = path.join(ctx.cfg.dataDir, 'clones');
    try {
      mkdirSync(path.dirname(dir), { recursive: true });
      mkdirSync(logs, { recursive: true, mode: 0o700 });
    } catch (err) {
      return `Couldn't make ${path.dirname(dir)}: ${(err as Error).message}`;
    }
    const clone = await CloneRun.start(repo, dir, path.join(logs, `room__${repo.replace('/', '__')}.log`), {});
    if (typeof clone === 'string') return clone;
    const end = await clone.done;
    dropLog(clone.log);
    if (end.stopped) return end.stopped;
    return checkoutAt(dir, repo, empty) === 'ok' ? { repo, dir } : `Couldn't clone ${repo} into ${dir}`;
  })();
  clones.set(key, run);
  try {
    return await run;
  } finally {
    clones.delete(key);
  }
}

/** Rooms being set up now, and the last one that didn't work, by floor and room. */
const setting = new Map<string, { repo: string; error?: string }>();
const keyOf = (floor: Floor, room: string) => `${floor.id}:${room}`;

export function roomsOf(floor: Floor): RoomView[] {
  const furniture = layoutFurniture(floor.plan.state());
  const tables = [...floor.plan.seating().tables.values()];
  const workers = floor.workers.list();
  return furniture.filter((p) => p.kind === 'project-room' && !p.level).map((p): RoomView => {
    const seats = tables.filter((s) => projectRoomAt(furniture, s.x, s.z)?.id === p.id).map((s) => s.id);
    const here = workers.filter((w) => seats.includes(w.deskId) || w.project?.room === p.id);
    const busy = new Set(workers.map((w) => w.deskId));
    const state = setting.get(keyOf(floor, p.id));
    return {
      id: p.id,
      name: p.text || 'Project',
      ...(p.project?.repo ? { repo: p.project.repo } : {}),
      ...(p.project?.dir ? { dir: p.project.dir } : {}),
      ...(p.project?.git ? { git: true } : {}),
      ...(p.project?.url ? { url: p.project.url } : {}),
      ...(state && !state.error ? { cloning: state.repo } : {}),
      ...(state?.error ? { error: state.error } : {}),
      seats: seats.length,
      ...(seats.find((s) => !busy.has(s)) ? { free: seats.find((s) => !busy.has(s)) } : {}),
      agents: here.map((w) => ({ id: w.id, name: w.name, status: w.status })),
    };
  });
}

const announce = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'plan', plan: floor.plan.state() });

/** Names a room and, with `repo`, sets it up for that repository (cloning it first). Why not, now; a clone that fails says so later. */
export function setUpRoom(ctx: Ctx, floor: Floor, room: string, ask: { name?: string; repo?: string; url?: string | null }, by: string): string | undefined {
  const piece = layoutFurniture(floor.plan.state()).find((p) => p.id === room && p.kind === 'project-room');
  if (!piece) return 'There is no such room on this floor';
  // A new name or app address (null takes it away), with no new repository: saved as it is.
  if ((ask.name !== undefined || ask.url !== undefined) && !ask.repo) {
    const project = ask.url === undefined ? undefined : { ...piece.project, url: ask.url ?? undefined };
    const r = floor.plan.setRoom(room, { ...(ask.name !== undefined ? { name: ask.name } : {}), ...(project ? { project } : {}) });
    if (typeof r === 'string') return r;
    announce(ctx, floor);
    return undefined;
  }
  if (!ask.repo) return 'Pick a repository for the room';
  if (setting.get(keyOf(floor, room)) && !setting.get(keyOf(floor, room))?.error) return 'That room is already being set up';
  const repo = ask.repo;
  setting.set(keyOf(floor, room), { repo });
  ctx.toastFloor(floor, `\u{1f3ed} ${by} is setting up ${ask.name || piece.text || 'a room'} for ${repo}\u2026`);
  void checkoutRepo(ctx, repo).then((r) => {
    if (!ctx.floors.has(floor.id)) return;
    if (typeof r === 'string') {
      setting.set(keyOf(floor, room), { repo, error: r });
      ctx.toastFloor(floor, `Couldn't set up the room for ${repo}: ${r}`, 'warn');
      return;
    }
    const done = floor.plan.setRoom(room, { ...(ask.name ? { name: ask.name } : {}), project: { dir: r.dir, repo: r.repo } });
    if (typeof done === 'string') {
      setting.set(keyOf(floor, room), { repo, error: done });
      ctx.toastFloor(floor, `Couldn't set up the room for ${repo}: ${done}`, 'warn');
      return;
    }
    setting.delete(keyOf(floor, room));
    announce(ctx, floor);
    ctx.toastFloor(floor, `\u{1f3ed} ${done.text} is set up for ${r.repo}: anyone hired there works in a worktree of it`);
  });
  return undefined;
}

/** Takes a room's repository away (its clone stays where it is). Why not, or nothing. */
export function releaseRoom(ctx: Ctx, floor: Floor, room: string, by: string): string | undefined {
  if (floor.workers.list().some((w) => w.project?.room === room)) return 'Send the room\u2019s workers home first';
  const r = floor.plan.setRoom(room, { project: null });
  if (typeof r === 'string') return r;
  setting.delete(keyOf(floor, room));
  announce(ctx, floor);
  ctx.toastFloor(floor, `${by} cleared ${r.text}`);
  return undefined;
}
