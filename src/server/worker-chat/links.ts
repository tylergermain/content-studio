import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { linkTargets } from '../../shared/chat-links.js';
import { artifactKey, type ChatArtifact, type ChatMessage, type LinkedFile, type OutsideLink } from '../../shared/worker-chat.js';
import { tildify, untildify, within } from '../paths.js';
import { artifactPath, artifactType, listFolder, publicArtifact } from './artifacts.js';
import { readShares, suggestShare, type Share, type ShareGuard } from './shares.js';
import { conversation } from './transcripts.js';
import type { Floor } from '../floor.js';

// The files a worker linked in its messages, found where the office may serve them: the worker's own
// folder, or a folder an admin shared with the floor. Inside a share only what the worker linked is
// served, and whatever else is in a linked file's folder; never the rest of the share. Links that
// resolve are remembered, so earlier versions stay once the transcript's tail has moved past them.

/** Each share's linked files and folders (paths inside the share), by share id. */
type Served = Map<string, { files: Set<string>; folders: string[] }>;
/** `nearby` is the other files in the linked files' folders: earlier versions, chapters, notes. */
export interface WorkerLinks { linked: LinkedFile[]; served: Served; unresolved: string[]; nearby: ChatArtifact[] }

const MAX_TARGETS = 200;
const MAX_REMEMBERED = 200;
const NEARBY_FOLDERS = 6, NEARBY_PER_FOLDER = 30;
const MAX_OUTSIDE = 5;
const TTL = 10_000;
const cache = new Map<string, { at: number; newest?: string; shares: string; links: WorkerLinks }>();
const outside = new WeakMap<WorkerLinks, Promise<OutsideLink[]>>();

/** The folder a worker's chat previews: the floor for a specialist, else the worker's own folder. */
export function defaultRoot(floor: Floor, id: string): string {
  return floor.workers.get(id)?.specialist ? floor.dir : floor.workers.owners().find(o => o.workerId === id)?.cwd ?? floor.dir;
}

const realOf = async (p: string) => { try { return await realpath(p); } catch { return undefined; } };
const isAbsolute = (link: string) => path.isAbsolute(untildify(link));

async function linkedFile(abs: string, rel: string, link: string, root?: string): Promise<LinkedFile | undefined> {
  try {
    const s = await stat(abs);
    return { path: rel, name: path.basename(rel), type: artifactType(rel)!, size: s.size, modified: s.mtimeMs, ...(root ? { root } : {}), link };
  } catch { return; }
}

/** Where `link` points, if it's a file the office may serve: in the default root first, then a share. */
async function resolveLink(link: string, cwd: string, root: string, base: string | undefined, shares: Share[]): Promise<LinkedFile | undefined> {
  const target = untildify(link);
  const tries = path.isAbsolute(target) ? [target] : [path.resolve(cwd, target), path.resolve(root, target)];
  for (const candidate of tries) {
    const real = await realOf(candidate);
    if (!real) continue;
    if (base && within(real, base)) {
      const rel = path.relative(base, real), abs = rel && await artifactPath(base, rel);
      if (abs) return linkedFile(abs, rel, link);
    }
    for (const share of shares) {
      if (!within(real, share.dir)) continue;
      const rel = path.relative(share.dir, real), abs = rel && await artifactPath(share.dir, rel);
      if (abs) return linkedFile(abs, rel, link, share.id);
    }
  }
  return;
}

/** Where worker `id`'s links are remembered once they resolve, newest first: at most 200, mode 0600. */
const memoryOf = (floor: Floor, id: string) => path.join(floor.dir, '.agent-office', 'worker-chat', `${id}.links.json`);

function remembered(floor: Floor, id: string): string[] {
  try {
    const file = memoryOf(floor, id), info = lstatSync(file);
    if (!info.isFile() || info.size > 1024 * 1024) return [];
    const rows: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(rows) ? rows.filter((l): l is string => typeof l === 'string' && !!l && l.length <= 4096 && !/[\x00-\x1f\x7f]/.test(l)).slice(0, MAX_REMEMBERED) : [];
  } catch { return []; }
}

function remember(floor: Floor, id: string, links: string[]): void {
  const file = memoryOf(floor, id), tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify(links.slice(0, MAX_REMEMBERED)), { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  } catch { /* Only a convenience: the links in the transcript still open. */ } finally { rmSync(tmp, { force: true }); }
}

/** The other files right in the linked files' folders (never at the top of a root), up to 30 in each of 6 folders. */
async function nearbyFiles(linked: LinkedFile[], taken: Set<string>, root: string, shares: Share[]): Promise<ChatArtifact[]> {
  const folders: { root?: string; dir: string; rel: string }[] = [];
  for (const f of linked) {
    const rel = path.dirname(f.path), dir = f.root ? shares.find(s => s.id === f.root)?.dir : root;
    if (rel === '.' || !dir || folders.some(x => x.root === f.root && x.rel === rel)) continue;
    if (folders.push({ root: f.root, dir, rel }) >= NEARBY_FOLDERS) break;
  }
  const nearby: ChatArtifact[] = [];
  for (const x of folders) {
    const own = linked.filter(f => f.root === x.root && path.dirname(f.path) === x.rel).length;
    const found = (await listFolder(x.dir, x.rel, NEARBY_PER_FOLDER + own)).map(a => x.root ? { ...a, root: x.root } : a);
    nearby.push(...found.filter(a => !taken.has(artifactKey(a))).slice(0, NEARBY_PER_FOLDER));
  }
  return nearby;
}

