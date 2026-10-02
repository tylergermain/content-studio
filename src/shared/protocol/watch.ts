// The channels a floor watches (see StudioSetup.watch in shared/studio.ts): the newest videos from
// each, which the office reads from YouTube's public feeds (server/watch.ts) and the floor's video
// screens play (client/features/screens).

/** A video one of the watched channels put out. */
export interface WatchVideo {
  /** Its YouTube id. */
  id: string;
  title: string;
  /** What the channel calls itself. */
  channel: string;
  /** When it was published. */
  at: number;
  /** It's a Short: taller than it's wide. */
  short: boolean;
}

export interface WatchState {
  /** Newest first, across every channel the floor watches. */
  videos: WatchVideo[];
  /** When the channels were last read, or 0 before the first time. */
  at: number;
  /** Why a channel couldn't be read, by its link in the floor's setup. */
  errors?: Record<string, string>;
}

export const NO_WATCH: WatchState = { videos: [], at: 0 };

export type WatchServerMsg =
  /** What the channels your floor watches have out now. */
  { t: 'watch'; watch: WatchState };
