import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ChatSnapshot } from '../../shared/worker-chat.js';

export function liveKey(dataDir: string): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try { const saved = JSON.parse(readFileSync(path.join(dataDir,'gpt-live.json'),'utf8')); return typeof saved.key === 'string' ? saved.key : undefined; } catch { return; }
}
export function saveLiveKey(dataDir: string, key: unknown): boolean {
  if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{12,300}$/.test(key)) return false;
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  writeFileSync(path.join(dataDir,'gpt-live.json'),JSON.stringify({key}),{mode:0o600}); return true;
}
export function liveInstructions(snapshot: ChatSnapshot): string {
  return `You are the live voice of ${snapshot.worker.name}, a ${snapshot.worker.provider} worker in Content Studio. Speak naturally and concisely. Never use em dashes. Delegate task instructions, changes, questions about the project, and requests to stop work to the client backend, which controls this exact worker session. Use the provided session updates as verified context. Do not invent file changes or claim completion before a worker result confirms it. Ask for clarification if a voice transcript is ambiguous. The user can interrupt you while backend work continues. Current worker status: ${snapshot.worker.status}.`;
}
export async function createLiveSession(key: string, sdp: string, snapshot: ChatSnapshot, request = fetch): Promise<{ status: number; body: unknown }> {
  const response = await request('https://api.openai.com/v1/live/sessions', { method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}, body:JSON.stringify({ session:{model:'gpt-live-1',instructions:liveInstructions(snapshot),delegation:{type:'client'}},transport:{type:'webrtc',sdp} }), signal:AbortSignal.timeout(25000) });
  if (!response.ok) return { status:response.status, body:{error:response.status === 401 ? 'The OpenAI API key was rejected. Update it in Live voice setup.' : response.status === 403 || response.status === 404 ? 'This OpenAI project does not have access to GPT-Live 1.' : 'GPT-Live could not start. Check your OpenAI project access and billing.'} };
  return {status:201,body:await response.json()};
}
