/**
 * The screens set to play the channels the floor watches (Piece.media is WATCH_MEDIA): the newest videos
 * from those channels (store.watch, read by the office: see server/watch.ts), through YouTube's own
 * player on the screen's face (world/webscreen.ts). Newest first and on to the next when one ends, each
 * screen starting on a different one, and back to the newest whenever something new comes out.
 */
import type * as THREE from 'three';
import type { WatchVideo } from '../../../shared/protocol/watch';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { store } from '../../state';
import { clip, toast } from '../../ui/dom';
import { webScreen, type WebScreen } from '../../world/webscreen';
import { channelsCard } from './card';
import { freeSlot } from './playlist';
import { openWatchWindow } from './ui';
import { fresh, labelOf, nextVideo, playable, startAt } from './watchlist';

/** A screen that's watching: the player on its face, and where it is in the list. */
interface Tuned {
  screen: WebScreen;
  /** Which of the watching screens it is (see startAt). */
  slot: number;
  video: WatchVideo | null;
  /** Kept this frame (see keep and sweep). */
  kept: boolean;
  /** The line under the video, and the second it was written for. */
  label: string;
  labelled: number;
}

const WHERE = 'Office builder (U) › Set up the floor › Channels to watch';

export class WatchScreens {
  private readonly tuned = new Map<string, Tuned>();
  private videos: readonly WatchVideo[] = store.watch.videos;
  /** What wouldn't play here, and when it didn't. */
  private readonly bad = new Map<string, number>();
  private card: { key: string; texture: THREE.CanvasTexture } | null = null;

  constructor(private readonly ctx: Ctx) {
    store.on('watch', () => this.heard());
  }

  /**
   * Each frame, for a piece set to watch: keeps a player on `face` (a new mesh whenever the piece is
   * built again). What's handed back is the card for the face under it while there's nothing to play
   * (where channels are added, or why they can't be read), or null for a dark one.
   */
  keep(id: string, face: THREE.Mesh): THREE.Texture | null {
    let t = this.tuned.get(id);
    if (!t) {
      const made: Tuned = { screen: webScreen(this.ctx, face, { title: () => this.label(made) }), slot: freeSlot([...this.tuned.values()].map((o) => o.slot)), video: null, kept: true, label: '', labelled: -1 };
      made.screen.onEnded((why) => this.ended(made, why));
      this.tuned.set(id, (t = made));
      this.tune(t);
    }
    t.kept = true;
    t.screen.attach(face);
    return t.video ? null : this.idle();
  }

  /** After a frame's pieces: lets go of every screen that wasn't kept (its piece is gone, or plays something else now). */
  sweep() {
    for (const [id, t] of this.tuned) {
      if (!t.kept) {
        t.screen.dispose();
        this.tuned.delete(id);
      }
      t.kept = false;
    }
  }

  /** Lets go of every player: you've left the floor. */
  leave() {
    for (const t of this.tuned.values()) t.screen.dispose();
    this.tuned.clear();
    this.bad.clear();
    this.card?.texture.dispose();
    this.card = null;
  }

  /** What the hint bar says of the piece `id`, when it's a screen that's watching. */
  hint(id: string | undefined): Hint | undefined {
    const t = id ? this.tuned.get(id) : undefined;
    if (!t) return undefined;
    const v = t.video;
    if (!v) return { k: 'watch', parts: [hintTitle('📺 Channels we watch'), aside(store.studio.setup.watch?.channels.length ? 'Nothing to play yet' : 'No channels yet')] };
    return { k: `watch:${v.id}`, parts: [hintTitle(`📺 ${v.channel}`), aside(clip(v.title, 70)), key('E', 'Watch with sound')] };
  }

  /** E at the piece `id`: opens what's on it in a window, with its sound. Whether it's a screen that's watching at all. */
  open(id: string | undefined): boolean {
    const t = id ? this.tuned.get(id) : undefined;
    if (!t) return false;
    if (t.video) openWatchWindow(t.video, t.screen.time());
    else toast(`📺 An admin adds the channels to watch: ${WHERE}`);
    return true;
  }

  private list(): WatchVideo[] {
    return playable(this.videos, this.bad, Date.now());
  }

  /** Puts `t` on the video its slot starts on. */
  private tune(t: Tuned) {
    const list = this.list();
    this.play(t, list[startAt(t.slot, list.length)]);
  }

  private play(t: Tuned, video: WatchVideo | undefined) {
    t.video = video ?? null;
    t.labelled = -1;
    t.screen.show(video ? { id: video.id } : null);
  }

  /** A video came to its end, or couldn't be played: on to the one after it. */
  private ended(t: Tuned, why: 'ended' | 'error') {
    const was = t.video?.id;
    if (why === 'error' && was) this.bad.set(was, Date.now());
    this.play(t, nextVideo(this.list(), was));
  }

  /** The office has read the channels again. */
  private heard() {
    const before = this.videos;
    this.videos = store.watch.videos;
    const list = this.list();
    for (const t of this.tuned.values()) {
      // Something new is out: every screen back to where it starts, the first of them on the newest.
      // And a screen whose video has dropped off the list goes back there too.
      if (fresh(before, this.videos) || !t.video || !list.some((v) => v.id === t.video!.id)) this.tune(t);
    }
  }

  /** The line under `t`'s video, written again each second ("2h ago" moves on). */
  private label(t: Tuned): string {
    const second = Math.floor(Date.now() / 1000);
    if (t.labelled !== second) {
      t.labelled = second;
      t.label = t.video ? labelOf(t.video, second * 1000) : '';
    }
    return t.label;
  }

  /** The card for a watching screen with nothing to play: where channels go, that they're being read, or why they can't be. */
  private idle(): THREE.CanvasTexture {
    const channels = store.studio.setup.watch?.channels ?? [];
    const errors = Object.values(store.watch.errors ?? {});
    const say = !channels.length
      ? { title: 'No channels to watch yet', lead: 'An admin adds them in', boxed: [WHERE], foot: 'The newest video from each channel plays here, through YouTube’s own player' }
      : errors.length
        ? { title: 'Can’t read the channels', lead: 'YouTube said', boxed: [...new Set(errors)].slice(0, 3).map((e) => clip(e, 70)), foot: `An admin can check the links: ${WHERE}` }
        : { title: store.watch.at ? 'Nothing new to play' : 'Reading the channels…', lead: `Watching ${channels.length === 1 ? 'one channel' : `${channels.length} channels`}`, boxed: channels.slice(0, 5).map((c) => clip(c.name || c.url.replace(/^https:\/\/www\./, ''), 54)), foot: 'The newest video from each channel plays here, through YouTube’s own player' };
    const k = JSON.stringify(say);
    if (this.card?.key !== k) {
      this.card?.texture.dispose();
      this.card = { key: k, texture: channelsCard(say) };
    }
    return this.card.texture;
  }
}
