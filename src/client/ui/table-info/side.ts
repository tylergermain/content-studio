import { h, timeAgo, STATUS_LABEL, toast } from '../dom';
import { serviceUrl } from '../services';
import { store } from '../../state';
import type { BranchApp, BranchDetail, ChangedPath, TableBranch, TableInfo } from '../../../shared/table-info';
import { github } from './api';
import { CHECKS, KIND, REVIEW, commitRow, deployRow, drift, prState } from './cards';

// The right of a project table's panel (panel.ts): the branch picked, close up. What's on it (its live site or its
// preview, and what runs on the office's computer, to review or to open in a tab of its own), or how to get it
// running; its deploys; who's on it; its pull request; its commits, the files they change, and what's changed and
// not committed yet.

export interface SideDeps {
  openWorker(id: string): void;
  /** Opens the table's Software review on `target` (port:<n> or url:<address>). */
  review(target?: string): void;
  /** Hires an agent at the table to run the branch. */
  run(b: TableBranch): void;
  /** Branches somebody's being hired to run now. */
  running: ReadonlySet<string>;
  /** Why this person can't hire here, if they can't. */
  cantHire(): string | undefined;
  /** The picture of the app `key`, for the side, and whether it's a preview behind Vercel's login. */
  picture(key: string): HTMLImageElement | undefined;
  blocked(key: string): boolean;
}

const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?(?:\/.*)?$/i;

/** Where the app is reviewed from (the review room's target) and opened in a tab, when it can be from here. */
function reach(app: BranchApp): { target?: string; open?: string } {
  if (app.port) return { target: `port:${app.port}`, open: serviceUrl(app.port) };
  if (!app.url) return {};
  const local = LOCAL.exec(app.url);
  if (!local) return { target: `url:${app.url}`, open: app.url };
  const port = Number(local[1] || 80);
  return store.services.items.some((s) => s.port === port) ? { target: `port:${port}`, open: serviceUrl(port) } : {};
}

const section = (title: string, ...children: (Node | string)[]) => h('section.ti-side-section', {}, h('h4', {}, title), ...children);

function files(list: ChangedPath[], more?: number): HTMLElement {
  return h('div.ti-files', {},
    ...list.map((f) => h('div.ti-file', { title: f.path },
      h('span.ti-file-status', { 'data-status': f.status }, f.status === '?' ? 'new' : f.status),
      h('span.ti-file-path', {}, f.path),
      f.added || f.removed ? h('span.ti-file-count', {}, h('span.ti-plus', {}, `+${f.added}`), ' ', h('span.ti-minus', {}, `−${f.removed}`)) : '')),
    more ? h('p.rm-muted', {}, `and ${more} more`) : '');
}

export function sideHead(b: TableBranch, info: TableInfo): HTMLElement {
  const repo = info.room.repo;
  const copy = h('button.rr-btn.ti-copy', { type: 'button', title: 'Copy the branch’s name', 'aria-label': 'Copy the branch’s name' }, '⧉');
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(b.name).then(() => toast(`⎇ Copied ${b.name}`), () => toast('Couldn’t copy it here', 'warn'));
  });
  const where = [
    b.base ? `The default branch${b.remote ? ', as GitHub has it' : ''}` : (() => {
      if (b.ahead === undefined || b.behind === undefined) return '';
      return `${b.ahead} commit${b.ahead === 1 ? '' : 's'} ahead of ${info.base}, ${b.behind} behind`;
    })(),
    b.detached ? 'a worktree not on any branch' : b.remote ? (b.local ? 'here and on GitHub' : 'only on GitHub') : 'only on the office’s computer, not pushed',
    b.at ? `last commit ${timeAgo(b.at)}${b.author ? ` by ${b.author}` : ''}` : '',
  ].filter(Boolean);
  const links = repo && !b.detached ? h('div.ti-links', {},
    b.remote ? h('a.rr-ghost.ti-link', { href: github.branch(repo, b.name), target: '_blank', rel: 'noopener' }, 'On GitHub ↗') : '',
    !b.base && info.base && b.remote ? h('a.rr-ghost.ti-link', { href: github.compare(repo, info.base, b.name), target: '_blank', rel: 'noopener' }, `Compare with ${info.base} ↗`) : '') : '';
  return h('div.ti-side-head', {},
    h('label.rm-label', {}, b.base ? 'Default branch' : 'Branch'),
    h('div.ti-side-name', {}, h('span.ti-branch-icon', { 'aria-hidden': 'true' }, '⎇'), h('strong', {}, b.name), copy),
    h('p.ti-side-where', {}, where.join(' · ')),
    links);
}

