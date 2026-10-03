import { store } from '../../state';
import type { ReviewRequest, SharedFolder } from '../../../shared/worker-chat';
/** A worker's chat endpoint. `root` names a shared folder (its id) for a file outside the worker's own folder. */
export function chatUrl(worker: string, suffix = '', file?: string, root?: string): string {
  const q = new URLSearchParams({floor:store.floor ?? '',worker});if(root)q.set('root',root);if(file)q.set('path',file);
  return `/api/worker-chat${suffix}?${q}`;
}
async function request<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const result=await response.json().catch(()=>undefined);if(!response.ok||!result)throw new Error(result?.error??fallback);return result as T;
}
export function chatRequest<T>(worker: string, suffix = '', body?: unknown): Promise<T> {
  return request<T>(chatUrl(worker,suffix),body,'The worker could not be reached');
}
const sharesUrl = (suffix: string) => `/api/shares${suffix}?${new URLSearchParams({floor:store.floor ?? ''})}`;
/** An admin shares a folder outside the floor with it, so files its workers link there open in the office. */
export function shareRequest(dir: string): Promise<{ share: SharedFolder }> {
  return request(sharesUrl(''),{dir},'The folder could not be shared');
}
/** An admin stops sharing a folder with the floor. */
export async function unshareRequest(id: string): Promise<void> {
  await request(sharesUrl('/remove'),{id},'The folder could not be unshared');
}
/** Sends a review of the worker's files (notes at timestamps, an approval, variations or a question); the office writes the prompt. */
export function reviewRequest(worker: string, review: ReviewRequest): Promise<{ ok: true; duplicate?: true }> {
  return request(chatUrl(worker,'/review'),review,'The review could not be sent');
}
