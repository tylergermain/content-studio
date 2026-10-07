import './panel.css';
import { h, toast } from '../dom';
import { openRoomShell } from '../workspace/room-shell';
import { openTableReview } from '../workspace/review/table';
import { store } from '../../state';
import { mayWork, readOnlyText } from '../../../shared/floor-access';
import type { BranchDetail, TableBranch, TableInfo } from '../../../shared/table-info';
import { connectVercel, github, loadBranch, loadInfo, loadShots, pickVercelProject, runBranch, type Shots } from './api';
import { Pictures, active, branchCard, commitRow, deployRow, issueRow, pullRow } from './cards';
import { sideBody, sideHead, type SideDeps } from './side';

// A project table's panel: what E at a table's screen in the Software Factory opens (and the Rooms panel's Branches),
// full screen in the review rooms' frame. Down the middle, the table's branches, each a card with a picture of what's
// running on it (server/room-screens.ts) and who's on it, then its repository's pull requests, issues and latest
// commits; down the right, the branch picked, close up (side.ts). It asks the office again every few seconds while
// it's open (server/table-info.ts), so agents starting and finishing, apps coming up and checks passing show as they go.

export interface TablePanelDeps {
  /** Hires at the chair `seat`: the hire dialog, for a new task at the table. */
  hireAt(seat: string): void;
  openWorker(id: string): void;
}

const POLL_MS = 5000;
/** How often the branch picked is read again while nothing about it changes. */
const DETAIL_MS = 20_000;

