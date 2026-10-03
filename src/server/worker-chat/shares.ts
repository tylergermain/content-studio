import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { untildify, within } from '../paths.js';

// Folders outside a floor that an admin has shared with it, so the links its workers write to files
// there open in the office (see links.ts). Kept in <floor>/.agent-office/shares.json, and every rule
// is checked again on each read, since anything that can write the floor's folder can edit the file.

export interface Share { id: string; dir: string; by: string; at: number }
/** What a share may never be: the office's own data, or a folder holding a floor's. */
export interface ShareGuard { dataDir: string; floorDirs: string[] }

const MAX_SHARES = 8;
const MAX_BYTES = 64 * 1024;
const EXCLUDED = /^(node_modules|vendor|credentials?|secrets?|auth|tokens?)$/i;
const fileOf = (floorDir: string) => path.join(floorDir, '.agent-office', 'shares.json');
const idOf = (dir: string) => `s${createHash('sha256').update(dir).digest('hex').slice(0, 10)}`;
const real = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };

/** The guard for the office in `ctx`: its data folder and every floor's folder. */
export const shareGuard = (ctx: { cfg: { dataDir: string }; floors: ReadonlyMap<string, { dir: string }> }): ShareGuard =>
  ({ dataDir: ctx.cfg.dataDir, floorDirs: [...ctx.floors.values()].map(f => f.dir) });

/** The folder as it would be stored (its realpath), or why it can't be shared. */
function check(raw: string, floorDir: string, guard: ShareGuard): { dir: string } | { error: string } {
  const typed = untildify(raw.trim());
  if (!typed || typed.length > 4096 || /[\x00-\x1f\x7f]/.test(typed)) return { error: 'Enter a folder to share' };
  if (!path.isAbsolute(typed)) return { error: 'Enter the full path of a folder, starting with / or ~' };
  let dir: string;
  try { dir = realpathSync(typed); if (!statSync(dir).isDirectory()) return { error: 'Share a folder, not a file' }; }
  catch { return { error: 'That folder does not exist' }; }
  if (path.dirname(dir) === dir || [os.homedir(), real(os.homedir())].some(home => within(home, dir))) return { error: 'Share a project folder, not the home folder or a folder above it' };
  const data = real(guard.dataDir);
  if (within(dir, data) || within(data, dir)) return { error: "The office's own data folder can't be shared" };
  const floors = [...new Set([floorDir, ...guard.floorDirs].map(real))];
  if (floors.some(f => within(path.join(f, '.agent-office'), dir))) return { error: 'Share a folder that does not hold an office floor' };
  if (within(dir, real(floorDir))) return { error: 'This floor already shows the files in its own folder' };
  if (dir.split(path.sep).some(p => p.startsWith('.') || EXCLUDED.test(p))) return { error: 'Hidden, dependency and credential folders cannot be shared' };
  return { dir };
}

/** Why `dir` can't be shared with the floor in `floorDir`, if it can't. */
export function shareProblem(dir: string, floorDir: string, guard: ShareGuard): string | undefined {
  const checked = check(dir, floorDir, guard);
  return 'error' in checked ? checked.error : undefined;
}

const wellFormed = (s: unknown): s is Share => {
  const v = s as Share;
  return !!v && typeof v.id === 'string' && /^s[0-9a-f]{10}$/.test(v.id) && typeof v.dir === 'string' && v.dir.length <= 4096 && typeof v.by === 'string' && v.by.length <= 200 && Number.isFinite(v.at);
};

/** The entries as saved, or undefined when the file is refused (a symlink, or not a file). */
function load(floorDir: string): Share[] | undefined {
  const file = fileOf(floorDir);
  let info;
  try { info = lstatSync(file); } catch { return []; }
  if (info.isSymbolicLink() || !info.isFile()) return undefined;
  if (info.size > MAX_BYTES) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return raw?.version === 1 && Array.isArray(raw.shares) ? raw.shares.slice(0, MAX_SHARES).filter(wellFormed).map(({ id, dir, by, at }: Share) => ({ id, dir, by, at })) : [];
  } catch { return []; }
}

function save(floorDir: string, shares: Share[]): void {
  const file = fileOf(floorDir);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { if (lstatSync(file).isSymbolicLink()) throw new Error('Shared folders configuration is invalid'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const text = JSON.stringify({ version: 1, shares }, null, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Too many shared folders');
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try { writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' }); renameSync(tmp, file); } finally { if (existsSync(tmp)) unlinkSync(tmp); }
}

/** The floor's shares that still pass every rule, as their folders are now. */
export function readShares(floorDir: string, guard: ShareGuard): Share[] {
  const seen = new Set<string>();
  return (load(floorDir) ?? []).filter(s => {
    if (seen.has(s.id)) return false;
    const checked = check(s.dir, floorDir, guard);
    if ('error' in checked || checked.dir !== s.dir || idOf(s.dir) !== s.id) return false;
    seen.add(s.id); return true;
  });
}

/** Shares `raw` (a path, or ~/…) with the floor, or says why not. Sharing a folder twice gives the same share. */
export function addShare(floorDir: string, raw: string, by: string, guard: ShareGuard): Share | { error: string } {
  if (typeof raw !== 'string') return { error: 'Enter a folder to share' };
  const checked = check(raw, floorDir, guard);
  if ('error' in checked) return checked;
  if (load(floorDir) === undefined) return { error: 'Shared folders configuration is invalid' };
  const shares = readShares(floorDir, guard), id = idOf(checked.dir);
  const already = shares.find(s => s.id === id);
  if (already) return already;
  if (shares.length >= MAX_SHARES) return { error: `A floor can share up to ${MAX_SHARES} folders` };
  const share = { id, dir: checked.dir, by: by.slice(0, 200), at: Date.now() };
  try { save(floorDir, [...shares, share]); } catch (e) { return { error: e instanceof Error ? e.message : 'Could not save the shared folder' }; }
  return share;
}

/** Stops sharing a folder. False when there's no such share, or the file can't be written. */
export function removeShare(floorDir: string, id: string): boolean {
  const shares = load(floorDir);
  if (!shares || !shares.some(s => s.id === id)) return false;
  try { save(floorDir, shares.filter(s => s.id !== id)); return true; } catch { return false; }
}

/**
 * The folder to offer sharing for a file a worker linked outside the floor: its repository's outputs
 * folder when it's in one, else the repository, else the folder it's in. Only one that may be shared.
 */
export function suggestShare(file: string, floorDir: string, guard: ShareGuard): string | undefined {
  let target: string;
  try { target = realpathSync(untildify(file)); } catch { return; }
  let top: string | undefined;
  for (let dir = path.dirname(target); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) { top = dir; break; }
    if (path.dirname(dir) === dir) break;
  }
  const candidates: string[] = [];
  if (top) { const outputs = path.join(top, 'outputs'); candidates.push(within(target, outputs) && target !== outputs ? outputs : top); }
  candidates.push(path.dirname(target));
  for (const c of candidates) { const checked = check(c, floorDir, guard); if (!('error' in checked)) return checked.dir; }
  return;
}
