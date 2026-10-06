import './panel.css';
import { h, timeAgo, STATUS_LABEL } from '../dom';
import { serviceUrl } from '../services';
import { openRoomShell } from '../workspace/room-shell';
import { agentFilter, agentMatches, agentOrder, type AgentFilter, type AgentRow, type AgentsView } from '../../../shared/agents';
import { PROVIDER_META, isAgentProvider } from '../../../shared/providers';
import type { ChatSnapshot } from '../../../shared/worker-chat';

// The Agents panel: every agent in the office, on every floor, in one full-screen place (GET /api/agents, see
// shared/agents.ts). Needs you first, then working, ready and asleep, by floor; search and filters along the top. The
// one chosen shows down the right: what it's doing now, its apps, the last of its conversation, and a box to message
// it, with Interrupt, Wake, Send home and Open window, which takes you to its floor first when it's on another.
// Whether you may direct one is the server's to say, as for the chat itself.

export interface AgentsDeps {
  currentFloor(): string | undefined;
  /** Opens the worker's window, going to its floor first when it's another. */
  openWorker(a: AgentRow): void;
  /** Starts a new task on a floor, going there first when it's another. */
  newTask(floorId: string): void;
  /** Wakes a worker (worker.resume) or sends it home keeping its work (worker.kill, keep). */
  wake(id: string): void;
  sendHome(id: string): void;
}

const LIST_MS = 2000, CHAT_MS = 3000;
const FILTERS: { id: AgentFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'needs', label: 'Needs you' }, { id: 'working', label: 'Working' }, { id: 'ready', label: 'Ready' }, { id: 'asleep', label: 'Asleep' }];
const clip = (s: string | undefined, n: number) => (!s ? '' : s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);
const modelOf = (a: AgentRow) => [a.provider && isAgentProvider(a.provider) ? PROVIDER_META[a.provider].name : a.kind === 'shell' ? 'Shell' : a.provider, a.usage?.model ?? a.model, a.effort].filter(Boolean).join(' \u00b7 ');
const asleep = (a: AgentRow) => a.status === 'offline' || a.status === 'exited';
const statusText = (a: AgentRow) => (a.status === 'needs_input' ? 'Needs you' : STATUS_LABEL[a.status] ?? a.status);
const chatQuery = (a: AgentRow) => new URLSearchParams({ floor: a.floor, worker: a.id });

/** Waits (up to 15 s) for something to be so, as a ride to another floor lands, then does `then`. */
export function whenReady(ready: () => boolean, then: () => void) {
  const start = Date.now();
  const tick = () => (ready() ? then() : Date.now() - start < 15_000 && window.setTimeout(tick, 200));
  tick();
}

