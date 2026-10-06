/**
 * Hiring, as the 3D office and the 2D view (/lite) both do it. No three.js here: the 2D view imports it.
 */
import { seatingOf } from '../../shared/table-seats';
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
  const spot = seatingOf(plan).tables.get(deskId) ?? layoutDesks(plan.desks ?? {}).find((d) => d.id === deskId) ?? DESK_BY_ID.get(deskId);
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
  const where = roomWorktree(deskId) ? `works on ${room.project?.repo ?? room.project?.dir}: this worker gets a worktree of its own` : room.project?.dir ? `works in ${room.project.dir}` : 'has no project folder set yet';
  return `📁 The ${room.text || 'Project'} room ${where}. ${text}`;
}

/**
 * Whether a worker hired at `deskId` may have a worktree: of the floor's project, unless it's in a project room with a
 * folder of its own, which it may have one of when that folder is a repository (see roomWorktree).
 */
export function worktreeAt(deskId: string): boolean {
  return roomWorktree(deskId) || (!!store.project?.branch && !deskRoom(deskId)?.project?.dir);
}

/** Whether `deskId` is in a project room whose project is a repository: whoever's hired there works in a worktree of it, by default. */
export function roomWorktree(deskId: string): boolean {
  const project = deskRoom(deskId)?.project;
  return !!project?.dir && !!project.git;
}

/** The other projects a worker hired at `deskId` can also work in: none for one in a project room's own repository. */
export function repoChoicesAt(deskId: string | undefined): { id: string; name: string }[] {
  return deskId && deskRoom(deskId)?.project?.dir ? [] : repoChoices();
}
