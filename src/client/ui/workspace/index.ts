import './workspace.css';
import { h } from '../dom';
import { unshareRequest } from '../worker-chat/api';
import { artifactKey, type ChatArtifact, type ChatSnapshot, type SharedFolder } from '../../../shared/worker-chat';
import { WORKSPACES, WORKSPACE_TABS, fileTab, type WorkspaceKind, type WorkspaceTab } from '../../../shared/workspace';
import { appOn } from '../../../shared/apps';
import { store } from '../../state';
import { designBoard } from './board';
import { designCanvas } from './canvas';
import { reviewTargets, softwareReview } from './review';
import { filesPanel } from './files';
import { reportReader } from './reader';
import { screeningRoom } from './screening';
import type { Panel, Workspace, WorkspaceHost } from './types';

// The chat window's right-hand side. A worker's role picks its kind (shared/workspace.ts), which only orders the tabs
// and names the window; each tab is a panel for one kind of output. A new output type is one panel file, one entry
// here and a case in `tabOf`, and the Record fails the typecheck until the entry exists.

export const PANELS: Record<WorkspaceTab, (host: WorkspaceHost) => Panel> = {
  canvas: designCanvas,
  review: softwareReview,
  watch: screeningRoom,
  board: designBoard,
  read: reportReader,
  files: filesPanel,
};

const TAB_LABELS: Record<WorkspaceTab, string> = { canvas: 'Canvas', review: 'Review', watch: 'Watch', board: 'Board', read: 'Read', files: 'Files' };

/** Every file once: what the worker linked (and remembered links), then the files beside them, then the floor's scan. */
function everyFile(data: ChatSnapshot): ChatArtifact[] {
  const seen = new Set<string>();
  return [...(data.linked ?? []), ...(data.nearby ?? []), ...data.artifacts].filter((f) => !seen.has(artifactKey(f)) && !!seen.add(artifactKey(f)));
}
const filesOn = (tab: WorkspaceTab, all: ChatArtifact[]) => (tab === 'files' ? all : all.filter((f) => fileTab(f) === tab));
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const pauseAll = (el: HTMLElement) => { for (const m of el.querySelectorAll<HTMLMediaElement>('video,audio')) m.pause(); };

/** Whether the floor has an app on (☰ › Apps, see shared/apps.ts). */
const enabled = (tab: WorkspaceTab) => appOn(store.studio.setup, tab);

/**
 * Mounts a workspace of `kind`: a bar with its name, its tabs and Theater, the open tab's panel, and for an admin the
 * folders shared with the floor. Its tabs are the floor's apps that are on (see shared/apps.ts): the kind's own in its
 * order, then the others, Files last. A tab shows when it has files or is the kind's main one (its first that's on);
 * until you pick one, the window opens on the first tab holding a file the worker linked.
 */
