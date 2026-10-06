import './files-room.css';
import { h } from '../dom';
import { artifactKey, type ChatArtifact, type ChatSnapshot } from '../../../shared/worker-chat';
import { fileTab, versionLabel, type WorkspaceTab } from '../../../shared/workspace';
import { openBoardRoom } from './board/room';
import { openCanvasRoom } from './canvas/room';
import { badges, fileFolder, fileSize, fileTime, fileTitle, latestLinked, previewStage, sections } from './files';
import { openReaderRoom } from './reader/room';
import type { RoomHandle, RoomOpener } from './room-attach';
import { openRoomShell } from './room-shell';
import { openScreeningRoom } from './screening/room';
import type { WorkspaceHost } from './types';

// Files full screen, as Frame.io shows a project: everything the worker made or linked as a grid, its own first and
// then the floor's, with the kinds along the top and a search. The one chosen previews down the right; opening it
// (double-click, Enter, or Open in \u2026) takes it to its own room over this one: a cut to the screening room, a picture to
// the image board, a document to Reports, a design to the canvas. Closing that comes back here.

type Kind = 'all' | 'watch' | 'board' | 'read' | 'canvas' | 'other';
const KINDS: { id: Kind; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'watch', label: 'Video' }, { id: 'board', label: 'Images' }, { id: 'read', label: 'Docs' }, { id: 'canvas', label: 'Designs' }, { id: 'other', label: 'Other' }];
const ROOM: Partial<Record<WorkspaceTab, { name: string; open: (host: WorkspaceHost) => RoomOpener }>> = {
  watch: { name: 'Screening room', open: (host) => (o) => openScreeningRoom(host, o) },
  board: { name: 'Image board', open: (host) => (o) => openBoardRoom(host, o) },
  read: { name: 'Reports', open: (host) => (o) => openReaderRoom(host, o) },
  canvas: { name: 'Design canvas', open: (host) => (o) => openCanvasRoom(host, o) },
};
const kindOf = (f: ChatArtifact): Kind => {
  const t = fileTab(f);
  return t === 'watch' || t === 'board' || t === 'read' || t === 'canvas' ? t : 'other';
};
const ICON: Record<Kind, string> = { all: '', watch: '\u25b6', board: '\u{1f5bc}', read: '\u{1f4c4}', canvas: '\u{1f3a8}', other: '\u{1f5c2}' };