async function post(path: string, a: AgentRow, body: unknown) {
  const res = await fetch(`${path}?${chatQuery(a)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(out?.error ?? 'The worker could not be reached');
}

export function openAgentsPanel(d: AgentsDeps): { close(): void } {
  let view: AgentsView | undefined;
  let selected: string | undefined;
  let filter: AgentFilter = 'all';
  let floor = '';
  let query = '';
  let chat: { id: string; data?: ChatSnapshot; error?: string } | undefined;
  let confirmHome = '';
  let listTimer = 0, chatTimer = 0;
  let error = '';

  const shell = openRoomShell({
    className: 'agents-room',
    label: 'Agents',
    doing: 'looking over the agents',
    key: onKey,
    escape: (e) => {
      if (e.target === search && search.value) {
        search.value = query = '';
        paintList();
        return true;
      }
      return false;
    },
    onClose: () => {
      window.clearInterval(listTimer);
      window.clearInterval(chatTimer);
    },
  });
  shell.name.textContent = 'Agents';
  const search = h('input.rr-address.ag-search', { type: 'search', placeholder: 'Search agents, tasks, floors\u2026 ( / )', 'aria-label': 'Search agents', spellcheck: 'false' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    paintList();
  });
  shell.middle.append(search);
  const filters = h('div.rr-sizes.ag-filters', { role: 'group', 'aria-label': 'Show' });
  const floorPick = h('select.rr-pick', { 'aria-label': 'Floor' }) as HTMLSelectElement;
  floorPick.addEventListener('change', () => {
    floor = floorPick.value;
    paintList();
  });
  const newTask = h('button.rr-approve', { type: 'button', title: 'Hire someone for a new task' }, '+ New task');
  newTask.addEventListener('click', () => {
    const target = floor || d.currentFloor() || view?.floors[0]?.id;
    if (!target) return;
    if (target !== d.currentFloor()) shell.close();
    d.newTask(target);
  });
  shell.right.append(filters, floorPick, newTask);

  const list = h('div.ag-list', { role: 'listbox', 'aria-label': 'Agents' });
  shell.stage.classList.add('ag-stage');
  shell.stage.append(list);
  const detail = h('aside.rr-side.ag-detail', { 'aria-label': 'The agent chosen' });
  shell.side(detail);

  const agents = () => view?.agents ?? [];
  const shown = () => agents().filter((a) => (!floor || a.floor === floor) && agentFilter(a, filter) && (!query.trim() || agentMatches(a, query))).sort(agentOrder);
  const chosen = () => agents().find((a) => a.id === selected);

  // ---- The list ----
  function paintTop() {
    const all = agents();
    const count = (f: AgentFilter) => all.filter((a) => (!floor || a.floor === floor) && agentFilter(a, f)).length;
    filters.replaceChildren(...FILTERS.map((f) => {
      const n = count(f.id);
      const b = h('button', { type: 'button', class: f.id === filter ? 'on' : '', 'data-filter': f.id }, f.label, f.id !== 'all' && n ? h('span.ag-n', {}, String(n)) : '');
      b.addEventListener('click', () => {
        filter = f.id;
        paintList();
      });
      return b;
    }));
    const floors = view?.floors ?? [];
    floorPick.replaceChildren(h('option', { value: '' }, 'Every floor'), ...floors.map((f) => h('option', { value: f.id }, f.name)));
    floorPick.value = floor;
    floorPick.hidden = floors.length < 2;
    const needs = all.filter((a) => agentFilter(a, 'needs')).length, working = all.filter((a) => agentFilter(a, 'working')).length;
    shell.sub.textContent = error || [`${all.length} agent${all.length === 1 ? '' : 's'}`, needs ? `${needs} need${needs === 1 ? 's' : ''} you` : '', working ? `${working} working` : '', floors.length > 1 ? `${floors.length} floors` : ''].filter(Boolean).join(' \u00b7 ');
  }

  function row(a: AgentRow): HTMLElement {
    const now = a.status === 'needs_input' ? a.activity || 'Waiting for you' : a.status === 'done' ? 'Finished: waiting for you to look' : asleep(a) ? 'Asleep: wakes when you message it' : a.activity || (a.status === 'idle' ? 'Ready for a task' : '');
    const chips: HTMLElement[] = a.apps.map((s) => h('a.ag-chip.app', { href: serviceUrl(s.port), target: '_blank', rel: 'noopener', title: `${s.title}: open it` }, `\u25b8 :${s.port}`));
    if (a.pr) chips.push(h('a.ag-chip.pr', { href: a.pr.url, target: '_blank', rel: 'noopener', title: 'Its pull request' }, `PR #${a.pr.number}`));
    if (a.worktree?.branch) chips.push(h('span.ag-chip', { title: 'Its branch' }, clip(a.worktree.branch, 28)));
    const when = a.waitingSince && (a.status === 'needs_input' || a.status === 'done') ? `waiting ${timeAgo(a.waitingSince).replace(' ago', '')}` : a.lastInput ? timeAgo(a.lastInput.at) : timeAgo(a.createdAt);
    const el = h('div.ag-row', { role: 'option', tabindex: '0', 'data-id': a.id, 'data-status': a.status, 'aria-selected': String(a.id === selected) },
      h('span.ag-dot', { title: statusText(a) }),
      h('div.ag-main', {},
        h('div.ag-line', {}, h('strong', {}, a.name), h('span.ag-state', {}, statusText(a)), h('span.ag-model', {}, modelOf(a)), a.specialist ? h('span.ag-chip', {}, a.specialist) : ''),
        h('div.ag-task', {}, clip(a.task?.name ?? a.title ?? a.prompt ?? '', 140) || h('span.ag-muted', {}, 'No task yet')),
        now ? h('div.ag-now', {}, clip(now, 160)) : ''),
      h('div.ag-side', {}, h('div.ag-chips', {}, ...chips), h('span.ag-when', {}, when)));
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      select(a.id);
    });
    el.addEventListener('dblclick', () => d.openWorker(a));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) d.openWorker(a);
    });
    return el;
  }

  let listStamp = '';
  function paintList() {
    paintTop();
    const rows = shown();
    if (!view) return list.replaceChildren(h('div.rr-notice', {}, h('strong', {}, error || 'Loading the agents\u2026')));
    // Drawn again only when something in it changed, so a row keeps the keys' focus.
    const stamp = JSON.stringify([rows, view.floors, d.currentFloor(), Math.floor(Date.now() / 30_000)]);
    if (stamp === listStamp) return void paintDetail();
    const hadFocus = (document.activeElement as HTMLElement | null)?.closest?.('.ag-row')?.getAttribute('data-id');
    listStamp = stamp;
    if (!rows.length) {
      list.replaceChildren(h('div.ag-empty', {}, h('strong', {}, agents().length ? 'No agents match' : 'No agents yet'), h('p', {}, agents().length ? 'Try another filter or search.' : 'Start one with + New task.')));
    } else {
      const byFloor = new Map<string, AgentRow[]>();
      for (const a of rows) byFloor.set(a.floor, [...(byFloor.get(a.floor) ?? []), a]);
      // The floor you're on first, then the others as the building lists them.
      const order = [...view.floors].sort((x, y) => Number(y.id === d.currentFloor()) - Number(x.id === d.currentFloor()));
      list.replaceChildren(...order.filter((f) => byFloor.has(f.id)).map((f) => {
        const here = byFloor.get(f.id)!;
        const add = h('button.ag-add', { type: 'button', title: `A new task on ${f.name}` }, '+ New task here');
        add.addEventListener('click', () => {
          if (f.id !== d.currentFloor()) shell.close();
          d.newTask(f.id);
        });
        return h('section.ag-floor', {}, h('header', {}, h('h3', {}, f.name), h('span.ag-muted', {}, f.id === d.currentFloor() ? 'You\u2019re here' : ''), h('span.rr-grow'), add), ...here.map(row));
      }));
    }
    if (!selected || !rows.some((a) => a.id === selected)) {
      if (rows[0] && (!selected || !agents().some((a) => a.id === selected))) select(rows[0].id, false);
    }
    if (hadFocus) list.querySelector<HTMLElement>(`.ag-row[data-id="${CSS.escape(hadFocus)}"]`)?.focus({ preventScroll: true });
    paintDetail();
  }

  function select(id: string, focus = true) {
    if (selected !== id) {
      selected = id;
      confirmHome = '';
      stick = true;
      chat = { id };
      void loadChat();
    }
    for (const el of list.querySelectorAll<HTMLElement>('.ag-row')) el.setAttribute('aria-selected', String(el.dataset.id === id));
    if (focus) list.querySelector<HTMLElement>(`.ag-row[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
    paintDetail();
  }

  // ---- The one chosen ----
  const box = h('textarea.rr-input.ag-message', { rows: 3, maxlength: 20000, placeholder: 'Message it\u2026 (\u2318\u21a9 sends)', 'aria-label': 'Message' }) as HTMLTextAreaElement;
  const sendBtn = h('button.rr-send', { type: 'button' }, 'Send');
  const status = h('p.rr-status', { 'aria-live': 'polite' });
  const convo = h('div.ag-convo');
  /** The conversation keeps to its newest message, unless you've scrolled up to read. */
  let stick = true;
  convo.addEventListener('scroll', () => (stick = convo.scrollHeight - convo.scrollTop - convo.clientHeight < 40));
  async function sendMessage() {
    const a = chosen(), text = box.value.trim();
    if (!a || !text) return;
    sendBtn.disabled = true;
    status.textContent = 'Sending\u2026';
    try {
      await post('/api/worker-chat/message', a, { text, requestId: `agents-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
      box.value = '';
      status.textContent = asleep(a) ? `Sent: ${a.name} is waking up to it.` : `Sent to ${a.name}.`;
      void loadChat();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : 'That couldn\u2019t be sent';
    } finally {
      sendBtn.disabled = false;
    }
  }
  sendBtn.addEventListener('click', () => void sendMessage());
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void sendMessage();
    }
  });

  async function loadChat() {
    const a = chosen();
    if (!a || a.kind !== 'agent') return;
    const id = a.id;
    try {
      const res = await fetch(`/api/worker-chat?${chatQuery(a)}`, { credentials: 'same-origin', cache: 'no-store' });
      const out = await res.json().catch(() => undefined);
      if (selected !== id) return;
      chat = res.ok && out ? { id, data: out } : { id, error: out?.error ?? 'Its conversation couldn\u2019t be read' };
    } catch {
      if (selected === id) chat = { id, error: 'The office didn\u2019t answer' };
    }
    paintConvo();
  }

  function paintConvo() {
    if (!chat?.data) {
      convo.replaceChildren(h('p.ag-muted', {}, chat?.error ?? 'Reading its conversation\u2026'));
      return;
    }
    const msgs = chat.data.messages.filter((m) => m.text.trim()).slice(-8);
    convo.replaceChildren(...(msgs.length ? msgs.map((m) => h(`div.ag-msg.${m.role}`, {}, h('span.ag-who', {}, m.role === 'user' ? 'You' : chosen()?.name ?? 'Agent', m.at ? h('span.ag-muted', {}, ` \u00b7 ${timeAgo(m.at)}`) : ''), h('p', {}, clip(m.text, 700)))) : [h('p.ag-muted', {}, 'Nothing said yet.')]));
    if (stick) requestAnimationFrame(() => (convo.scrollTop = convo.scrollHeight));
  }

  function action(label: string, title: string, run: () => void, o: { danger?: boolean; disabled?: boolean } = {}) {
    const b = h(`button.rr-ghost${o.danger ? '.ag-danger' : ''}`, { type: 'button', title, disabled: !!o.disabled }, label);
    b.addEventListener('click', run);
    return b;
  }

  let detailFor = '', detailStamp = '';
  function paintDetail() {
    const a = chosen();
    const stamp = JSON.stringify([a, confirmHome, d.currentFloor(), Math.floor(Date.now() / 30_000)]);
    if (a && stamp === detailStamp) return;
    detailStamp = stamp;
    if (!a) {
      detailFor = '';
      detail.replaceChildren(h('div.rr-none', {}, h('strong', {}, 'No agent chosen'), h('p', {}, 'Choose one on the left to see what it\u2019s doing and message it.')));
      return;
    }
    const can = a.canControl;
    const sameAgent = detailFor === a.id;
    detailFor = a.id;
    const head = h('div.ag-head', {},
      h('div.ag-title', {}, h('span.ag-dot', { 'data-status': a.status }), h('strong', {}, a.name), h('span.rr-state', { 'data-state': a.status === 'needs_input' || a.status === 'done' ? 'changes' : a.status === 'working' ? 'working' : 'new' }, statusText(a))),
      h('p.ag-muted', {}, [a.floorName, a.project?.name, modelOf(a)].filter(Boolean).join(' \u00b7 ')),
      h('p.ag-muted', {}, [`Hired by ${a.createdBy} ${timeAgo(a.createdAt)}`, a.worktree?.branch ? `on ${a.worktree.branch}` : '', a.lastInput ? `last told something by ${a.lastInput.by} ${timeAgo(a.lastInput.at)}` : ''].filter(Boolean).join(' \u00b7 ')));
    const now = h('section.ag-section', {}, h('h4', {}, 'Now'), h('p', {}, a.status === 'needs_input' ? `Needs you${a.activity ? `: ${a.activity}` : ''}` : asleep(a) ? 'Asleep. It wakes when you message it, or with Wake.' : a.activity || statusText(a)));
    const task = a.task?.summary || a.prompt ? h('section.ag-section', {}, h('h4', {}, a.task?.name ?? 'Its task'), h('p', {}, clip(a.task?.summary ?? a.prompt, 400))) : '';
    const apps = a.apps.length ? h('section.ag-section', {}, h('h4', {}, 'Running'), h('div.ag-chips', {}, ...a.apps.map((s) => h('a.ag-chip.app', { href: serviceUrl(s.port), target: '_blank', rel: 'noopener' }, `\u25b8 ${clip(s.title, 30)} :${s.port}`)), a.pr ? h('span.ag-chip.pr', {}, `PR #${a.pr.number}`) : '')) : '';
    const actions = h('div.ag-actions', {},
      action(a.floor === d.currentFloor() ? 'Open window' : `Open on ${a.floorName}`, 'Its conversation, workspace and terminal (Enter)', () => {
        if (a.floor !== d.currentFloor()) shell.close();
        d.openWorker(a);
      }),
      action('Interrupt', 'Stop what it\u2019s doing now (Esc in its terminal)', () => void post('/api/worker-chat/interrupt', a, {}).then(() => (status.textContent = `Interrupted ${a.name}.`), (e) => (status.textContent = String(e.message ?? e))), { disabled: !can || a.status !== 'working' }),
      action('Wake', 'Start its session again', () => d.wake(a.id), { disabled: !can || !asleep(a) }),
      action(confirmHome === a.id ? 'Send home? Click again' : 'Send home', 'It leaves its desk; its branch and work are kept', () => {
        if (confirmHome !== a.id) {
          confirmHome = a.id;
          paintDetail();
          window.setTimeout(() => {
            if (confirmHome === a.id) {
              confirmHome = '';
              paintDetail();
            }
          }, 4000);
          return;
        }
        confirmHome = '';
        d.sendHome(a.id);
        status.textContent = `Sent ${a.name} home.`;
      }, { danger: true, disabled: !can }));
    box.disabled = sendBtn.disabled = !can || a.kind !== 'agent';
    box.placeholder = !can ? 'Only an admin, or whoever hired it, can message it' : a.kind !== 'agent' ? 'A shell takes typing in its terminal' : `Message ${a.name}\u2026 (\u2318\u21a9 sends)`;
    if (!sameAgent) status.textContent = '';
    detail.replaceChildren(
      h('div.ag-detail-top', {}, head, actions),
      h('div.ag-detail-body', {}, now, task, apps, h('section.ag-section.ag-grow', {}, h('h4', {}, 'Conversation'), convo)),
      h('div.rr-compose', {}, box, h('div.rr-compose-row', {}, h('span.rr-hint', {}, a.status === 'working' ? 'It reads it when it\u2019s done with what it\u2019s doing' : ''), sendBtn), status));
    paintConvo();
  }

  // ---- Keys and the office ----
  function onKey(e: KeyboardEvent): boolean {
    const rows = shown();
    const at = rows.findIndex((a) => a.id === selected);
    if (e.key === 'ArrowDown' || e.key === 'j') return rows[at + 1] && select(rows[at + 1].id), true;
    if (e.key === 'ArrowUp' || e.key === 'k') return at > 0 && select(rows[at - 1].id), true;
    if (e.key === '/') return search.focus(), true;
    if (e.key === 'Enter' && chosen()) {
      const a = chosen()!;
      if (a.floor !== d.currentFloor()) shell.close();
      d.openWorker(a);
      return true;
    }
    const f = { a: 'all', n: 'needs', w: 'working', r: 'ready', s: 'asleep' }[e.key] as AgentFilter | undefined;
    if (f) return (filter = f), paintList(), true;
    return false;
  }

  async function loadList() {
    try {
      const res = await fetch('/api/agents', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error();
      view = (await res.json()) as AgentsView;
      error = '';
    } catch {
      error = 'The office didn\u2019t answer. Trying again\u2026';
    }
    const typing = document.activeElement === box || document.activeElement === search;
    paintList();
    if (typing) (document.activeElement as HTMLElement).focus();
  }
  void loadList();
  listTimer = window.setInterval(() => document.visibilityState === 'visible' && void loadList(), LIST_MS);
  chatTimer = window.setInterval(() => document.visibilityState === 'visible' && void loadChat(), CHAT_MS);
  return { close: () => shell.close() };
}
