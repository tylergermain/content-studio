import type { WorkspaceKind } from './workspace.js';

/** What a review asks of the worker: changes at timestamps, approval (a pick, for images), new variations, or an answer. */
export type ReviewKind = 'notes' | 'approve' | 'variations' | 'question';
/** A note at a time in a video, in seconds. */
export interface ReviewNote { at: number; text: string }
/** A review sent from a workspace, kept on the chat message that carried it so the files can show it (Approved, Notes sent). */
export interface ChatReview { kind: ReviewKind; files: { root?: string; path: string }[]; notes?: ReviewNote[] }
/** The body of POST /api/worker-chat/review. The server writes the prompt itself, with `reviewText` (shared/workspace.ts). */
export interface ReviewRequest extends ChatReview { requestId: string; text?: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; at?: number; review?: ChatReview }
/** A file the chat can preview. No `root` means the worker's own folder; a `root` is the id of a folder an admin shared with the floor. */
export interface ChatArtifact { path: string; name: string; type: string; size: number; modified: number; root?: string }
/** A file the worker linked in its messages. `link` is the link's `normalizeTarget` key (shared/chat-links.ts). */
export interface LinkedFile extends ChatArtifact { link: string }
/** For admins: a linked file outside every folder the office serves, and the folder that would share it. */
export interface OutsideLink { link: string; folder: string; label: string }
/** For admins: a folder shared with the floor, its label written with ~ for the home folder. */
export interface SharedFolder { id: string; label: string }
export interface ChatSnapshot {
  worker: { id: string; name: string; provider?: string; status: string; activity?: string; sessionId?: string };
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
  /** The files the worker linked, newest message first. */
  linked: LinkedFile[];
  /** Admins only. */
  outside?: OutsideLink[];
  /** Admins only. */
  shares?: SharedFolder[];
  /** The interface the worker's role opens with (shared/workspace.ts). */
  workspace: WorkspaceKind;
  /** Whether this viewer may message the worker and send it reviews; when not, the window is read-only and says why. */
  canSend: boolean;
  /** Files beside the ones the worker linked, in the same folders: earlier versions, chapters, notes. */
  nearby: ChatArtifact[];
  source: 'session' | 'waiting';
  liveConfigured: boolean;
  liveAdmin: boolean;
}

/** One file wherever it lives: the same path in the worker's folder and in a share is two files. */
export const artifactKey = (a: { root?: string; path: string }) => `${a.root ?? ''}:${a.path}`;

/** The files a chat can preview, by extension, with the type each one is served as. */
export const PREVIEW_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.pdf':'application/pdf', '.html':'text/html', '.htm':'text/html', '.md':'text/plain', '.txt':'text/plain', '.json':'text/plain', '.csv':'text/plain' });

/** A file's preview type, from its extension in any case. It reads the extension as `path.extname` does, so '.md' has none. */
export function previewType(file: string): string | undefined {
  const name = file.replace(/\/+$/, '').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name === '..') return undefined;
  const ext = name.slice(dot).toLowerCase();
  return Object.hasOwn(PREVIEW_TYPES, ext) ? PREVIEW_TYPES[ext] : undefined;
}

/** Keep the voice bridge's routing instructions out of the visible conversation. */
export function displayChatText(text: string): string {
  if (!text.startsWith('Follow this live voice request in your current session.')) return text;
  const match = /Latest user request: ([\s\S]+?)\s+Respond with the result or progress so the voice assistant can report back\./.exec(text);
  return match?.[1].trim() || text;
}