export function mountWorkspace(host: WorkspaceHost, kind: WorkspaceKind): Workspace {
  const spec = WORKSPACES[kind];
  const order: WorkspaceTab[] = [...spec.tabs.filter((t) => t !== 'files'), ...WORKSPACE_TABS.filter((t) => t !== 'files' && !spec.tabs.includes(t)), 'files'];
  /** The tab the window opens on: the kind's first, unless the floor has turned it off. Files is always on. */
  const main = () => [spec.tabs[0], ...order].find(enabled)!;
  /** The tabs showing for `all`: on, and the main one or holding something. */
  /** How much a tab has to show: its files, or for Review the apps the worker is running. */
  const holding = (t: WorkspaceTab, all: ChatArtifact[]) => (t === 'review' ? reviewTargets(host.workerId).length : filesOn(t, all).length);
  const showing = (all: ChatArtifact[]) => order.filter((t) => enabled(t) && (t === main() || holding(t, all) > 0));
  const tabBar = h('div.ws-tabs', { role: 'tablist', 'aria-label': `${spec.label} views` });
  const theater = h('button.btn.ws-theater', { type: 'button', 'aria-pressed': 'false', title: 'Hide the conversation to give this side the whole window (F)' }, 'Theater');
  const body = h('div.ws-body', {}, h('p.chat-empty.ws-loading', {}, `Opening ${host.workerName}’s ${spec.label === 'Files' ? 'files' : spec.label.toLowerCase()}…`));
  const sharesLine = h('div.shares-line.hidden');
  const element = h('section.workspace', { tabindex: '-1', 'data-kind': kind, 'aria-label': spec.label },
    h('div.ws-bar', {}, h('h3.ws-title', {}, spec.label), tabBar, theater), body, sharesLine);
  const buttons = new Map<WorkspaceTab, HTMLButtonElement>();
  const panels = new Map<WorkspaceTab, { panel: Panel; stamp: string }>();
  let data: ChatSnapshot | undefined, active: WorkspaceTab = spec.tabs[0], chosen = false, shareStamp = '';

  for (const tab of order) {
    const b = h('button.ws-tab', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': tab }, TAB_LABELS[tab], h('span.ws-count'));
    b.addEventListener('click', () => { chosen = true; select(tab); });
    buttons.set(tab, b);
    tabBar.append(b);
  }

  /** The open tab's panel, made the first time it opens, painted when its files, a review or canSend changed. */
  function select(tab: WorkspaceTab): Panel {
    if (tab !== active) { const was = panels.get(active); if (was) pauseAll(was.panel.element); }
    active = tab;
    let entry = panels.get(tab);
    if (!entry) { entry = { panel: PANELS[tab](host), stamp: '' }; panels.set(tab, entry); body.querySelector('.ws-loading')?.remove(); body.append(entry.panel.element); }
    for (const [t, p] of panels) p.panel.element.hidden = t !== tab;
    for (const [t, b] of buttons) { b.setAttribute('aria-selected', String(t === tab)); b.classList.toggle('on', t === tab); }
    element.dataset.tab = tab;
    if (data) {
      const files = filesOn(tab, everyFile(data));
      const reviews = data.messages.flatMap((m) => (m.review ? [[m.id, m.review]] : []));
      const stamp = JSON.stringify([files.map((f) => [artifactKey(f), f.size, f.modified, 'link' in f ? f.link : '']), reviews, data.canSend, data.worker.status]);
      if (stamp !== entry.stamp) { entry.stamp = stamp; entry.panel.paint(files, data); }
    }
    return entry.panel;
  }

  function paint(next: ChatSnapshot) {
    data = next;
    const all = everyFile(next);
    const linkedTabs = new Set((next.linked ?? []).map((f) => fileTab(f) ?? 'files'));
    const shown = showing(all);
    for (const [t, b] of buttons) {
      const n = holding(t, all);
      b.hidden = !shown.includes(t);
      b.querySelector('.ws-count')!.textContent = n ? String(n) : '';
    }
    tabBar.hidden = shown.length < 2;
    let tab = chosen ? active : shown.find((t) => linkedTabs.has(t)) ?? main();
    if (!shown.includes(tab)) tab = main();
    select(tab);
    const nextShares = JSON.stringify(next.shares ?? []);
    if (nextShares !== shareStamp) { shareStamp = nextShares; paintShares(next.shares ?? []); }
  }

  /** For an admin: the folders shared with this floor, each with Stop sharing. */
  function paintShares(shares: SharedFolder[]) {
    sharesLine.replaceChildren();
    sharesLine.classList.toggle('hidden', !shares.length);
    if (!shares.length) return;
    sharesLine.append(h('span', {}, 'Shared with this floor:'));
    for (const s of shares) {
      const stop = h('button.link-button', { type: 'button', title: `Stop sharing ${s.label} with this floor` }, 'Stop sharing');
      stop.addEventListener('click', () => {
        stop.disabled = true;
        void unshareRequest(s.id).then(() => host.refresh(), (error: unknown) => { stop.disabled = false; stop.textContent = error instanceof Error ? error.message : 'Could not stop sharing'; });
      });
      sharesLine.append(h('span.share-item', {}, h('span.share-label', { title: s.label }, s.label), ' · ', stop));
    }
  }

  /** Theater hides the conversation, so the panel (a render, a board) gets the whole window. */
  function toggleTheater(on = theater.getAttribute('aria-pressed') !== 'true') {
    theater.setAttribute('aria-pressed', String(on));
    theater.classList.toggle('on', on);
    element.closest<HTMLElement>('.modal')?.toggleAttribute('data-theater', on);
  }
  theater.addEventListener('click', () => toggleTheater());

  // Keys only while the workspace has focus (a click anywhere on it gives it focus: it has a tabindex), never while
  // typing, never with a modifier and never Escape, which closes the window (openModal's listener runs first anyway).
  // F is the frame's; the rest go to the open panel.
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); if (!e.repeat) toggleTheater(); return; }
    if (panels.get(active)?.panel.key?.(e)) { e.preventDefault(); e.stopPropagation(); }
  });

  return {
    element,
    paint,
    show(key) {
      if (!data) return;
      const all = everyFile(data);
      const file = all.find((f) => artifactKey(f) === key);
      if (!file) return;
      const own = fileTab(file);
      chosen = true;
      select(own && showing(all).includes(own) ? own : 'files').show(file);
      element.focus({ preventScroll: true });
    },
    stop() {
      for (const { panel } of panels.values()) { pauseAll(panel.element); panel.stop(); }
      element.closest<HTMLElement>('.modal')?.removeAttribute('data-theater');
    },
  };
}
