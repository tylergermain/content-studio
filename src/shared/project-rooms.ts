// Project rooms: an area of a floor that belongs to one project (the `project-room` piece of
// furniture, see shared/furniture.ts). The builder lays one down like a rug, as big as the room it
// marks, and names it; its project is a folder on the office's computer and, if it has one, the
// address its app runs at. A worker hired at a desk inside it starts in that folder (see
// WorkerManager.spawn), and a specialist, who starts in its role's folder, is told where the project is.
// No three.js and no Node here: the builder, the office and the tests all read it.

import type { Piece } from './furniture.js';

/** What a project room's project is (see Piece.project). */
export interface ProjectLink {
  /** The project's folder on the office's computer, as an absolute path. */
  dir?: string;
  /** Where its app runs, for whoever wants to open it: http or https. */
  url?: string;
  /** A room kept for a project you're always on, rather than one for now. */
  keep?: boolean;
  /** Whether the folder is a git checkout. The office says so when the layout is saved; a browser's word isn't taken. */
  git?: boolean;
}

/** The project room a worker was hired into (see WorkerInfo.project): its piece's id, its name and its project. */
export interface WorkerProject {
  room: string;
  name: string;
  dir?: string;
  url?: string;
}

/** How long and wide a project room may be, in meters. */
export const PROJECT_SIZE = { min: 2, max: 30 } as const;
export const MAX_PROJECT_PATH = 400;
export const MAX_PROJECT_URL = 300;

const QUARTER = Math.PI / 2;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** A room's length or width as it's kept: within PROJECT_SIZE, on a 25 cm step; `or` for anything that isn't a number. */
export function cleanProjectSize(raw: unknown, or: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : or;
  return Math.round(Math.max(PROJECT_SIZE.min, Math.min(PROJECT_SIZE.max, n)) * 4) / 4;
}

/** A folder's path as it's kept: absolute, on one line, without `..`; nothing for anything else. Whether it's there is the office's to check (see server/project-rooms.ts). */
export function cleanProjectDir(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const dir = raw.trim().replace(/\/+$/, '');
  if (!dir.startsWith('/') || dir.length > MAX_PROJECT_PATH || CONTROL.test(dir)) return undefined;
  if (dir.split('/').some((part) => part === '..' || part === '.')) return undefined;
  return dir;
}

/** An app's address as it's kept: http or https, on one line; nothing for anything else. */
export function cleanProjectUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!text || text.length > MAX_PROJECT_URL || CONTROL.test(text)) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A project room's project from somewhere it can't be trusted (a browser, a file): what of it is fit to keep, or nothing. */
export function cleanProject(raw: unknown): ProjectLink | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const dir = cleanProjectDir(r.dir);
  const url = cleanProjectUrl(r.url);
  const link: ProjectLink = { ...(dir ? { dir } : {}), ...(url ? { url } : {}), ...(r.keep === true ? { keep: true } : {}), ...(dir && r.git === true ? { git: true } : {}) };
  return Object.keys(link).length ? link : undefined;
}

/** The floor a project room covers: its length and width turned with it (a quarter turn at a time). */
function roomBox(p: Piece, w: number, d: number) {
  const q = ((Math.round(p.rotY / QUARTER) % 4) + 4) % 4;
  const hx = (q % 2 ? d : w) / 2;
  const hz = (q % 2 ? w : d) / 2;
  return { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz };
}

/**
 * The project room a point on the office floor is in: the smallest of those it's in, so a room marked
 * out inside a bigger one is its own. What's upstairs isn't counted: the workers' desks are all downstairs.
 */
export function projectRoomAt(furniture: readonly Piece[], x: number, z: number): Piece | undefined {
  let best: Piece | undefined;
  let area = Infinity;
  for (const p of furniture) {
    if (p.kind !== 'project-room' || p.level) continue;
    const w = p.w ?? PROJECT_SIZE.min;
    const d = p.d ?? PROJECT_SIZE.min;
    const b = roomBox(p, w, d);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || w * d >= area) continue;
    best = p;
    area = w * d;
  }
  return best;
}

/** A worker's project room as it was saved (see server/workers/persist.ts): what of it is fit to keep, or nothing. */
export function cleanWorkerProject(raw: unknown): WorkerProject | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.room !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(r.room) || typeof r.name !== 'string' || !r.name.trim()) return undefined;
  const dir = cleanProjectDir(r.dir);
  const url = cleanProjectUrl(r.url);
  return { room: r.room, name: r.name.slice(0, 60), ...(dir ? { dir } : {}), ...(url ? { url } : {}) };
}

/** What a worker hired into project room `p` keeps of it (see WorkerInfo.project). */
export function workerProject(p: Piece): WorkerProject {
  return { room: p.id, name: p.text || 'Project', ...(p.project?.dir ? { dir: p.project.dir } : {}), ...(p.project?.url ? { url: p.project.url } : {}) };
}

/**
 * What a worker in a project room is told ahead of its first request: which room it's in, where the
 * project is and where its app runs. `inFolder` is whether it already starts in the project's folder
 * (a specialist starts in its role's folder instead, see WorkerManager.cwd).
 */
export function projectBrief(project: WorkerProject, inFolder: boolean): string {
  const lines = [`You're working in the ${project.name} room of the office.`];
  if (project.dir) lines.push(inFolder ? `Your working folder is the project itself: ${project.dir}` : `Its project is in ${project.dir}: do this task's work there, and keep any notes you make for it there too.`);
  else lines.push('The room has no project folder set yet, so ask before you assume one.');
  if (project.url) lines.push(`The project's app runs at ${project.url}.`);
  lines.push('Other workers may be in this project at the same time: do not switch branches, stash, reset or commit in it unless you are asked to.');
  return lines.join('\n');
}