export function openFilesRoom(host: WorkspaceHost, o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }): RoomHandle {
  let files: ChatArtifact[] = [];
  let data = o.data;
  let kind: Kind = 'all';
  let query = '';
  let selected: ChatArtifact | undefined;
  let child: { tab: WorkspaceTab; room: RoomHandle } | undefined;
  let gridStamp = '';
  const abort = new AbortController();

  const shell = openRoomShell({
    className: 'files-room',
    label: `${host.workerName}\u2019s files`,
    doing: `looking through ${host.workerName}\u2019s files`,
    key: onKey,
    escape: (e) => {
      if (e.target === search && search.value) {
        search.value = query = '';
        paint();
        return true;
      }
      return false;
    },
    onClose: () => {
      abort.abort();
      child?.room.close();
      o.onClose();
    },
  });
  shell.name.textContent = 'Files';
  shell.sub.textContent = host.workerName;
  const search = h('input.rr-address.fr-search', { type: 'search', placeholder: 'Search files ( / )', 'aria-label': 'Search files', spellcheck: 'false' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    paint();
  });
  shell.middle.append(search);
  const kinds = h('div.rr-sizes', { role: 'group', 'aria-label': 'Kind' });
  shell.right.append(kinds);
  const grid = h('div.fr-grid', { role: 'listbox', 'aria-label': 'Files' });
  shell.stage.classList.add('fr-stage');
  shell.stage.append(grid);
  const side = h('aside.rr-side.fr-side', { 'aria-label': 'The file chosen' });
  shell.side(side);

  const shown = () => files.filter((f) => (kind === 'all' || kindOf(f) === kind) && (!query.trim() || query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => f.path.toLowerCase().includes(w))));
  const same = (a?: ChatArtifact, b?: ChatArtifact) => !!a && !!b && artifactKey(a) === artifactKey(b);

  // ---- Opening a file in its own room ----
  function openIn(f: ChatArtifact) {
    const tab = fileTab(f);
    const r = tab && ROOM[tab];
    if (!tab || !r) return;
    const theirs = files.filter((x) => fileTab(x) === tab);
    if (child?.tab === tab) return child.room.show(f);
    child?.room.close();
    const room = r.open(host)({ files: theirs, data, file: f, onClose: () => (child = child?.room === room ? undefined : child) });
    child = { tab, room };
  }

  // ---- The grid ----
  function tile(f: ChatArtifact, latest: ChatArtifact | undefined, videos: { n: number }): HTMLElement {
    const k = kindOf(f);
    let thumb: HTMLElement;
    if (k === 'board') thumb = h('img', { src: host.url(f), alt: '', loading: 'lazy', decoding: 'async' });
    // A cut's first frame, for the first dozen: each is a request for its start.
    else if (f.type.startsWith('video/') && videos.n++ < 12) thumb = h('video', { src: `${host.url(f)}#t=0.5`, preload: 'metadata', muted: true, playsinline: true, tabindex: '-1' });
    else thumb = h('span.fr-icon', { 'aria-hidden': 'true' }, f.type.startsWith('audio/') ? '\u266a' : ICON[k]);
    const v = versionLabel(f.path);
    const pills = [...(same(f, latest) ? ['Latest'] : []), ...badges(f, data)];
    const el = h('div.fr-tile', { role: 'option', tabindex: '0', 'data-key': artifactKey(f), 'data-kind': k, 'aria-selected': String(same(f, selected)), title: fileTitle(f) },
      h('div.fr-thumb', {}, thumb, v ? h('span.fr-version', {}, v) : '', k === 'watch' ? h('span.fr-play', { 'aria-hidden': 'true' }, '\u25b6') : ''),
      h('div.fr-name', {}, f.name),
      h('div.fr-meta', {}, [fileTime(f.modified), fileSize(f.size)].join(' \u00b7 ')),
      pills.length ? h('div.fr-pills', {}, ...pills.map((p) => h(`span.fr-pill${p === 'Latest' ? '.latest' : /^(Approved|Picked)$/.test(p) ? '.good' : ''}`, {}, p))) : '');
    el.addEventListener('click', () => select(f));
    el.addEventListener('dblclick', () => openIn(f));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === el) openIn(f);
    });
    return el;
  }

  function paint() {
    const counts = new Map<Kind, number>();
    for (const f of files) counts.set(kindOf(f), (counts.get(kindOf(f)) ?? 0) + 1);
    kinds.replaceChildren(...KINDS.filter((k) => k.id === 'all' || counts.get(k.id)).map((k) => {
      const b = h('button', { type: 'button', class: k.id === kind ? 'on' : '' }, k.label, k.id !== 'all' ? h('span.fr-n', {}, String(counts.get(k.id))) : '');
      b.addEventListener('click', () => {
        kind = k.id;
        paint();
      });
      return b;
    }));
    const list = shown();
    const latest = latestLinked(files, data);
    const stamp = JSON.stringify([list.map((f) => [artifactKey(f), f.modified, badges(f, data)]), latest && artifactKey(latest)]);
    if (stamp !== gridStamp) {
      gridStamp = stamp;
      const videos = { n: 0 };
      grid.replaceChildren(...(list.length
        ? sections(list, data, host.workerName).map((s) => h('section.fr-section', {}, h('h3', {}, s.title, h('span.fr-muted', {}, ` ${s.files.length}`)), h('div.fr-tiles', {}, ...s.files.map((f) => tile(f, latest, videos)))))
        : [h('div.fr-empty', {}, h('strong', {}, files.length ? 'No files match' : 'No files yet'), h('p', {}, files.length ? 'Try another kind or search.' : `Images, videos, documents and designs ${host.workerName} links or saves on this floor show up here.`))]));
    }
    for (const t of grid.querySelectorAll<HTMLElement>('.fr-tile')) t.setAttribute('aria-selected', String(!!selected && t.dataset.key === artifactKey(selected)));
  }

  // ---- The one chosen ----
  function select(f: ChatArtifact) {
    const changed = !same(selected, f);
    selected = f;
    paint();
    if (changed) paintSide();
  }
  function paintSide() {
    const f = selected;
    if (!f) {
      side.replaceChildren(h('div.rr-none', {}, h('strong', {}, 'Choose a file'), h('p', {}, 'Its preview shows here. Double-click a file, or press Enter, to open it in its own room.')));
      return;
    }
    const tab = fileTab(f);
    const r = tab && ROOM[tab];
    const stage = h('div.fr-preview');
    const open = r ? h('button.rr-send', { type: 'button' }, `Open in ${r.name}`) : '';
    if (open) open.addEventListener('click', () => openIn(f));
    side.replaceChildren(
      h('div.fr-side-head', {}, h('strong', {}, f.name), h('p.fr-muted', {}, [fileFolder(f), fileSize(f.size), fileTime(f.modified)].filter(Boolean).join(' \u00b7 ')), h('p.fr-muted.fr-path', {}, fileTitle(f))),
      stage,
      h('div.fr-side-actions', {}, open, h('a.rr-ghost.fr-out', { href: host.url(f), target: '_blank', rel: 'noopener' }, 'Open in a new tab \u2197')));
    void previewStage(stage, f, { url: host.url, linked: data.linked ?? [], signal: abort.signal, current: () => same(selected, f) });
  }

  // ---- Keys ----
  function onKey(e: KeyboardEvent): boolean {
    const list = [...grid.querySelectorAll<HTMLElement>('.fr-tile')];
    const at = list.findIndex((t) => selected && t.dataset.key === artifactKey(selected));
    const perRow = Math.max(1, Math.round(grid.querySelector<HTMLElement>('.fr-tiles')!.clientWidth / (list[0]?.offsetWidth || 200)));
    const by = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow }[e.key];
    if (by !== undefined) {
      const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + by))];
      const f = next && files.find((x) => artifactKey(x) === next.dataset.key);
      if (f) {
        select(f);
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
      }
      return true;
    }
    if (e.key === 'Enter' && selected) return openIn(selected), true;
    if (e.key === '/') return search.focus(), true;
    return false;
  }

  const room: RoomHandle = {
    update(next, snapshot) {
      data = snapshot;
      files = sections(next, snapshot, host.workerName).flatMap((s) => s.files);
      if (selected) selected = files.find((f) => same(f, selected)) ?? selected;
      paint();
      if (child) child.room.update(files.filter((f) => fileTab(f) === child!.tab), snapshot);
    },
    show(file) {
      select(files.find((f) => same(f, file)) ?? file);
      if (fileTab(file)) openIn(file);
    },
    close: () => shell.close(),
  };
  room.update(o.files, o.data);
  const first = o.file ?? latestLinked(files, data) ?? files[0];
  if (first) select(first);
  else paintSide();
  return room;
}
