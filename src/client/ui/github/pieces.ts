import { AVATAR_COLORS } from '../../state';
import { h, timeAgo } from '../dom';

// ---- Small pieces ---------------------------------------------------------------------------------

export function avatar(name: string) {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return h('span.gh-avatar', { style: `background:${AVATAR_COLORS[Math.abs(x) % AVATAR_COLORS.length]}`, 'aria-hidden': 'true' }, (name[0] ?? '?').toUpperCase());
}

export function when(iso: string, url?: string) {
  const title = iso ? new Date(iso).toLocaleString() : '';
  return url ? h('a.when', { href: url, target: '_blank', rel: 'noopener noreferrer', title }, timeAgo(iso)) : h('span.when', { title }, timeAgo(iso));
}

export const REVIEW_BADGE: Record<string, [string, string]> = {
  APPROVED: ['✅ approved', 'ok'],
  CHANGES_REQUESTED: ['🛠 requested changes', 'bad'],
  COMMENTED: ['💬 reviewed', ''],
  DISMISSED: ['review dismissed', 'muted'],
};

/** Drops the nulls of optional pieces, for replaceChildren. */
export function nodes(...xs: (Node | string | null | undefined)[]): (Node | string)[] {
  return xs.filter((x): x is Node | string => x != null);
}

export function spinnerRow(text: string) {
  return h('div.gh-loading', {}, h('span.spinner'), text);
}

export function errorBox(text: string, retry?: () => void) {
  return h('div.gh-error', {}, `Couldn't load from GitHub: ${text}`, retry ? h('button.btn', { type: 'button', onclick: retry }, 'Try again') : null);
}

export function stateOf(it: { state: string; isDraft?: boolean }): [string, string] {
  if (it.state === 'MERGED') return ['merged', 'merged'];
  if (it.state === 'CLOSED') return ['closed', 'offline'];
  return it.isDraft ? ['draft', 'idle'] : ['open', 'working'];
}
