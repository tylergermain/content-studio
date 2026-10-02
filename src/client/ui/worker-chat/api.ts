import { store } from '../../state';
export function chatUrl(worker: string, suffix = '', file?: string): string {
  const q = new URLSearchParams({floor:store.floor ?? '',worker});if(file)q.set('path',file);
  return `/api/worker-chat${suffix}?${q}`;
}
export async function chatRequest<T>(worker: string, suffix = '', body?: unknown): Promise<T> {
  const response=await fetch(chatUrl(worker,suffix),{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'The worker could not be reached');return result as T;
}
