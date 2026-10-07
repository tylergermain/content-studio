import { h, timeAgo, clip, STATUS_LABEL } from '../dom';
import type { BranchApp, Deploy, TableBranch, TableCommit, TableIssue, TableInfo, TablePull } from '../../../shared/table-info';
import { github, shotUrl, type Shots } from './api';

// The middle of a project table's panel (panel.ts): its branches as cards, each with a picture of what's running on
// it, and the repository's pull requests, issues and latest commits as rows.

/** Days a branch nobody's on, with no open pull request, still counts as active. */
const ACTIVE_DAYS = 7;

/** A branch worth showing first: the default, one someone's on or something's running on, one with an open PR, or a recent one. */
export function active(b: TableBranch, pulls: TablePull[]): boolean {
  if (b.base || b.agents.length || b.apps.length) return true;
  if (b.pull && pulls.some((p) => p.number === b.pull && p.state === 'OPEN')) return true;
  return Date.now() - b.at < ACTIVE_DAYS * 86_400_000;
}

/** The pictures of the apps, one <img> each that's kept between paints, so a new picture replaces the last without a blank. */
export class Pictures {
  private imgs = new Map<string, HTMLImageElement>();

  constructor(private floor: string, private room: string) {}

  /** The picture of the app `key`, when there is one. */
  of(key: string, shots: Shots | undefined): HTMLImageElement | undefined {
    const shot = shots?.apps[`${this.room}--${key}`];
    if (!shot) return undefined;
    const src = shotUrl(this.floor, this.room, key, shot.at);
    let img = this.imgs.get(key);
    if (!img) this.imgs.set(key, (img = h('img', { alt: '', decoding: 'async', draggable: 'false' }) as HTMLImageElement));
    if (img.getAttribute('src') !== src) img.src = src;
    return img;
  }

  /** A second <img> of the same picture (the cards' and the side's can't be one element). */
  copy(key: string, shots: Shots | undefined, cache: Map<string, HTMLImageElement>): HTMLImageElement | undefined {
    const first = this.of(key, shots);
    if (!first) return undefined;
    let img = cache.get(key);
    if (!img) cache.set(key, (img = h('img', { alt: '', decoding: 'async', draggable: 'false' }) as HTMLImageElement));
    if (img.getAttribute('src') !== first.src) img.src = first.src;
    return img;
  }
}

const ago = (ms: number) => (ms ? timeAgo(ms) : '');

/** ↑ ahead ↓ behind the default branch, when they're known. */
export function drift(b: TableBranch, base: string | undefined): string {
  if (b.ahead === undefined || b.behind === undefined || !base) return '';
  if (!b.ahead && !b.behind) return `even with ${base}`;
  return [b.ahead && `↑${b.ahead}`, b.behind && `↓${b.behind}`].filter(Boolean).join(' ');
}

export const CHECKS: Record<TablePull['checks'], { mark: string; label: string }> = {
  pass: { mark: '✓', label: 'Checks pass' },
  fail: { mark: '✕', label: 'Checks fail' },
  pending: { mark: '●', label: 'Checks running' },
  none: { mark: '', label: 'No checks' },
};

export const REVIEW: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Review required' };

/** A pull request's state as a pill: draft, open, merged or closed. */
export function prState(p: TablePull): HTMLElement {
  const s = p.isDraft && p.state === 'OPEN' ? 'draft' : p.state.toLowerCase();
  return h('span.ti-pr-state', { 'data-state': s }, s === 'draft' ? 'Draft' : s === 'open' ? 'Open' : s === 'merged' ? 'Merged' : 'Closed');
}

/** What an app on a branch is, as its card says it. */
export const KIND: Record<BranchApp['kind'], string> = { live: '● Live', preview: '● Preview', local: '● On this computer' };

/** A branch's newest deploy, when it isn't ready: building, or failed. */
export function deployNote(d: Deploy | undefined): string {
  if (!d || d.state === 'ready') return '';
  return d.state === 'building' ? '⏳ deploying' : d.state === 'error' ? '✕ deploy failed' : 'deploy cancelled';
}

