import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Piece } from '../shared/furniture.js';
import { layoutDesks, type DeskLayout } from '../shared/office-builder.js';
import { DESK_BY_ID } from '../shared/layout.js';
import { projectRoomAt, workerProject, type WorkerProject } from '../shared/project-rooms.js';

/**
 * The office's side of project rooms (see shared/project-rooms.ts): checking a room's folder as its
 * layout is saved, and which room a desk is in when someone's hired at it.
 */

/** Whether `inner` is `outer` or inside it. */
const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);

/**
 * Checks the folder of every project room in `furniture` and says whether each is a git checkout
 * (Piece.project.git, which only the office sets). A folder has to be there, be a folder, and be inside
 * the home folder of whoever runs the office without being it, and not inside the floor's own
 * `.agent-office`. Why one won't do, naming the room; or nothing.
 */
export function checkProjects(furniture: Piece[], floorDir: string, home: string = homedir()): string | undefined {
  const realHome = safeReal(home) ?? home;
  const own = path.join(safeReal(floorDir) ?? floorDir, '.agent-office');
  for (const p of furniture) {
    if (!p.project) continue;
    delete p.project.git;
    const dir = p.project.dir;
    if (!dir) continue;
    const name = p.text || 'Project';
    const real = safeReal(dir);
    if (!real || !statSync(real).isDirectory()) return `${name}: there's no folder at ${dir} on this computer`;
    if (!within(real, realHome) || real === realHome) return `${name}: choose a folder inside ${realHome}, not the home folder itself or anywhere outside it`;
    if (within(real, own)) return `${name}: the floor's own .agent-office folder can't be a project`;
    if (existsSync(path.join(real, '.git'))) p.project.git = true;
  }
  return undefined;
}

function safeReal(dir: string): string | undefined {
  try {
    return realpathSync(dir);
  } catch {
    return undefined;
  }
}

/** Where the desk or bean bag `deskId` stands on a floor laid out as `desks` (see layoutDesks). */
function deskSpot(desks: DeskLayout, deskId: string): { x: number; z: number } | undefined {
  return layoutDesks(desks).find((d) => d.id === deskId) ?? DESK_BY_ID.get(deskId);
}

/** The project room the desk `deskId` is in on a floor with this layout, as a worker hired there keeps it; nothing when it's in none. */
export function deskProject(layout: { desks: DeskLayout; furniture: readonly Piece[] }, deskId: string): WorkerProject | undefined {
  const spot = deskSpot(layout.desks, deskId);
  const room = spot && projectRoomAt(layout.furniture, spot.x, spot.z);
  return room ? workerProject(room) : undefined;
}
