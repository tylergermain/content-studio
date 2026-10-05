/**
 * Hiring, as the 3D office and the 2D view (/lite) both do it. No three.js here: the 2D view imports it.
 */
import type { Piece } from '../../shared/furniture';
import { DESK_BY_ID } from '../../shared/layout';
import { layoutDesks, layoutFurniture } from '../../shared/office-builder';
import { projectRoomAt } from '../../shared/project-rooms';
import { store } from '../state';

/** The building's other projects a new worker can work in too, each in a worktree of its own (see WorkerInfo.repos). */
export function repoChoices(): { id: string; name: string }[] {
  return store.floors.filter((f) => f.id !== store.floor && f.branch && !f.cloning).map((f) => ({ id: f.id, name: f.name }));
}

/** The project room the desk `deskId` is in on this floor, as its layout was last saved (see shared/project-rooms.ts). */
export function deskRoom(deskId: string): Piece | undefined {
  const plan = store.floorPlan;
  const spot = layoutDesks(plan.desks ?? {}).find((d) => d.id === deskId) ?? DESK_BY_ID.get(deskId);
  return spot ? projectRoomAt(layoutFurniture(plan), spot.x, spot.z) : undefined;
}

/** A desk's name, with the project room it's in: "Desk 3 · 📁 Kenna". */
export function deskLabel(deskId: string, label: string): string {
  const room = deskRoom(deskId);
  return room ? `${label} · 📁 ${room.text || 'Project'}` : label;
}

/** What hiring at `deskId` says first: `text`, after which project's folder the worker will work in when the desk is in a project room. */
export function hireNote(deskId: string, text: string): string {
  const room = deskRoom(deskId);
  if (!room) return text;
  const where = room.project?.dir ? `works in ${room.project.dir}` : 'has no project folder set yet';
  return `📁 The ${room.text || 'Project'} room ${where}. ${text}`;
}

/** Whether a worker hired at `deskId` may have a worktree of the floor's project: not in a project room with a folder of its own. */
export function worktreeAt(deskId: string): boolean {
  return !!store.project?.branch && !deskRoom(deskId)?.project?.dir;
}
