import { open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Worker } from '../workers/types.js';
import { displayChatText } from '../../shared/worker-chat.js';
import type { ChatMessage } from '../../shared/worker-chat.js';

const LIMIT = 2 * 1024 * 1024;
/** Only public messages, never reasoning, tool arguments, or authentication state. */
export function parseConversation(lines: string): ChatMessage[] {
  const result: ChatMessage[] = [];
  const assistantTexts = new Set<string>();
  for (const line of lines.split('\n')) {
    try {
      const row = JSON.parse(line);
      const message = row.type === 'response_item' ? row.payload : row.message;
      let role = message?.role;
      let content = message?.content;
      if (row.type === 'event_msg' && ['user_message', 'agent_message'].includes(row.payload?.type)) {
        role = row.payload.type === 'user_message' ? 'user' : 'assistant'; content = row.payload.message;
      }
      if (!['user', 'assistant'].includes(role)) continue;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((v: { type?: string }) => ['text', 'input_text', 'output_text'].includes(v?.type ?? '')).map((v: { text?: string }) => v.text ?? '').join('\n') : '';
      if (!text.trim() || text.startsWith('<local-command') || text.startsWith('<system-reminder>')) continue;
      if (result.at(-1)?.role === role && result.at(-1)?.text === text) continue;
      if (role === 'user') assistantTexts.clear();
      else { if (assistantTexts.has(text)) continue; assistantTexts.add(text); }
      const id = createHash('sha256').update(`${role}:${text}:${row.timestamp ?? result.length}`).digest('hex').slice(0, 24);
      result.push({ id, role, text: (role === 'user' ? displayChatText(text) : text).slice(0, 24000), at: Date.parse(row.timestamp ?? '') || undefined });
    } catch { /* A partial append is read on the next poll. */ }
  }
  return result.slice(-100);
}

async function tail(file: string, root: string): Promise<string> {
  const base = await realpath(root); const resolved = await realpath(file);
  const rel = path.relative(base, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
  const fd = await open(resolved, 'r');
  try {
    const stat = await fd.stat(); if (!stat.isFile()) return '';
    const start = Math.max(0, stat.size - LIMIT); const data = Buffer.alloc(Math.min(stat.size, LIMIT));
    await fd.read(data, 0, data.length, start);
    const text = data.toString('utf8'); return start ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { await fd.close(); }
}

export async function conversation(w: Worker, dataDir: string): Promise<ChatMessage[]> {
  if (!w.info.sessionId) return [];
  try {
    if (w.info.provider === 'claude') {
      const file = w.tracker.transcript;
      if (!file || path.basename(file) !== `${w.info.sessionId}.jsonl`) return [];
      return parseConversation(await tail(file, path.dirname(file)));
    }
    if (w.info.provider === 'codex') {
      const s = w.state as { transcript?: string; home?: string };
      if (!s.transcript || !path.basename(s.transcript).endsWith(`-${w.info.sessionId}.jsonl`)) return [];
      return parseConversation(await tail(s.transcript, s.home ?? path.join(homedir(), '.codex')));
    }
    if (w.info.provider === 'pi') {
      const root = path.join(dataDir, 'pi-sessions', w.info.id);
      const files = (await readdir(root)).filter(f => f.endsWith('.jsonl')).slice(-100);
      for (const name of files.reverse()) {
        const text = await tail(path.join(root, name), root);
        // Pi's header identifies the session. A tail of a large session can identify it by filename.
        if (!name.includes(w.info.sessionId) && !text.split('\n').slice(0, 2).some(line => { try { return JSON.parse(line).id === w.info.sessionId; } catch { return false; } })) continue;
        return parseConversation(text);
      }
    }
  } catch { /* A worker without a transcript still has live status and local chat history. */ }
  return [];
}
