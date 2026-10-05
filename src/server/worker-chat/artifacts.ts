import { opendir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { previewType, type ChatArtifact } from '../../shared/worker-chat.js';

/** The preview types live in shared/worker-chat.ts, so the browser reads links with the same table. */
export const artifactType = previewType;
/** Whether a file may be served to a chat: one of the types `typeOf` knows (the previews', unless a caller has its own, as the design canvas does), nowhere hidden or private. */
export function publicArtifact(file: string, typeOf: (file: string) => string | undefined = artifactType): boolean {
  return !!typeOf(file) && !path.isAbsolute(file) && file.split(/[\\/]/).every(p => p && p !== '..' && !p.startsWith('.') && !/^(node_modules|vendor|credentials?|secrets?|auth|tokens?)$/i.test(p)) && !/(?:credentials|secret|api[-_]?key|auth[-_]?state|^mcp\.local\.json$)/i.test(path.basename(file));
}
export async function artifactPath(root: string, file: string, typeOf: (file: string) => string | undefined = artifactType): Promise<string | undefined> {
  if (!publicArtifact(file, typeOf)) return;
  try {
    const base = await realpath(root); const target = await realpath(path.join(base, file));
    const rel = path.relative(base, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !publicArtifact(rel, typeOf)) return;
    const info = await stat(target); return info.isFile() ? target : undefined;
  } catch { return; }
}
export async function listArtifacts(root: string): Promise<ChatArtifact[]> {
  const found: ChatArtifact[] = []; let visited = 0;
  async function walk(dir: string, depth: number) {
    if (depth > 5 || visited > 3000) return;
    let entries; try { entries = await readdir(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    entries.sort((a,b) => Number(b.name === 'outputs') - Number(a.name === 'outputs'));
    for (const e of entries) {
      if (++visited > 3000) break;
      if (e.name.startsWith('.') || ['node_modules','vendor','dist','build','profile'].includes(e.name) || e.isSymbolicLink()) continue;
      const file = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(file, depth + 1); continue; }
      if (!e.isFile() || !publicArtifact(file)) continue;
      try { const s = await stat(path.join(root,file)); found.push({ path:file, name:e.name, type:artifactType(file)!, size:s.size, modified:s.mtimeMs }); } catch { /* Removed between scan and stat. */ }
    }
  }
  await walk('',0);
  return found.sort((a,b) => b.modified-a.modified).slice(0,60);
}
/**
 * The files right in folder `rel` under `root` (never its subfolders) that a chat may preview, newest
 * first, at most `max`. Nothing through a symlink, and only the first 500 entries of a big folder are read.
 */
export async function listFolder(root: string, rel: string, max: number): Promise<ChatArtifact[]> {
  const found: ChatArtifact[] = [];
  if (!rel || rel === '.' || path.isAbsolute(rel)) return found;
  try {
    const base = await realpath(root), dir = path.join(base, rel);
    if (await realpath(dir) !== dir) return found;
    let read = 0;
    for await (const e of await opendir(dir)) {
      if (++read > 500) break;
      const file = path.join(rel, e.name);
      if (!e.isFile() || !publicArtifact(file)) continue;
      try { const s = await stat(path.join(base, file)); found.push({ path:file, name:e.name, type:artifactType(file)!, size:s.size, modified:s.mtimeMs }); } catch { /* Removed meanwhile. */ }
    }
  } catch { return []; }
  return found.sort((a,b) => b.modified-a.modified).slice(0, max);
}
