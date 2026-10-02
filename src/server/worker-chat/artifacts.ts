import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChatArtifact } from '../../shared/worker-chat.js';

const TYPES: Record<string, string> = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.pdf':'application/pdf', '.html':'text/html', '.htm':'text/html', '.md':'text/plain', '.txt':'text/plain', '.json':'text/plain', '.csv':'text/plain' };
export const artifactType = (file: string) => TYPES[path.extname(file).toLowerCase()];
export function publicArtifact(file: string): boolean {
  return !!artifactType(file) && !path.isAbsolute(file) && file.split(/[\\/]/).every(p => p && p !== '..' && !p.startsWith('.') && !/^(node_modules|vendor|credentials?|secrets?|auth|tokens?)$/i.test(p)) && !/(?:credentials|secret|api[-_]?key|auth[-_]?state|^mcp\.local\.json$)/i.test(path.basename(file));
}
export async function artifactPath(root: string, file: string): Promise<string | undefined> {
  if (!publicArtifact(file)) return;
  try {
    const base = await realpath(root); const target = await realpath(path.join(base, file));
    const rel = path.relative(base, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !publicArtifact(rel)) return;
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
      try { const s = await stat(path.join(root,file)); found.push({ path:file, name:e.name, type:artifactType(file), size:s.size, modified:s.mtimeMs }); } catch { /* Removed between scan and stat. */ }
    }
  }
  await walk('',0);
  return found.sort((a,b) => b.modified-a.modified).slice(0,60);
}
