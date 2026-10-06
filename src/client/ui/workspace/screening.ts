import './screening.css';
import { h } from '../dom';
import { STATUS_LABEL } from '../../../shared/software-review';
import { artifactKey, type ChatArtifact, type ChatSnapshot } from '../../../shared/worker-chat';
import { versionLabel } from '../../../shared/workspace';
import { fileItem, latestLinked, reviewsOf, sections } from './files';
import { draftKey, loadDraft } from './notes';
import { openScreeningRoom, type ScreeningRoom } from './screening/room';
import type { Panel, WorkspaceHost } from './types';

// The Watch tab, the Video Editor's screening room. The cuts are reviewed full screen in the screening room
// (screening/room.ts), which opens as soon as the tab is clicked, or a cut is opened from a link in the chat. The tab
// itself lists the cuts, newest first, with where the latest one's review stands and Open screening room.

/** The screening room's tab: one panel of the workspace (index.ts), for the Watch tab's video and audio. */
export function screeningRoom(host: WorkspaceHost): Panel {
  let data: ChatSnapshot | undefined;
  let files: ChatArtifact[] = [];
  let room: ScreeningRoom | undefined;
  const body = h('div.sv-body');
  const element = h('div.ws-panel.screening', { tabindex: '-1', 'aria-label': 'Screening room' }, body);

  const nameOf = (f: ChatArtifact) => versionLabel(f.path) ?? f.name;
  const newest = () => (data ? latestLinked(files.filter((f) => f.type.startsWith('video/')), data) ?? latestLinked(files, data) ?? files[0] : undefined);

  function openRoom(file?: ChatArtifact) {
    if (!data || !files.length) return;
    if (room) {
      if (file) room.show(file);
      return;
    }
    room = openScreeningRoom(host, { files, data, file, onClose: () => { room = undefined; paintTab(); } });
  }

  function paintTab() {
    if (!data || !files.length) {
      body.replaceChildren(h('div.sv-empty', {},
        h('span.sv-icon', { 'aria-hidden': 'true' }, '\u25b6'),
        h('strong', {}, 'Nothing to watch yet'),
        h('p', {}, `When ${host.workerName} links a render in a reply, it opens here full screen, with your notes at their moments beside it.`)));
      return;
    }
    const latest = newest()!;
    const approved = reviewsOf(latest, data).some((r) => r.kind === 'approve');
    const notesSent = reviewsOf(latest, data).some((r) => r.kind === 'notes');
    const st = approved ? 'approved' : notesSent ? 'changes' : 'new';
    const unsent = files.reduce((n, f) => n + loadDraft(draftKey(host.workerId, f)).length, 0);
    const start = h('button.btn.primary', { type: 'button' }, 'Open screening room \u2922');
    start.addEventListener('click', () => openRoom());
    const list = h('div.sv-cuts');
    for (const s of sections(files, data, host.workerName)) {
      list.append(h('div.screening-section', {}, s.title));
      for (const f of s.files) list.append(fileItem(f, { data, url: host.url, selected: false, latest: artifactKey(f) === artifactKey(latest), onClick: () => openRoom(f) }));
    }
    body.replaceChildren(h('div.sv-summary', {},
      h('span.rv-state.sv-state', { 'data-state': st }, STATUS_LABEL[st]),
      h('strong.sv-title', {}, `${nameOf(latest)}${versionLabel(latest.path) ? ` \u00b7 ${latest.name}` : ''}`),
      unsent ? h('p', {}, `${unsent} note${unsent === 1 ? '' : 's'} not sent yet`) : null,
      start,
      h('p.sv-hint', {}, 'Opens full screen. Space plays, N writes a note at the moment, Esc comes back.')),
      files.length > 1 ? list : '');
  }

  return {
    element,
    paint(next, snapshot) {
      data = snapshot;
      files = next.filter((f) => /^(video|audio)\//.test(f.type));
      room?.update(files, snapshot);
      paintTab();
    },
    open() {
      openRoom();
    },
    show(file) {
      openRoom(file);
    },
    stop() {
      room?.close();
    },
  };
}
