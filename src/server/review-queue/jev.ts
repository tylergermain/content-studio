import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REVIEW_APPS } from '../../shared/review-queue.js';
import type { WorkspaceTab } from '../../shared/workspace.js';

// Jev, TypeSafe AI's decision model (https://docs.typesafe.ai), picks which app a finished task is shown in: one
// choice question over the apps the floor has on, asked with the task, what the worker said and the files it made.
// The office's TypeSafe key is TYPESAFE_API_KEY, or `apiKey` in <office data>/typesafe.json; it never leaves the server.

const API = process.env.TYPESAFE_BASE_URL?.replace(/\/+$/, '') || 'https://api.typesafe.ai';
const MODEL = process.env.AGENT_OFFICE_JEV_MODEL || 'jev-latest';
const TIMEOUT_MS = 8000;

/** The office's TypeSafe key, when it has one. */
export function typesafeKey(dataDir: string): string | undefined {
  const env = process.env.TYPESAFE_API_KEY?.trim();
  if (env) return env;
  const file = path.join(dataDir, 'typesafe.json');
  if (!existsSync(file)) return undefined;
  try {
    const key = (JSON.parse(readFileSync(file, 'utf8')) as { apiKey?: unknown }).apiKey;
    return typeof key === 'string' && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

export interface JevAsk {
  task: string;
  said?: string;
  files: { path: string; type: string }[];
  /** The worker is running a web server (Software review has something to show). */
  serving: boolean;
}

/** Jev's pick of `apps` for a finished task, or undefined when it can't be asked or doesn't answer. */
export async function jevPick(key: string, ask: JevAsk, apps: readonly WorkspaceTab[], fetcher: typeof fetch = fetch): Promise<{ app: WorkspaceTab; confidence: number } | undefined> {
  const criteria = Object.fromEntries(apps.map((a) => [a, REVIEW_APPS[a]]));
  const body = {
    model: MODEL,
    state: {
      task: ask.task.slice(0, 2000),
      final_message: (ask.said ?? '').slice(0, 3000),
      files: ask.files.slice(0, 20).map((f) => `${f.path} (${f.type || 'unknown type'})`),
      running_web_server: ask.serving,
    },
    questions: {
      app: { type: 'choice', instructions: 'An AI worker finished this task. Which review app should show its work to the person reviewing it?', criteria },
    },
  };
  try {
    const res = await fetcher(`${API}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const out = (await res.json()) as { answers?: { app?: { choice?: string; confidence?: number } } };
    const choice = out.answers?.app?.choice as WorkspaceTab | undefined;
    return choice && apps.includes(choice) ? { app: choice, confidence: Number(out.answers?.app?.confidence) || 0 } : undefined;
  } catch {
    return undefined;
  }
}
