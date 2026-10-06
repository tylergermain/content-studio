import { store } from '../../state';
import type { ReviewItem } from '../../../shared/review-queue';
import { artifactKey, type ChatArtifact, type ChatSnapshot } from '../../../shared/worker-chat';
import { fileTab, type WorkspaceTab } from '../../../shared/workspace';
import { chatRequest, chatUrl, reviewRequest } from '../worker-chat/api';
import { everyFile } from '../workspace';
import { openBoardRoom } from '../workspace/board/room';
import { openCanvasRoom } from '../workspace/canvas/room';
import { openFilesRoom } from '../workspace/files-room';
import { openReaderRoom } from '../workspace/reader/room';
import type { RoomHandle } from '../workspace/room-attach';
import { closeReviewRoom, openReviewRoom } from '../workspace/review/room';
import { reviewTargets } from '../workspace/review/targets';
import { openScreeningRoom } from '../workspace/screening/room';
import type { WorkspaceHost } from '../workspace/types';

// A review queue item's work in its app's room (panel.ts), for a worker on this floor: the room the worker's own
// window would open, on the file the item is about, kept up to date as its window would be.

const POLL_MS = 3000;
type Opener = (host: WorkspaceHost, o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }) => RoomHandle;
const OPENERS: Record<Exclude<WorkspaceTab, 'review'>, Opener> = {
  watch: openScreeningRoom,
  board: openBoardRoom,
  read: openReaderRoom,
  canvas: openCanvasRoom,
  files: openFilesRoom,
};

const filesFor = (app: WorkspaceTab, data: ChatSnapshot) => (app === 'files' ? everyFile(data) : everyFile(data).filter((f) => fileTab(f) === app));

/** What there is to show an item in, of the apps: the ones with its kind of file (or its app running), and Files. */
export function appsFor(item: ReviewItem, data?: ChatSnapshot): WorkspaceTab[] {
  const kinds = new Set([...item.files, ...(data ? everyFile(data) : [])].map((f) => fileTab(f)));
  const out: WorkspaceTab[] = [item.app];
  for (const t of ['watch', 'board', 'read', 'canvas'] as const) if (kinds.has(t) && !out.includes(t)) out.push(t);
  if (reviewTargets(item.workerId).length && !out.includes('review')) out.push('review');
  if (!out.includes('files')) out.push('files');
  return out;
}

/** Opens an item in `app`; `onClose` hears it close, however it does. What closes it, or why it couldn't open. */
export async function openItem(item: ReviewItem, app: WorkspaceTab, onClose: () => void): Promise<{ close(): void } | string> {
  if (item.floor !== store.floor) return `${item.workerName} is on ${item.floorName}`;
  const id = item.workerId;
  let data: ChatSnapshot;
  try {
    data = await chatRequest<ChatSnapshot>(id);
  } catch (e) {
    return e instanceof Error ? e.message : `${item.workerName} can't be reached`;
  }
  let closed = false;
  let room: RoomHandle | undefined;
  // Nothing of that kind left to show (or its app stopped): Files has whatever there is.
  if (app === 'review' ? !reviewTargets(id).length : app !== 'files' && !filesFor(app, data).length) app = 'files';
  const refresh = async () => {
    try {
      data = await chatRequest<ChatSnapshot>(id);
      if (!closed) room?.update(filesFor(app, data), data);
    } catch {
      // the next one
    }
  };
  const host: WorkspaceHost = {
    workerId: id,
    workerName: item.workerName,
    get admin() {
      return store.me.admin;
    },
    canSend: () => data.canSend !== false,
    url: (f) => chatUrl(id, '/file', f.path, f.root),
    review: async (r) => {
      await reviewRequest(id, { ...r, requestId: crypto.randomUUID() });
      if (!closed) await refresh();
    },
    refresh,
    // There's no message box here to put a draft in: its window has one.
    draft: () => {},
  };
  const timer = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
  const done = () => {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    onClose();
  };
  if (app === 'review') openReviewRoom(host, { onClose: done });
  else {
    const all = everyFile(data);
    const file = item.files.map((f) => all.find((x) => artifactKey(x) === artifactKey(f))).find((f) => !!f && (app === 'files' || fileTab(f) === app));
    room = OPENERS[app](host, { files: filesFor(app, data), data, ...(file ? { file } : {}), onClose: done });
  }
  return {
    close: () => {
      if (closed) return;
      if (app === 'review') closeReviewRoom();
      else room?.close();
      done();
    },
  };
}
