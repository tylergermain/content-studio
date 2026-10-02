import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Saved { clientId: string; redirect: string; access?: string; refresh?: string; expires?: number }
const pending = new Map<string, { dir: string; verifier: string; at: number }>();
export function load(dir: string): Saved {
  try { return JSON.parse(readFileSync(path.join(dir, 'spotify.json'), 'utf8')); } catch { return { clientId: '', redirect: '' }; }
}
function save(dir: string, data: Saved) {
  const file = path.join(dir, 'spotify.json');
  writeFileSync(file, JSON.stringify(data), { mode: 0o600 }); chmodSync(file, 0o600);
}
export function configure(dir: string, clientId: string, redirect: string) {
  if (!/^[a-f0-9]{32}$/.test(clientId)) throw new Error('Enter the Spotify app Client ID');
  const u = new URL(redirect);
  if (u.pathname !== '/api/spotify/callback' || u.search || u.hash || u.username || u.password || !(u.protocol === 'https:' || u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('Use an HTTPS callback or a 127.0.0.1 loopback callback');
  const old = load(dir); save(dir, old.clientId === clientId && old.redirect === redirect ? old : { clientId, redirect });
}
export function disconnect(dir: string) { const { clientId, redirect } = load(dir); save(dir, { clientId, redirect }); }
export function authorize(dir: string) {
  const s = load(dir); if (!s.clientId) throw new Error('Configure the Spotify app first');
  for (const [id, value] of pending) if (Date.now() - value.at > 600000) pending.delete(id);
  if (pending.size > 100) throw new Error('Too many connection attempts, try again later');
  const state = randomBytes(32).toString('hex'); const verifier = randomBytes(48).toString('base64url');
  pending.set(state, { dir, verifier, at: Date.now() });
  const query = new URLSearchParams({ client_id: s.clientId, response_type: 'code', redirect_uri: s.redirect, state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), scope: 'user-read-playback-state user-modify-playback-state user-read-private' });
  return `https://accounts.spotify.com/authorize?${query}`;
}
async function token(dir: string, params: Record<string, string>) {
  const old = load(dir);
  const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: old.clientId, ...params }), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Spotify authorization expired or was refused. Reconnect your account.');
  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Spotify returned an invalid authorization');
  const next = { ...old, access: data.access_token, refresh: data.refresh_token ?? old.refresh, expires: Date.now() + data.expires_in * 1000 }; save(dir, next); return next.access;
}
export async function callback(dir: string, state: string, code: string) {
  const p = pending.get(state); pending.delete(state);
  if (!p || p.dir !== dir || Date.now() - p.at > 600000 || !code || code.length > 2048) throw new Error('This Spotify connection link expired. Start again from the jukebox.');
  return token(dir, { grant_type: 'authorization_code', code, redirect_uri: load(dir).redirect, code_verifier: p.verifier });
}
const refreshing = new Map<string, Promise<string>>();
async function access(dir: string) {
  const s = load(dir); if (s.access && (s.expires ?? 0) > Date.now() + 30000) return s.access;
  if (!s.refresh) throw new Error('Connect Spotify first');
  let p = refreshing.get(dir); if (!p) { p = token(dir, { grant_type: 'refresh_token', refresh_token: s.refresh }); refreshing.set(dir, p); p.finally(() => refreshing.delete(dir)).catch(() => {}); }
  return p;
}
export async function api(dir: string, endpoint: string, method = 'GET', body?: unknown): Promise<any> {
  const bearer = await access(dir);
  const res = await fetch(`https://api.spotify.com/v1/${endpoint}`, { method, headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  if (res.status === 401) { const s = load(dir); save(dir, { ...s, expires: 0 }); throw new Error('Spotify session expired. Try again to refresh it.'); }
  if (res.status === 403) throw new Error('Spotify refused playback. Check Premium and the app’s allowed users.');
  if (res.status === 404) throw new Error('Open Spotify on your playback device, then refresh devices.');
  if (res.status === 429) throw new Error('Spotify is limiting requests. Wait a moment and try again.');
  if (!res.ok) throw new Error('Spotify could not complete that request');
  return res.status === 204 ? null : res.json();
}
