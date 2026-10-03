import { accessSync, constants, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Folders on the office's machine, as people type them and as they're shown back.

/** A path under the home folder as ~/…, for showing people. */
export function tildify(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

/** What `~` and `~/…` stand for: the home folder. */
export function untildify(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** `dir` is `parent` or somewhere under it. */
export function within(dir: string, parent: string): boolean {
  const rel = path.relative(parent, dir);
  return !rel || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Why the office couldn't make checkouts under `dir`, if it couldn't. It's made on the first clone, so it needn't exist yet. */
export function unwritable(dir: string): string | undefined {
  let at = dir;
  while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  try {
    if (!statSync(at).isDirectory()) return `${tildify(at)} isn't a folder`;
    accessSync(at, constants.W_OK);
  } catch {
    return `The office can't write in ${tildify(at)}`;
  }
  return undefined;
}