async function resolveAll(floor: Floor, id: string, said: ChatMessage[], shares: Share[]): Promise<WorkerLinks> {
  const root = defaultRoot(floor, id), base = await realOf(root);
  // A relative link is relative to where the worker runs: <floor>/agents/<id> for a specialist.
  const cwd = floor.workers.owners().find(o => o.workerId === id)?.cwd ?? floor.dir;
  const linked: LinkedFile[] = [], served: Served = new Map(), unresolved: string[] = [], fresh: string[] = [];
  const targets = new Set<string>(), files = new Set<string>();
  const add = (file: LinkedFile) => {
    if (file.root) {
      let s = served.get(file.root);
      if (!s) served.set(file.root, s = { files: new Set(), folders: [] });
      s.files.add(file.path);
      const folder = path.dirname(file.path);
      if (folder !== '.' && !s.folders.includes(folder)) s.folders.push(folder);
    }
    if (!files.has(artifactKey(file))) { files.add(artifactKey(file)); linked.push(file); }
  };
  for (const message of [...said].reverse()) {
    for (const link of linkTargets(message.text)) {
      if (targets.has(link)) continue;
      if (targets.size >= MAX_TARGETS) break;
      targets.add(link);
      const file = await resolveLink(link, cwd, root, base, shares);
      if (!file) { if (isAbsolute(link)) unresolved.push(link); continue; }
      fresh.push(link); add(file);
    }
    if (targets.size >= MAX_TARGETS) break;
  }
  // Then what it linked before, looked up again by the same rules: a share that's gone takes its links with it.
  const before = remembered(floor, id), known = new Set(before);
  for (const link of before) {
    if (targets.has(link)) continue;
    targets.add(link);
    const file = await resolveLink(link, cwd, root, base, shares);
    if (file) add(file);
  }
  if (fresh.some(l => !known.has(l))) { const now = new Set(fresh); remember(floor, id, [...fresh, ...before.filter(l => !now.has(l))]); }
  return { linked, served, unresolved, nearby: await nearbyFiles(linked, files, root, shares) };
}

/**
 * What the worker linked in its assistant messages, newest first, then what it linked in messages the
 * transcript's tail no longer holds, and the files beside them. Pass the conversation when it's
 * already read; without it the transcript is read here. Kept 10 s per worker, and worked out again
 * when its newest message or the floor's shares change.
 */
export async function workerLinks(floor: Floor, id: string, guard: ShareGuard, messages?: ChatMessage[]): Promise<WorkerLinks> {
  const w = floor.workers.sessionContext(id);
  if (!w || w.info.kind !== 'agent') return { linked: [], served: new Map(), unresolved: [], nearby: [] };
  const shares = readShares(floor.dir, guard), sig = shares.map(s => s.id).join(',');
  const key = `${floor.dir}\0${id}`, kept = cache.get(key);
  const given = messages?.filter(m => m.role === 'assistant');
  if (kept && kept.shares === sig && Date.now() - kept.at < TTL && (!given || kept.newest === given.at(-1)?.id)) return kept.links;
  const said = given ?? (await conversation(w, path.join(floor.dir, '.agent-office'))).filter(m => m.role === 'assistant');
  const links = await resolveAll(floor, id, said, shares);
  if (cache.size > 128) cache.clear();
  cache.set(key, { at: Date.now(), newest: said.at(-1)?.id, shares: sig, links });
  return links;
}

/**
 * The file at `rel` in share `root`, when this worker linked it or it's in the folder of a file the
 * worker linked there (a file linked at the share's top level opens only itself). Undefined otherwise.
 */
export async function shareFile(floor: Floor, id: string, guard: ShareGuard, root: string, rel: string): Promise<string | undefined> {
  if (!publicArtifact(rel)) return;
  const share = readShares(floor.dir, guard).find(s => s.id === root);
  const allowed = share && (await workerLinks(floor, id, guard)).served.get(root);
  if (!share || !allowed) return;
  const inside = (p: string) => allowed.files.has(p) || allowed.folders.some(f => p !== f && within(p, f));
  if (!inside(rel)) return;
  const target = await artifactPath(share.dir, rel);
  // Through a symlink, the file itself has to be in a linked folder too.
  return target && inside(path.relative(share.dir, target)) ? target : undefined;
}

async function findOutside(links: WorkerLinks, floor: Floor, guard: ShareGuard): Promise<OutsideLink[]> {
  const found: OutsideLink[] = [];
  for (const link of links.unresolved) {
    if (found.length >= MAX_OUTSIDE) break;
    const real = await realOf(untildify(link));
    if (!real || !artifactType(real)) continue;
    try { if (!(await stat(real)).isFile()) continue; } catch { continue; }
    const folder = suggestShare(real, floor.dir, guard);
    if (folder && publicArtifact(path.relative(folder, real))) found.push({ link, folder, label: tildify(folder) });
  }
  return found;
}

/** For admins: up to 5 linked files outside every folder the office serves, each with the folder that would share it. */
export function outsideLinks(links: WorkerLinks, floor: Floor, guard: ShareGuard): Promise<OutsideLink[]> {
  let found = outside.get(links);
  if (!found) { found = findOutside(links, floor, guard); outside.set(links, found); }
  return found;
}
