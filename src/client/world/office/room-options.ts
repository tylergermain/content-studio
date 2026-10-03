import { ROOM_DEFAULTS, type FloorRoom } from '../../../shared/floorplan';
import type { Fixture } from './fixture';

// What the floor you're on has of the room's own fittings (see RoomOptions in shared/floorplan.ts): how
// many driving tees, which upstairs, whether the boss's office and the kitchen are there, which walls
// are wood. The office is built once, with everything; each part that a floor can have its own way
// follows this, showing or putting away what the floor has or hasn't.

export interface RoomView {
  /** The room as the floor you're on has it. */
  get(): FloorRoom;
  /** Makes the room what `room` says: every part that goes by it hears. */
  set(room: FloorRoom): void;
  /** `fn` hears the room now, and again whenever it changes. Returns a function that stops it. */
  on(fn: (room: FloorRoom) => void): () => void;
}

declare module '../types' {
  interface OfficeHandles {
    /** The room's own fittings, as the floor you're on has them (see RoomOptions). */
    room: RoomView;
  }
}

/** First on the floor's plan, so every fixture after it can follow it. */
export const roomOptions: Fixture<'room'> = () => {
  let now: FloorRoom = { ...ROOM_DEFAULTS };
  const heard = new Set<(room: FloorRoom) => void>();
  const room: RoomView = {
    get: () => now,
    set(next) {
      if (JSON.stringify(next) === JSON.stringify(now)) return;
      now = { ...next };
      for (const fn of heard) fn(now);
    },
    on(fn) {
      heard.add(fn);
      fn(now);
      return () => heard.delete(fn);
    },
  };
  return { handle: { room } };
};
