import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { displayChatText } from '../../shared/worker-chat.js';
import type { ChatMessage } from '../../shared/worker-chat.js';

export function chatHistory(dataDir: string, id: string): ChatMessage[] {
  try {
    const rows = JSON.parse(readFileSync(path.join(dataDir,'worker-chat',`${id}.json`),'utf8'));
    return Array.isArray(rows) ? rows.filter(r => r && ['user','assistant'].includes(r.role) && typeof r.text === 'string' && typeof r.id === 'string').slice(-100) : [];
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
  return [...session,...visible.filter(m => !seen.has(normalize(m)))].sort((a,b) => (a.at ?? 0)-(b.at ?? 0)).slice(-100);
}