export function sideBody(b: TableBranch, detail: BranchDetail | string | undefined, info: TableInfo, d: SideDeps): HTMLElement {
  const out: HTMLElement[] = [];
  const pr = b.pull ? info.pulls.find((p) => p.number === b.pull) : undefined;

  // ---- What's on it: deployed (the live site, its preview), then what runs on the office's computer ----
  if (b.apps.length) {
    out.push(section(b.apps.length === 1 ? 'What’s on it' : `What’s on it · ${b.apps.length}`, ...b.apps.map((app) => {
      const deployed = app.kind !== 'local';
      // A deployed site opens where it is; what runs here is reviewed through the office, with comments.
      const { target, open } = deployed ? { target: undefined, open: app.url } : reach(app);
      const review = deployed ? '' : h('button.rr-send.ti-review-btn', { type: 'button', disabled: !target, title: target ? 'Review it full screen: use it at any size and comment on it' : 'Only apps the office can reach are reviewed here' }, '\u{1f9ea} Review');
      if (review) review.addEventListener('click', () => target && d.review(target));
      const picture = d.picture(app.key);
      const blocked = d.blocked(app.key);
      const shot = deployed && open
        ? h('a.ti-big-shot', { href: open, target: '_blank', rel: 'noopener', title: `Open ${app.label.toLowerCase()} in a tab of its own` }, picture ?? h('span.ti-noshot', {}, blocked ? 'Behind Vercel’s login' : 'Taking a picture…'))
        : h('button.ti-big-shot', { type: 'button', disabled: !target, title: target ? 'Review it' : app.label }, picture ?? h('span.ti-noshot', {}, 'Taking a picture…'));
      if (!deployed) shot.addEventListener('click', () => target && d.review(target));
      return h('div.ti-app', {},
        shot,
        h('div.ti-app-row', {},
          h('span.ti-app-label', {}, h('span.ti-kind', { 'data-kind': app.kind }, KIND[app.kind]), ' ', app.kind === 'local' ? app.label : '', app.url ? h('span.ti-mono', {}, ` ${app.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`) : ''),
          open ? h('a.rr-ghost.ti-link', { href: open, target: '_blank', rel: 'noopener', title: 'Open it in a tab of its own' }, 'Open ↗') : '',
          review),
        blocked ? h('p.ti-problem', {}, 'This preview is behind Vercel’s login, so the office sees the sign-in page. In the project on Vercel, Settings › Deployment Protection, turn on Protection Bypass for Automation, and the office gets past it.') : '');
    })));
  } else if (b.agents.length) {
    const ask = h('button.rr-ghost', { type: 'button' }, `Open ${b.agents[0].name}’s chat`);
    ask.addEventListener('click', () => d.openWorker(b.agents[0].id));
    out.push(section('Running now', h('p.rm-muted', {}, `Nothing’s running on it yet. Ask ${b.agents[0].name} to run the app, and it shows here as soon as it answers.`), ask));
  } else if (!b.detached) {
    const why = d.cantHire() ?? (info.room.free ? undefined : `Every chair at ${info.room.name} is taken: send someone home first`);
    const going = d.running.has(b.name);
    const run = h('button.rr-send', { type: 'button', disabled: !!why || going, title: why ?? '' }, going ? 'Hiring…' : b.base ? '▶ Start the app' : '▶ Run it here');
    run.addEventListener('click', () => d.run(b));
    out.push(section('Running now', h('p.rm-muted', {}, b.base ? `Nothing’s running on ${b.name}. A new agent at the table can get the app going in a worktree of its own.` : 'Nothing’s running on it. A new agent at the table can check it out in a worktree of its own and run the app, to see and review it.'), run));
  }

  // ---- Its deploys ----
  if (b.deploys.length) out.push(section(b.base ? 'Live site' : 'Deployed', ...b.deploys.map(deployRow)));

  // ---- Who's on it ----
  if (b.agents.length) {
    out.push(section(b.agents.length === 1 ? 'Working on it' : `Working on it · ${b.agents.length}`, h('div.rm-agents', {}, ...b.agents.map((a) => {
      const row = h('button.rm-agent.ti-agent-row', { type: 'button', 'data-status': a.status, title: `Open ${a.name}’s chat` }, h('span.rm-dot'), h('strong', {}, a.name), a.task ? h('span.ti-agent-task', {}, a.task) : '', h('span', {}, STATUS_LABEL[a.status] ?? a.status));
      row.addEventListener('click', () => d.openWorker(a.id));
      return row;
    }))));
  }

  // ---- Its pull request ----
  if (pr) {
    out.push(section('Pull request', h('a.ti-pr', { href: pr.url, target: '_blank', rel: 'noopener' },
      h('div.ti-pr-top', {}, prState(pr), h('strong', {}, `#${pr.number} ${pr.title}`)),
      h('div.ti-pr-meta', {},
        pr.checks !== 'none' ? h('span.ti-checks', { 'data-checks': pr.checks }, `${CHECKS[pr.checks].mark} ${CHECKS[pr.checks].label}`) : h('span', {}, 'No checks'),
        REVIEW[pr.reviewDecision] ? h('span.ti-review', { 'data-review': pr.reviewDecision }, REVIEW[pr.reviewDecision]) : '',
        h('span', {}, h('span.ti-plus', {}, `+${pr.additions}`), ' ', h('span.ti-minus', {}, `−${pr.deletions}`)),
        h('span', {}, `${pr.author} · ${timeAgo(pr.updatedAt)}`)),
      h('span.ti-pr-open', {}, 'On GitHub ↗'))));
  } else if (!b.base && !b.detached) {
    out.push(section('Pull request', h('p.rm-muted', {}, b.remote ? 'None yet.' : 'None yet: it isn’t on GitHub.')));
  }

  // ---- Its commits, and the files they change ----
  if (b.base) {
    if (info.commits.length) out.push(section(`Latest on ${b.name}`, h('div.ti-commits', {}, ...info.commits.map((c) => commitRow(c, info.room.repo)))));
  } else if (typeof detail === 'string') out.push(section('Commits', h('p.rm-muted', {}, detail)));
  else if (!detail) out.push(section('Commits', h('p.rm-muted', {}, 'Reading the branch…')));
  else {
    out.push(section(detail.commits.length ? `Commits not on ${info.base ?? 'the default branch'} · ${detail.commits.length + (detail.moreCommits ?? 0)}` : 'Commits',
      detail.commits.length ? h('div.ti-commits', {}, ...detail.commits.map((c) => commitRow(c, info.room.repo))) : h('p.rm-muted', {}, `Nothing ${info.base ?? 'the default branch'} doesn’t have.`),
      detail.moreCommits ? h('p.rm-muted', {}, `and ${detail.moreCommits} older`) : ''));
    if (detail.files.length) out.push(section(`Files changed · ${detail.files.length + (detail.moreFiles ?? 0)}`, files(detail.files, detail.moreFiles)));
  }
  if (detail && typeof detail !== 'string' && detail.uncommitted.length) out.push(section(`Not committed yet · ${detail.uncommitted.length}`, files(detail.uncommitted)));
  return h('div.ti-side-body', {}, ...out);
}