export function openTablePanel(room: { id: string; name: string }, d: TablePanelDeps): { close(): void } {
  const floor = store.floor ?? '';
  let info: TableInfo | undefined;
  let shots: Shots | undefined;
  let error = '';
  let selected: string | undefined;
  let showAll = false;
  let closed = false;
  let ticking = false;
  let stamp = '';
  let sideStamp = '';
  let timer = 0;
  const details = new Map<string, { at: number; key: string; detail: BranchDetail | string }>();
  const reading = new Set<string>();
  const running = new Set<string>();
  const pictures = new Pictures(floor, room.id);
  const sidePictures = new Map<string, HTMLImageElement>();

  const shell = openRoomShell({
    className: 'table-room',
    label: room.name,
    doing: `looking over ${room.name}`,
    key: onKey,
    onClose: () => {
      closed = true;
      window.clearInterval(timer);
    },
  });
  shell.name.textContent = room.name;
  shell.sub.textContent = 'Reading the table…';
  const repoLink = h('a.rr-ghost.ti-link', { target: '_blank', rel: 'noopener', hidden: true }, 'Repository on GitHub ↗');
  const liveLink = h('a.rr-ghost.ti-link.ti-live-link', { target: '_blank', rel: 'noopener', hidden: true, title: 'The live site, in a tab of its own' }, '● Live site ↗');
  shell.right.append(liveLink, repoLink);
  // The Vercel sign-in up top stays put while the rest repaints, so a token half typed in isn't lost.
  const top = h('div.ti-top');
  const body = h('div.ti-body');
  const stage = h('div.ti-stage', {}, top, body);
  shell.stage.classList.add('ti-stage-wrap');
  shell.stage.append(stage);
  let vercelStamp = '';
  const side = h('aside.rr-side.ti-side', { 'aria-label': 'The branch picked' });
  shell.side(side);
  const status = h('p.rr-status.rm-status', { 'aria-live': 'polite' });
  const task = h('button.rr-send', { type: 'button' }, '+ New task at this table');
  const reviewBtn = h('button.rr-ghost', { type: 'button', title: 'Review the app full screen and comment on it (R): a new agent here does what you send' }, '\u{1f9ea} Review the app');
  const foot = h('div.rm-side-foot', {}, h('div.rm-row', {}, task, reviewBtn), status);
  task.addEventListener('click', () => info?.room.free && d.hireAt(info.room.free));
  reviewBtn.addEventListener('click', () => review());

  const floorName = () => store.currentFloor()?.name ?? 'this floor';
  const cantHire = () => (mayWork(store.me, floor) ? undefined : readOnlyText(floorName()));
  const current = () => info?.branches.find((b) => b.name === selected);
  const visible = () => (info ? (showAll ? info.branches : info.branches.filter((b) => active(b, info!.pulls))) : []);
  /** The address the table's screen is showing now. */
  const onTv = () => shots?.rooms[room.id]?.of;
  const showsOnTv = (b: TableBranch, tv = onTv()) => !!tv && b.apps.some((a) => (a.port ? tv === `http://127.0.0.1:${a.port}/` : tv === a.url));

  /** The review room on `target`, else on what the branch picked runs on this computer, else on the first thing the table has. */
  function review(target?: string) {
    const app = current()?.apps.find((a) => a.kind === 'local');
    openTableReview(room, target ?? (app?.port ? `port:${app.port}` : app?.url ? `url:${app.url}` : undefined));
  }

  /** Whether the picture of the app `key` is a preview behind Vercel's login. */
  const blocked = (key: string | undefined) => !!key && !!shots?.apps[`${room.id}--${key}`]?.blocked;

  /** Up top, for an admin: the office's Vercel sign-in (to show the live site and previews), and the project the table's deploys come from. */
  function paintVercel() {
    const v = info?.vercel;
    const stamp = JSON.stringify([v, store.me.admin, !!info?.room.repo]);
    if (stamp === vercelStamp) return;
    vercelStamp = stamp;
    if (!info || !v || !store.me.admin) return void top.replaceChildren();
    const note = h('span.ti-connect-note', { 'aria-live': 'polite' });
    if (!v.connected) {
      const token = h('input.rr-address', { type: 'password', placeholder: 'Vercel token', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Vercel token' }) as HTMLInputElement;
      const go = h('button.rr-send.ti-review-btn', { type: 'button' }, 'Connect');
      const connect = async () => {
        if (!token.value.trim()) return;
        go.disabled = true;
        note.textContent = 'Checking it with Vercel…';
        try {
          const who = await connectVercel(floor, room.id, token.value);
          token.value = '';
          note.textContent = `Signed in to Vercel as ${who ?? 'you'}.`;
          vercelStamp = '';
          void tick();
        } catch (e) {
          note.textContent = (e as Error).message;
        } finally {
          go.disabled = false;
        }
      };
      go.addEventListener('click', () => void connect());
      token.addEventListener('keydown', (e) => e.key === 'Enter' && void connect());
      top.replaceChildren(h('div.ti-connect', {},
        h('strong', {}, '▲ Show the live site and Vercel’s previews'),
        h('p', {}, 'The screen and this panel show what’s deployed, a preview for each branch, rather than what runs on the office’s computer. Make a token at vercel.com/account/tokens and paste it here: the office keeps it on its own computer and only ever sends it to Vercel.'),
        h('div.ti-connect-row', {}, token, go, note)));
      return;
    }
    const pick = h('select.rr-pick', { 'aria-label': 'Vercel project' },
      h('option', { value: '' }, 'Found by its repository'),
      ...(v.projects ?? []).map((n) => h('option', { value: n, selected: n === v.project }, n))) as HTMLSelectElement;
    if (!v.projects?.includes(v.project ?? '')) pick.value = '';
    pick.addEventListener('change', () => {
      note.textContent = 'Saving…';
      pickVercelProject(floor, room.id, pick.value).then(() => {
        note.textContent = pick.value ? `Deploys from ${pick.value}.` : 'Deploys from the project for its repository.';
        vercelStamp = '';
        void tick();
      }, (e: Error) => (note.textContent = e.message));
    });
    const out = h('button.link-button', { type: 'button' }, 'Sign out');
    out.addEventListener('click', () => {
      void connectVercel(floor, room.id, '').then(() => {
        vercelStamp = '';
        void tick();
      });
    });
    top.replaceChildren(h('div.ti-vercel', {}, h('span', {}, `▲ Vercel · ${v.user ?? 'signed in'} · project `), pick, h('span', {}, ' · '), out, note));
  }

  const sideDeps: SideDeps = {
    openWorker: (id) => d.openWorker(id),
    review: (target) => review(target),
    run: (b) => void run(b),
    running,
    cantHire,
    picture: (key) => pictures.copy(key, shots, sidePictures),
    blocked: (key) => blocked(key),
  };

  async function run(b: TableBranch) {
    running.add(b.name);
    paint();
    try {
      const name = await runBranch(floor, room.id, b.name);
      status.textContent = `${name} is getting ${b.name} running. It shows here as soon as it answers.`;
      toast(`\u{1f9d1}‍\u{1f4bb} ${name} is getting ${b.name} running at ${room.name}`);
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      running.delete(b.name);
      void tick();
    }
  }

  async function readDetail(b: TableBranch) {
    const key = `${b.sha}:${b.dirty ?? 0}`;
    const had = details.get(b.name);
    if (b.base || reading.has(b.name) || (had && had.key === key && Date.now() - had.at < DETAIL_MS)) return;
    reading.add(b.name);
    try {
      details.set(b.name, { at: Date.now(), key, detail: await loadBranch(floor, room.id, b.name) });
    } catch (e) {
      details.set(b.name, { at: Date.now(), key, detail: (e as Error).message });
    } finally {
      reading.delete(b.name);
    }
    paint();
  }

  function pick(name: string) {
    selected = name;
    const b = current();
    if (b && !visible().includes(b)) showAll = true;
    paint();
    if (b) void readDetail(b);
    side.querySelector('.ti-side-body')?.scrollTo({ top: 0 });
  }

  /** The branch to show first: the one on the table's screen, else one somebody's on, else the default. */
  function first(): string | undefined {
    const list = info?.branches ?? [];
    return (list.find((b) => showsOnTv(b)) ?? list.find((b) => b.agents.length) ?? list.find((b) => b.base) ?? list[0])?.name;
  }

  function paint() {
    if (closed) return;
    const tv = onTv();
    const mine = shots ? Object.entries(shots.apps).filter(([k]) => k.startsWith(`${room.id}--`)) : [];
    const s = JSON.stringify([info, mine, tv, selected, showAll, error]);
    if (s !== stamp) {
      stamp = s;
      paintStage(tv);
    }
    paintSide();
    const why = cantHire() ?? (info && !info.room.free ? `Every chair at ${room.name} is taken` : undefined);
    task.disabled = !info?.room.free || !!cantHire();
    task.title = why ?? 'A new agent at the table, in a worktree of its own';
  }

  function paintStage(tv: string | undefined) {
    if (!info) {
      body.replaceChildren(h('div.rm-empty', {}, h('strong', {}, error ? 'Couldn’t read this table' : 'Reading the table…'), error ? h('p', {}, error) : ''));
      return;
    }
    const all = info.branches.length + (info.more ?? 0);
    const list = visible();
    const toggle = h('button.ti-toggle', { type: 'button', 'aria-pressed': String(showAll), title: showAll ? 'Only the default branch, the ones somebody’s on and the recent ones (A)' : 'Every branch (A)' }, showAll ? 'Active only' : `Show all ${all}`);
    toggle.addEventListener('click', () => {
      showAll = !showAll;
      paint();
    });
    const head = (title: string, count: string, ...extra: (Node | string)[]) => h('header.ti-section-head', {}, h('h3', {}, title), count ? h('span.ti-count', {}, count) : '', h('span.ti-spacer'), ...extra);
    const open = info.pulls.filter((p) => p.state === 'OPEN');
    const shut = info.pulls.filter((p) => p.state !== 'OPEN');
    const names = new Set(info.branches.map((b) => b.name));
    const fetched = info.fetchedAt ? h('span.ti-fetched', {}, `from GitHub ${new Date(info.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`) : '';
    body.replaceChildren(
      ...info.problems.map((p) => h('p.ti-problem', {}, p)),
      h('section.ti-section', {},
        head('Branches', list.length === all ? String(all) : `${list.length} of ${all}`, fetched, list.length < all || showAll ? toggle : ''),
        list.length ? h('div.ti-cards', {}, ...list.map((b) => branchCard({ b, info: info!, picture: b.apps[0] ? pictures.of(b.apps[0].key, shots) : undefined, blocked: blocked(b.apps[0]?.key), selected: b.name === selected, onTv: showsOnTv(b, tv), pick: () => pick(b.name) }))) : h('p.rm-muted', {}, 'No branches yet.'),
        showAll && info.more ? h('p.rm-muted', {}, `and ${info.more} older, not shown`) : ''),
      info.previews.length ? h('section.ti-section', {},
        head('Other previews', `${info.previews.length}`, h('span.ti-fetched', {}, 'deployed from branches this repository doesn’t have')),
        ...info.previews.map(deployRow)) : '',
      info.room.repo ? h('section.ti-section', {},
        head('Pull requests', open.length ? `${open.length} open` : 'none open'),
        ...open.map((p) => pullRow(p, pick, names.has(p.headRefName))),
        shut.length ? h('h4.ti-subhead', {}, 'Recently merged and closed') : '',
        ...shut.map((p) => pullRow(p, pick, names.has(p.headRefName)))) : '',
      info.room.repo ? h('section.ti-section', {},
        head('Issues', info.issues.length ? `${info.issues.length}${info.issues.length >= 30 ? '+' : ''} open` : 'none open', h('a.rr-ghost.ti-link', { href: `${github.repo(info.room.repo)}/issues`, target: '_blank', rel: 'noopener' }, 'All issues ↗')),
        ...info.issues.map(issueRow)) : '',
      info.base && info.commits.length ? h('section.ti-section', {},
        head(`Latest on ${info.base}`, ''),
        h('div.ti-commits', {}, ...info.commits.map((c) => commitRow(c, info!.room.repo)))) : '');
  }

  function paintSide() {
    const b = current();
    if (!info || !b) {
      side.replaceChildren(h('div.rr-none', {}, h('strong', {}, info ? 'Pick a branch' : 'Reading the table…'), h('p', {}, 'See what’s running on it, who’s on it, its pull request and what it changes.')), foot);
      sideStamp = '';
      return;
    }
    const det = details.get(b.name)?.detail;
    const pics = b.apps.map((a) => shots?.apps[`${room.id}--${a.key}`]?.at);
    const s = JSON.stringify([b, det, info.pulls.find((p) => p.number === b.pull), info.room.free, [...running], b.base ? info.commits : 0, pics, cantHire()]);
    if (s === sideStamp) return;
    sideStamp = s;
    const scrolled = side.querySelector('.ti-side-body')?.scrollTop ?? 0;
    side.replaceChildren(sideHead(b, info), sideBody(b, det, info, sideDeps), foot);
    side.querySelector('.ti-side-body')?.scrollTo({ top: scrolled });
  }

  async function tick() {
    if (ticking || closed) return;
    ticking = true;
    try {
      const [i, s] = await Promise.all([loadInfo(floor, room.id), loadShots(floor).catch(() => shots)]);
      info = i;
      shots = s;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      ticking = false;
    }
    if (closed) return;
    if (info && !info.branches.some((b) => b.name === selected)) selected = first();
    if (info) {
      const agents = new Set(info.branches.flatMap((b) => b.agents.map((a) => a.id))).size;
      const open = info.pulls.filter((p) => p.state === 'OPEN').length;
      shell.sub.textContent = [info.room.repo ?? 'No repository yet', `${info.branches.length + (info.more ?? 0)} branch${info.branches.length + (info.more ?? 0) === 1 ? '' : 'es'}`, info.room.repo ? `${open} open PR${open === 1 ? '' : 's'}` : '', `${agents} agent${agents === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
      if (info.room.repo) {
        repoLink.href = github.repo(info.room.repo);
        repoLink.hidden = false;
      }
      liveLink.hidden = !info.live;
      if (info.live) liveLink.href = info.live;
      paintVercel();
    }
    paint();
    const b = current();
    if (b) void readDetail(b);
  }

  /** ←/→ (or ↑/↓) move between the branches shown, R reviews, A shows them all or the active ones. */
  function onKey(e: KeyboardEvent): boolean {
    const list = visible();
    const at = list.findIndex((b) => b.name === selected);
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key) && list.length) {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      pick(list[(Math.max(0, at) + step + list.length) % list.length].name);
      stage.querySelector(`.ti-card[aria-pressed=true]`)?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'r' || e.key === 'R') return review(), true;
    if (e.key === 'a' || e.key === 'A') {
      showAll = !showAll;
      paint();
      return true;
    }
    return false;
  }

  timer = window.setInterval(() => void tick(), POLL_MS);
  paint();
  void tick();
  return { close: () => shell.close() };
}
