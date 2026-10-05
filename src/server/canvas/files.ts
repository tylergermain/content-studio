import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { canvasType } from '../../shared/design-canvas.js';

// Which files the design canvas serves from a worker's folder (see http/routes/canvas.ts): a design
// (`.design.html`) and what it loads from beside it: its pictures, stylesheets and fonts. A design's
// own copies of its pictures live in a `.assets` folder next to it (an import from Paper puts them
// there), which the chat's scans skip, so they don't crowd the Board; nothing else hidden is served.

/** Folders whose names say they hold something private, or that are someone else's code. */
const PRIVATE = /^(node_modules|vendor|credentials?|secrets?|auth|tokens?)$/i;
const SECRET_NAME = /(?:credentials|secret|api[-_]?key|auth[-_]?state|^mcp\.local\.json$)/i;

/** The folder beside a design that holds its own copies of its pictures. */
export const ASSETS_DIR = '.assets';

/** Whether `rel` is a path the canvas may serve under a worker's folder: relative, through no hidden or private folder but `.assets`, of a type it serves. */
export function canvasRelative(rel: string): boolean {
  if (!rel || path.isAbsolute(rel) || rel.includes('\0') || !canvasType(rel)) return false;
  const parts = rel.split(/[\\/]/);
  return parts.every((p, i) => p && p !== '..' && p !== '.' && (!p.startsWith('.') || (p === ASSETS_DIR && i < parts.length - 1)) && !PRIVATE.test(p)) && !SECRET_NAME.test(parts[parts.length - 1]);
}

/** The real path of `rel` under `root` and the type it's served as, when the canvas may serve it: never through a link out of `root`. */
export async function canvasFile(root: string, rel: string): Promise<{ file: string; type: string } | undefined> {
  if (!canvasRelative(rel)) return undefined;
  try {
    const base = await realpath(root);
    const target = await realpath(path.join(base, rel));
    const inside = path.relative(base, target);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !canvasRelative(inside)) return undefined;
    if (!(await stat(target)).isFile()) return undefined;
    return { file: target, type: canvasType(inside)! };
  } catch {
    return undefined;
  }
}
