import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { displayChatText } from '../../shared/worker-chat.js';
import type { ChatMessage, ChatReview, ReviewKind } from '../../shared/worker-chat.js';

/** Every kind of review: a new kind fails the typecheck until it's here. */
const KINDS: Record<ReviewKind, true> = { notes: true, approve: true, variations: true, question: true };
export const isReviewKind = (v: unknown): v is ReviewKind => typeof v === 'string' && Object.hasOwn(KINDS, v);

/** A review as kept with its message (its kind, 1 to 4 files and any notes), or undefined when it isn't one. */
function savedReview(v: unknown): ChatReview | undefined {
  const r = v as Partial<ChatReview> | null;
  if (!r || typeof r !== 'object' || !isReviewKind(r.kind) || !Array.isArray(r.files) || !r.files.length || r.files.length > 4) return;
  if (!r.files.every(f => f && typeof f.path === 'string' && (f.root === undefined || typeof f.root === 'string'))) return;
  if (r.notes !== undefined && !(Array.isArray(r.notes) && r.notes.length <= 50 && r.notes.every(n => n && Number.isFinite(n.at) && n.at >= 0 && typeof n.text === 'string'))) return;
  return { kind: r.kind, files: r.files.map(f => f.root ? { root: f.root, path: f.path } : { path: f.path }), ...(r.notes ? { notes: r.notes.map(n => ({ at: n.at, text: n.text, ...(typeof n.where === 'string' ? { where: n.where } : {}) })) } : {}) };
}

export function chatHistory(dataDir: string, id: string): ChatMessage[] {
  try {
    const rows = JSON.parse(readFileSync(path.join(dataDir,'worker-chat',`${id}.json`),'utf8'));
    if (!Array.isArray(rows)) return [];
    return rows.filter(r => r && ['user','assistant'].includes(r.role) && typeof r.text === 'string' && typeof r.id === 'string').slice(-100).map(r => {
      const review = savedReview(r.review);
      return { id: r.id, role: r.role, text: r.text, ...(Number.isFinite(r.at) ? { at: r.at } : {}), ...(review ? { review } : {}) };
    });
  } catch { return []; }
}
export function keepMessage(dataDir: string, id: string, message: ChatMessage): void {
  const dir = path.join(dataDir,'worker-chat'); mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(path.join(dir,`${id}.json`),JSON.stringify([...chatHistory(dataDir,id),message].slice(-100)),{mode:0o600});
}
export function mergeMessages(session: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  const normalize = (m: ChatMessage) => `${m.role}:${m.text.trim().replace(/\s+/g,' ')}`;
  const seen = new Set(session.map(normalize));
  const visible = local.map(m => ({...m,text:displayChatText(m.text)}));
  // The provider's copy of a review sent from the workspace stands in for the local one, so it takes its review along.
  const reviews = new Map(visible.flatMap(m => m.review ? [[normalize(m), m.review] as const] : []));
  const shown = session.map(m => { const review = m.review ?? reviews.get(normalize(m)); return review ? {...m,review} : m; });
  return [...shown,...visible.filter(m => !seen.has(normalize(m)))].sort((a,b) => (a.at ?? 0)-(b.at ?? 0)).slice(-100);
}
