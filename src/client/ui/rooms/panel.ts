import './panel.css';
import { h, timeAgo, STATUS_LABEL } from '../dom';
import { openRoomShell } from '../workspace/room-shell';
import { openTableReview } from '../workspace/review/table';
import { store } from '../../state';
import type { RoomView } from '../../../shared/factory';
import type { RepoChoice } from '../../../shared/protocol';

// The Rooms panel (server/factory-rooms.ts): a floor's project rooms full screen, each with the GitHub repository it's
// for, who's at its table and how many chairs are free. An admin sets one up for a repository (the office clones it,
// and whoever's hired at its table works in a worktree of it), names it, or clears it; anyone starts a task there.

export interface RoomsDeps {
  /** Hires at the chair `seat`: the hire dialog, for a new task in its room. */
  hireAt(seat: string): void;
  openWorker(id: string): void;
}

const LIST_MS = 2500;
const by = () => store.me.account?.name ?? store.profile.name;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { credentials: 'same-origin', cache: 'no-store' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(body as object), by: by() }) });
  const out = await res.json().catch(() => undefined);
  if (!res.ok || !out) throw new Error(out?.error ?? 'The office didn\u2019t answer');
  return out as T;
}

export function openRoomsPanel(d: RoomsDeps): { close(): void } {
  const floor = store.floor ?? '';
  const q = () => new URLSearchParams({ floor }).toString();
  let rooms: RoomView[] = [];
  let admin = false;
  let selected: string | undefined;
  let picking = false;
  let repos: RepoChoice[] | undefined;
  let reposError = '';
  let timer = 0;
  let stamp = '';

  const shell = openRoomShell({
    className: 'rooms-room',
    label: 'Rooms',
    doing: 'looking over the rooms',
    escape: () => {
      if (picking) return (picking = false), paintSide(), true;
      return false;
    },
    onClose: () => window.clearInterval(timer),
  });
  shell.name.textContent = 'Rooms';
  const grid = h('div.rm-grid');
  shell.stage.classList.add('rm-stage');
  shell.stage.append(grid);
  const side = h('aside.rr-side.rm-side', { 'aria-label': 'The room chosen' });
  shell.side(side);
  const status = h('p.rr-status.rm-status', { 'aria-live': 'polite' });

  const chosen = () => rooms.find((r) => r.id === selected);

  function card(r: RoomView): HTMLElement {
    const working = r.agents.filter((a) => a.status === 'working').length;
    const el = h('div.rm-card', { role: 'button', tabindex: '0', 'aria-selected': String(r.id === selected), 'data-set': String(!!r.repo) },
      h('div.rm-card-head', {}, h('strong', {}, r.name), r.cloning ? h('span.rm-badge.busy', {}, 'Cloning\u2026') : r.repo ? h('span.rm-badge.on', {}, 'Ready') : h('span.rm-badge', {}, 'Empty')),
      h('div.rm-repo', {}, r.cloning ? `Setting up ${r.cloning}` : r.repo ?? (r.dir ? r.dir.replace(/^\/Users\/[^/]+/, '~') : 'Not set up for a repository yet')),
      r.error ? h('div.rm-error', {}, r.error) : '',
      h('div.rm-people', {}, ...r.agents.slice(0, 6).map((a) => h('span.rm-person', { 'data-status': a.status, title: `${a.name}: ${STATUS_LABEL[a.status] ?? a.status}` }, a.name.slice(0, 1))), r.agents.length > 6 ? h('span.rm-more', {}, `+${r.agents.length - 6}`) : ''),
      h('div.rm-meta', {}, [`${r.agents.length} agent${r.agents.length === 1 ? '' : 's'}`, working ? `${working} working` : '', r.seats ? `${Math.max(0, r.seats - r.agents.length)} of ${r.seats} chairs free` : 'no table'].filter(Boolean).join(' \u00b7 ')));
    const pick = () => {
      selected = r.id;
      picking = false;
      paint(true);
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) pick();
    });
    return el;
  }

  function paint(force = false) {
    const set = rooms.filter((r) => r.repo).length;
    shell.sub.textContent = `${store.currentFloor()?.name ?? 'This floor'} \u00b7 ${rooms.length} room${rooms.length === 1 ? '' : 's'} \u00b7 ${set} set up`;
    const s = JSON.stringify([rooms, selected]);
    if (s !== stamp || force) {
      stamp = s;
      grid.replaceChildren(...(rooms.length ? rooms.map(card) : [h('div.rm-empty', {}, h('strong', {}, 'No project rooms on this floor'), h('p', {}, admin ? 'Lay them out in the office builder (U): Project room in the catalog, or the Software Factory layout under the room\u2019s options.' : 'An admin lays them out in the office builder.'))]));
      paintSide();
    }
  }

  function paintSide() {
    const r = chosen();
    if (!r) {
      side.replaceChildren(h('div.rr-none', {}, h('strong', {}, 'Choose a room'), h('p', {}, 'See who\u2019s in it, start a task there, or set it up for a repository.')));
      return;
    }
    if (picking) return paintPicker(r);
    const name = h('input.rr-address.rm-name', { value: r.name, maxlength: 28, 'aria-label': 'Room name', disabled: !admin }) as HTMLInputElement;
    name.addEventListener('change', () => void act('/api/rooms/setup', { room: r.id, name: name.value.trim() }, `Renamed to ${name.value.trim()}.`));
    // Its app's address: what its screen shows while none of its workers runs the app.
    const app = h('input.rr-address.rm-app', { value: r.url ?? '', placeholder: 'http://localhost:3000', 'aria-label': 'Its app\u2019s address', disabled: !admin }) as HTMLInputElement;
    app.addEventListener('change', () => void act('/api/rooms/setup', { room: r.id, url: app.value.trim() }, app.value.trim() ? `Its screen shows ${app.value.trim()} while nobody here runs the app.` : 'Its screen shows only what its workers run.'));
    const task = h('button.rr-send', { type: 'button', disabled: !r.free }, r.free ? '+ New task in this room' : 'No free chair at its table');
    task.addEventListener('click', () => r.free && d.hireAt(r.free));
    // Its app in Software review: what's sent from there goes to a new agent at the table.
    const review = h('button.rr-ghost', { type: 'button', title: 'Review its app at any size and comment on it: a new agent here does what you send' }, '\u{1f9ea} Review the app');
    review.addEventListener('click', () => openTableReview({ id: r.id, name: r.name }));
    const setUp = h('button.rr-ghost', { type: 'button', disabled: !admin || !!r.cloning }, r.repo ? 'Change repository\u2026' : 'Set up for a repository\u2026');
    setUp.addEventListener('click', () => {
      picking = true;
      paintSide();
    });
    const clear = h('button.rr-ghost.rm-danger', { type: 'button', disabled: !admin || !r.repo || r.agents.length > 0, title: r.agents.length ? 'Send its workers home first' : 'The room keeps its name; its clone stays where it is' }, 'Clear repository');
    clear.addEventListener('click', () => void act('/api/rooms/release', { room: r.id }, `${r.name} is empty again.`));
    side.replaceChildren(
      h('div.rm-side-head', {}, h('label.rm-label', {}, 'Name'), name, h('label.rm-label', {}, 'App address'), app, h('p.rm-repo-line', {}, r.repo ? h('a', { href: `https://github.com/${r.repo}`, target: '_blank', rel: 'noopener' }, r.repo) : 'No repository yet'), r.dir ? h('p.rm-dir', {}, r.dir) : ''),
      h('div.rm-side-body', {},
        h('h4', {}, 'At its table'),
        r.agents.length ? h('div.rm-agents', {}, ...r.agents.map((a) => {
          const b = h('button.rm-agent', { type: 'button', 'data-status': a.status }, h('span.rm-dot'), h('strong', {}, a.name), h('span', {}, STATUS_LABEL[a.status] ?? a.status));
          b.addEventListener('click', () => d.openWorker(a.id));
          return b;
        })) : h('p.rm-muted', {}, r.repo ? 'Nobody yet. A new task here gets a worktree of its own of the repository.' : 'Nobody yet.'),
        h('div.rm-actions', {}, setUp, clear)),
      h('div.rm-side-foot', {}, h('div.rm-row', {}, task, review), status));
  }

  function paintPicker(r: RoomView) {
    const search = h('input.rr-address', { type: 'search', placeholder: 'Search your repositories, or type owner/name', 'aria-label': 'Repository' }) as HTMLInputElement;
    const label = h('input.rr-address', { placeholder: 'Room name (the repository\u2019s, unless you say)', maxlength: 28, 'aria-label': 'Room name' }) as HTMLInputElement;
    const list = h('div.rm-repos');
    const go = h('button.rr-send', { type: 'button', disabled: true }, 'Set up the room');
    let choice = '';
    const draw = () => {
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const typed = /^[\w.-]+\/[\w.-]+$/.test(search.value.trim()) ? search.value.trim() : '';
      const shown = (repos ?? []).filter((x) => words.every((w) => `${x.name} ${x.description ?? ''}`.toLowerCase().includes(w))).slice(0, 60);
      list.replaceChildren(
        ...(typed && !shown.some((x) => x.name.toLowerCase() === typed.toLowerCase()) ? [repoRow({ name: typed, private: false } as RepoChoice)] : []),
        ...shown.map(repoRow),
        ...(!repos ? [h('p.rm-muted', {}, reposError || 'Asking GitHub for your repositories\u2026')] : !shown.length && !typed ? [h('p.rm-muted', {}, 'None match.')] : []));
    };
    const repoRow = (x: RepoChoice) => {
      const b = h('button.rm-repo-row', { type: 'button', 'aria-pressed': String(x.name === choice) }, h('strong', {}, x.name), x.private ? h('span.rm-badge', {}, 'private') : '', x.description ? h('span.rm-desc', {}, x.description) : '', x.pushedAt ? h('span.rm-when', {}, timeAgo(x.pushedAt)) : '');
      b.addEventListener('click', () => {
        choice = x.name;
        go.disabled = false;
        go.textContent = `Set up for ${x.name}`;
        draw();
      });
      return b;
    };
    search.addEventListener('input', draw);
    go.addEventListener('click', () => {
      if (!choice) return;
      picking = false;
      void act('/api/rooms/setup', { room: r.id, repo: choice, ...(label.value.trim() ? { name: label.value.trim() } : { name: choice.split('/')[1] }) }, `Cloning ${choice}\u2026 the room is ready when it\u2019s done.`);
    });
    const cancel = h('button.rr-ghost', { type: 'button' }, 'Cancel');
    cancel.addEventListener('click', () => {
      picking = false;
      paintSide();
    });
    side.replaceChildren(
      h('div.rm-side-head', {}, h('strong', {}, `Set up ${r.name}`), h('p.rm-muted', {}, 'The office clones the repository (or uses the checkout it has), and whoever\u2019s hired at this room\u2019s table works in a worktree of it.')),
      h('div.rm-side-body.rm-picker', {}, search, list),
      h('div.rm-side-foot', {}, label, h('div.rm-row', {}, go, cancel), status));
    draw();
    search.focus();
    if (!repos) {
      void call<{ repos: RepoChoice[] }>('/api/rooms/repos').then((r2) => {
        repos = r2.repos;
        if (picking) draw();
      }, (e) => {
        reposError = e instanceof Error ? e.message : 'GitHub didn\u2019t answer';
        if (picking) draw();
      });
    }
  }

  async function act(path: string, body: Record<string, unknown>, done: string) {
    status.textContent = 'Working\u2026';
    try {
      const out = await call<{ rooms: RoomView[] }>(`${path}?${q()}`, body);
      rooms = out.rooms;
      status.textContent = done;
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'That didn\u2019t work';
    }
    paint(true);
  }

  async function load() {
    try {
      const out = await call<{ rooms: RoomView[]; admin: boolean }>(`/api/rooms?${q()}`);
      rooms = out.rooms;
      admin = out.admin;
      if (!selected && rooms[0]) selected = rooms[0].id;
    } catch (e) {
      shell.sub.textContent = e instanceof Error ? e.message : 'The office didn\u2019t answer';
    }
    // The picker stays as it is while someone's choosing.
    if (picking) return;
    paint();
  }
  void load();
  timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), LIST_MS);
  return { close: () => shell.close() };
}
