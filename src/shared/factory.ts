// The Software Factory's rooms (server/factory-rooms.ts, client/ui/rooms/): what the Rooms panel shows of each.
// No Node and no DOM here: both sides read it.

export interface RoomView {
  /** The project-room piece's id. */
  id: string;
  name: string;
  /** owner/name of the GitHub repository it's for. */
  repo?: string;
  dir?: string;
  /** Its folder is a git checkout: whoever's hired there works in a worktree of it. */
  git?: boolean;
  /** Being set up for this repository now (cloning). */
  cloning?: string;
  /** Why setting it up last didn't work. */
  error?: string;
  /** How many chairs it has at its tables, and the first free one. */
  seats: number;
  free?: string;
  agents: { id: string; name: string; status: string }[];
}
