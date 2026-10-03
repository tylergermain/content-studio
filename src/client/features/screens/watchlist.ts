// What a screen set to the channels the floor watches plays, and in what order: the choosing and the
// words, with no three.js and no page in them (tests/watch.test.ts), for watch.ts beside this.
import type { WatchVideo } from '../../../shared/protocol/watch';

/** How long a video that wouldn't play (its owner doesn't let it play outside YouTube, or it never started) is left out, in milliseconds. */
export const BAD_FOR = 30 * 60_000;

/**
 * What there is to play of `videos` (newest first): the ones that haven't just failed to. When every
 * one of them has, all of them again: a screen that goes round thumbnails beats a dark one.
 */
export function playable(videos: readonly WatchVideo[], bad: ReadonlyMap<string, number>, now: number): WatchVideo[] {
  const ok = videos.filter((v) => !(now - (bad.get(v.id) ?? -Infinity) < BAD_FOR));
  return ok.length ? ok : [...videos];
}

/**
 * Where the screen in `slot` (0, 1, 2… of the screens watching) starts in a list of `count`: the first
 * on the newest video, the next on the one before it, and so on, so two side by side don't mirror
 * each other. More screens than videos, and they go round again.
 */
export const startAt = (slot: number, count: number): number => (count > 0 ? slot % count : 0);

/** The video after `current`: the next one back in time, and round to the newest again after the oldest. The newest, when `current` isn't in the list any more. */
export function nextVideo(videos: readonly WatchVideo[], current: string | undefined): WatchVideo | undefined {
  if (!videos.length) return undefined;
  return videos[(videos.findIndex((v) => v.id === current) + 1) % videos.length];
}

/** Whether something new is out: the newest of `now` is a video `before` didn't have. */
export function fresh(before: readonly WatchVideo[], now: readonly WatchVideo[]): boolean {
  return now.length > 0 && !before.some((v) => v.id === now[0].id);
}

/** How long ago `at` was, in a couple of characters: "just now", "5m ago", "2h ago", "3d ago", "2w ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  const day = 86_400;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < day) return `${Math.floor(s / 3600)}h ago`;
  if (s < 14 * day) return `${Math.floor(s / day)}d ago`;
  if (s < 60 * day) return `${Math.floor(s / (7 * day))}w ago`;
  if (s < 365 * day) return `${Math.floor(s / (30 * day))}mo ago`;
  return `${Math.floor(s / (365 * day))}y ago`;
}

/** The line under a video: who put it out, what it is, and when. */
export const labelOf = (v: WatchVideo, now: number): string => `${v.channel} · ${v.title} · ${ago(v.at, now)}`;
