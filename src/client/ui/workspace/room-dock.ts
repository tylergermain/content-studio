import './room-dock.css';

// What the review queue (ui/review-queue/) puts in a review room it opens: a strip over the room's top bar with the
// item's place in the queue and the queue's own controls, and the keys for them, which no room uses itself (] and [
// for the next and previous item, Shift+A to approve). Every room asks for it as it opens (room-shell.ts, and the
// screening and review rooms, which build their own frames); with no queue open there's none.

export interface RoomDock {
  /** A strip for one room (a room over another, as Files opens one, gets its own). */
  bar(): HTMLElement;
  /** A key not typed into anything: true when the queue used it. */
  key(e: KeyboardEvent): boolean;
}

let dock: RoomDock | undefined;

/** The queue's dock while it's opening rooms; undefined puts it away. */
export function setRoomDock(d: RoomDock | undefined) {
  dock = d;
}

export function roomDock(): RoomDock | undefined {
  return dock;
}
