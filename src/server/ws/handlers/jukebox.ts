// The lounge jukebox on every floor.
import type { Floor } from '../../floor.js';
import { JUKEBOX_TUNES, STREAM } from '../../../shared/jukebox.js';
import { lookUpVideo } from '../../jukebox-video.js';
import type { JukeboxClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const jukeboxView: ViewPieces['jukebox'] = (_ctx, floor) => floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 };
export const jukeboxChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });

export const jukeboxHandlers = {
  'jukebox.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.jukebox.play({ track: msg.track, url: msg.url, name: msg.name }, who);
    if ('error' in r) return ctx.warn(c, r.error);
    if ('video' in r) {
      // A YouTube link: ask YouTube what it is and whether the lounge TV may play it, then put it on.
      void lookUpVideo(r.video).then((video) => {
        if ('error' in video) return ctx.warn(c, video.error);
        // The floor was taken away while YouTube was answering.
        if (ctx.floors.get(floor.id) !== floor) return;
        floor.jukebox.playVideo(video, msg.name, who);
        jukeboxChanged(ctx, floor);
        const s = floor.jukebox.state();
        ctx.toastFloor(floor, `📺 ${who} put ${floor.jukebox.title()} on the lounge TV${s.video?.title && s.video.title !== floor.jukebox.title() ? `: “${s.video.title}”` : ''}`);
      });
      return;
    }
    if (!r.changed) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, floor.jukebox.state().track === STREAM ? `📻 ${who} tuned the jukebox to ${floor.jukebox.title()}` : `🎵 ${who} put on “${floor.jukebox.title()}”`);
  },
  'jukebox.skip'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    floor.jukebox.skip(who);
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, `⏭️ ${who} skipped to “${floor.jukebox.title()}”`);
  },
  'jukebox.stop'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor || !floor.jukebox.stop(who)) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, `🔇 ${who} turned the jukebox off`);
  },
} satisfies HandlerMap<JukeboxClientMsg>;