export function branchCard(o: {
  b: TableBranch;
  info: TableInfo;
  picture?: HTMLImageElement;
  /** Its picture's a preview behind Vercel's login. */
  blocked?: boolean;
  selected: boolean;
  onTv: boolean;
  pick(): void;
}): HTMLElement {
  const { b, info } = o;
  const pr = b.pull ? info.pulls.find((p) => p.number === b.pull) : undefined;
  const app = b.apps[0];
  const note = deployNote(b.deploys[0]);
  const shot = h('div.ti-shot', {},
    o.picture ?? h('span.ti-noshot', {}, o.blocked ? 'Behind Vercel’s login' : app ? 'Taking a picture…' : 'Not deployed or running'),
    app ? h('span.ti-live', { 'data-kind': app.kind }, KIND[app.kind]) : '',
    o.onTv ? h('span.ti-ontv', { title: 'What the table’s screen shows' }, '\u{1f4fa}') : '',
    b.apps.length > 1 ? h('span.ti-apps', {}, `${b.apps.length} apps`) : '');
  const card = h('button.ti-card', { type: 'button', 'aria-pressed': String(o.selected), 'data-branch': b.name, title: b.name },
    shot,
    h('div.ti-card-body', {},
      h('div.ti-card-name', {}, h('span.ti-branch-icon', { 'aria-hidden': 'true' }, '⎇'), h('strong', {}, b.detached ? `${b.name} (no branch)` : b.name), b.base ? h('span.ti-tag', {}, 'default') : '', pr ? h('span.ti-tag.pr', { 'data-state': pr.state.toLowerCase() }, `#${pr.number}`) : ''),
      h('div.ti-card-sub', {}, clip(b.subject || '—', 90)),
      h('div.ti-card-meta', {}, ...[ago(b.at), drift(b, info.base), b.dirty ? `✎ ${b.dirty} uncommitted` : '', note ? h('span.ti-deploy', { 'data-state': b.deploys[0]?.state }, note) : '', pr && pr.checks !== 'none' ? h('span.ti-checks', { 'data-checks': pr.checks }, `${CHECKS[pr.checks].mark} checks`) : ''].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))),
      b.agents.length ? h('div.ti-card-agents', {}, ...b.agents.slice(0, 3).map((a) => h('span.ti-agent', { 'data-status': a.status }, h('span.ti-dot'), a.name, h('span.ti-agent-status', {}, STATUS_LABEL[a.status] ?? a.status))), b.agents.length > 3 ? h('span.ti-more', {}, `+${b.agents.length - 3}`) : '') : ''));
  card.addEventListener('click', o.pick);
  return card;
}

export function pullRow(p: TablePull, onBranch: (name: string) => void, known: boolean): HTMLElement {
  const branch = h('button.link-button.ti-mono', { type: 'button', disabled: !known, title: known ? 'Show this branch' : 'Not a branch here' }, p.headRefName);
  branch.addEventListener('click', () => onBranch(p.headRefName));
  return h('div.ti-row', {},
    prState(p),
    h('div.ti-row-main', {},
      h('a.ti-row-title', { href: p.url, target: '_blank', rel: 'noopener' }, `#${p.number} ${p.title}`),
      h('div.ti-row-meta', {}, branch, ` → ${p.baseRefName} · ${p.author} · ${timeAgo(p.updatedAt)} · `, h('span.ti-plus', {}, `+${p.additions}`), ' ', h('span.ti-minus', {}, `−${p.deletions}`))),
    h('div.ti-row-side', {},
      p.checks !== 'none' ? h('span.ti-checks', { 'data-checks': p.checks, title: CHECKS[p.checks].label }, `${CHECKS[p.checks].mark} ${CHECKS[p.checks].label.replace('Checks ', '')}`) : '',
      REVIEW[p.reviewDecision] ? h('span.ti-review', { 'data-review': p.reviewDecision }, REVIEW[p.reviewDecision]) : ''));
}

export function issueRow(i: TableIssue): HTMLElement {
  return h('div.ti-row', {},
    h('span.ti-issue-dot', { 'aria-hidden': 'true' }),
    h('div.ti-row-main', {},
      h('a.ti-row-title', { href: i.url, target: '_blank', rel: 'noopener' }, `#${i.number} ${i.title}`),
      h('div.ti-row-meta', {}, `${i.author} · ${timeAgo(i.updatedAt)}${i.comments ? ` · ${i.comments} comment${i.comments === 1 ? '' : 's'}` : ''}`)),
    h('div.ti-row-side', {}, ...i.labels.slice(0, 3).map((l) => h('span.ti-label', { style: `--label:${/^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#888888'}` }, l.name))));
}

export function commitRow(c: TableCommit, repo: string | undefined): HTMLElement {
  const sha = c.sha.slice(0, 7);
  return h('div.ti-commit', {},
    repo ? h('a.ti-sha', { href: github.commit(repo, c.sha), target: '_blank', rel: 'noopener' }, sha) : h('span.ti-sha', {}, sha),
    h('span.ti-commit-subject', { title: c.subject }, c.subject),
    h('span.ti-commit-meta', {}, `${c.author} · ${timeAgo(c.at)}`));
}

/** A deploy: what it is, where it stands, when, and its links. */
export function deployRow(d: Deploy): HTMLElement {
  const state = d.state === 'ready' ? 'Ready' : d.state === 'building' ? 'Deploying…' : d.state === 'error' ? 'Failed' : 'Cancelled';
  const host = (() => {
    try {
      return new URL(d.url).host;
    } catch {
      return d.url;
    }
  })();
  return h('div.ti-row.ti-deploy-row', {},
    h('span.ti-pr-state', { 'data-state': d.state === 'ready' ? 'open' : d.state === 'error' ? 'closed' : 'draft' }, state),
    h('div.ti-row-main', {},
      h('a.ti-row-title', { href: d.url, target: '_blank', rel: 'noopener' }, d.env === 'production' ? `Live · ${host}` : `${d.branch ?? 'Preview'} · ${host}`),
      h('div.ti-row-meta', {}, [d.from === 'vercel' ? 'Vercel' : 'GitHub deployment', d.sha ? d.sha.slice(0, 7) : '', d.at ? timeAgo(d.at) : ''].filter(Boolean).join(' · '))),
    h('div.ti-row-side', {}, d.inspect ? h('a.rr-ghost.ti-link', { href: d.inspect, target: '_blank', rel: 'noopener' }, 'Details ↗') : ''));
}
