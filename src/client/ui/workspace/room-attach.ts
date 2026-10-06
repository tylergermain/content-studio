import type { ChatArtifact, ChatSnapshot } from '../../../shared/worker-chat';
import type { Panel } from './types';

// A tab that opens a full-screen review room (room-shell.ts) over the worker's window: clicking the tab opens it, a
// link in the chat to one of its files opens it on that file, and the room hears from the office whenever the window
// does. The tab's own panel stays as it was, underneath, for when the room is closed.

/** A room open over the window. */
export interface RoomHandle {
  update(files: ChatArtifact[], data: ChatSnapshot): void;
  show(file: ChatArtifact): void;
  close(): void;
}
export type RoomOpener = (o: { files: ChatArtifact[]; data: ChatSnapshot; file?: ChatArtifact; onClose(): void }) => RoomHandle;

export function withRoom(panel: Panel, open: RoomOpener): Panel {
  let files: ChatArtifact[] = [];
  let data: ChatSnapshot | undefined;
  let room: RoomHandle | undefined;
  const launch = (file?: ChatArtifact) => {
    if (!data || (!files.length && !file)) return;
    if (room) return file && room.show(file);
    room = open({ files, data, file, onClose: () => (room = undefined) });
  };
  return {
    ...panel,
    paint(next, snapshot) {
      files = next;
      data = snapshot;
      panel.paint(next, snapshot);
      room?.update(next, snapshot);
    },
    open: () => launch(),
    show(file) {
      panel.show(file);
      launch(file);
    },
    stop() {
      room?.close();
      panel.stop();
    },
  };
}
