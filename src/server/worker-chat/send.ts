import path from 'node:path';
import { displayChatText, type ChatReview } from '../../shared/worker-chat.js';
import { isAsleep } from '../../shared/status.js';
import { chatHistory, keepMessage } from './history.js';
import type { Floor } from '../floor.js';

// Sending into a worker's session from its chat window: a message typed there, or a review (notes on a
// cut, an approval, a request for variations, a question) composed from the workspace.

export type Sent = { status: 200; body: { ok: true; duplicate?: true } } | { status: 400 | 409; body: { error: string } };

/** What a chat may send: up to 20,000 characters, with no control characters but tab and newline. */
export const sendable = (text: string) => !!text.trim() && text.length <= 20000 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(text);

/**
 * Sends `text` to agent `id` as `by`, once per `requestId`: an asleep worker is woken with it, a
 * running one gets it typed in. It's kept in the chat's history, with `review` when it's one, so the
 * window can show what was sent even before the provider's transcript has it.
 */
export function sendToWorker(floor: Floor, id: string, text: string, requestId: string, by: string, review?: ChatReview): Sent {
  if (!sendable(text)) return { status: 400, body: { error: 'Enter a message of up to 20,000 characters' } };
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) return { status: 400, body: { error: 'Invalid message id' } };
  const dir = path.join(floor.dir, '.agent-office');
  if (chatHistory(dir, id).some(m => m.id === requestId)) return { status: 200, body: { ok: true, duplicate: true } };
  const w = floor.workers.get(id);
  if (w?.kind !== 'agent') return { status: 400, body: { error: 'Choose an agent worker' } };
  const clean = text.trim();
  const error = isAsleep(w.status) ? floor.workers.resume(id, clean) : floor.workers.prompt(id, clean, by);
  if (error) return { status: 409, body: { error } };
  keepMessage(dir, id, { id: requestId, role: 'user', text: displayChatText(clean), at: Date.now(), ...(review ? { review } : {}) });
  return { status: 200, body: { ok: true } };
}
