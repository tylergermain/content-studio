/** Where the floor's workers meet (the glass room, the stage or the anchor desk): E there (or 🤝 in the menu) opens its window, how the meeting's going or the form to call one. */
import { meetingPlace } from '../../../shared/meeting-place';
import { MEETING_PATTERNS, meetingStage } from '../../../shared/meetings';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { clip } from '../../ui/dom';
import { openMeeting, type MeetingPreset } from '../../ui/meeting';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    meeting: true;
  }
}

export function installMeeting(ctx: Ctx, parts: Pick<Parts, 'waiting' | 'actions'>) {
  /** The meeting room's window: how the meeting's going, or the form to call one (prefilled from an issue or a PR). */
  function showMeeting(preset?: MeetingPreset) {
    openMeeting(
      ctx.net,
      {
        openTerminal: (id) => parts.waiting.openWorkerTerminal(id),
        openPr: (id) => {
          const w = store.workers.get(id);
          if (w) parts.actions.pullRequestFor(w);
        },
      },
      preset,
    );
  }

  ctx.interactions.define('meeting', {
    reach: 7,
    hint: () => {
      const m = store.meeting.current;
      const p = m && MEETING_PATTERNS[m.pattern];
      const what = !m || !p ? 'free' : m.status === 'running' ? `${p.icon} ${p.label} · ${meetingStage(m)}` : `${p.icon} ${p.label} ${m.status === 'done' ? 'done ✅' : 'stopped ⛔'}`;
      // Named for the place the floor you're on has (see RoomOptions.meeting).
      const title = meetingPlace(ctx.office.room.get()).title;
      return { k: `${title} ${what}`, parts: [hintTitle(title), aside(clip(what, 50)), key('E', m?.status === 'running' ? 'See how it’s going' : m ? 'See it / call a meeting' : 'Call a meeting')] };
    },
    use: onE(() => showMeeting()),
  });

  return { showMeeting };
}
