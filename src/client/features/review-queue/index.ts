/**
 * The review queue (ui/review-queue/panel.ts) in the 3D office: \u2630 \u203a Review queue, with how many finished tasks are
 * waiting beside it (pin it to keep it on the top bar). One on another floor is opened by riding there first, then
 * opening the queue on it again once you've arrived.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { whenReady as when } from '../../ui/agents/panel';
import { addHudAction } from '../../ui/menu';
import { openReviewQueue } from '../../ui/review-queue/panel';
import type { ReviewItem } from '../../../shared/review-queue';

const COUNT_MS = 20_000;

export function installReviewQueue(ctx: Ctx, deps: { openWorker(id: string): void; switchFloor(floorId: string): void }) {
  let waiting = 0;
  const count = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch('/api/review-queue?count', { credentials: 'same-origin', cache: 'no-store' });
      const n = res.ok ? Number((await res.json()).waiting) || 0 : waiting;
      if (n !== waiting) {
        waiting = n;
        ctx.hud.refresh();
      }
    } catch {
      // the next time
    }
  };
  void count();
  window.setInterval(() => void count(), COUNT_MS);

  const there = (i: ReviewItem, then: () => void) => {
    if (i.floor === store.floor) return then();
    deps.switchFloor(i.floor);
    when(() => store.floor === i.floor && store.workers.has(i.workerId), then);
  };
  function show(o: { start?: string; open?: boolean } = {}) {
    if (document.querySelector('.queue-room')) return;
    openReviewQueue({
      openWorker: (i) => there(i, () => deps.openWorker(i.workerId)),
      goTo: (i, open) => there(i, () => show({ start: i.id, open })),
    }, o);
    window.setTimeout(() => void count(), 1500);
  }

  addHudAction({
    id: 'review-queue',
    icon: '\u{1f4e5}',
    label: 'Review queue',
    section: 'Open',
    count: () => waiting,
    tone: () => (waiting ? 'primary' : undefined),
    title: () => 'Every agent\u2019s finished work, office-wide, to approve, send notes on or dismiss, each in the app that suits it',
    run: () => show(),
  });
}
