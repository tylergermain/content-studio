import './panel.css';
import { store } from '../../../state';
import { h } from '../../dom';
import { STATUS_LABEL, reviewStatus, type SoftwareReviewState } from '../../../../shared/software-review';
import type { Panel, WorkspaceHost } from '../types';
import { loadDrafts, loadReview } from './api';
import { openReviewRoom } from './room';
import { reviewTargets } from './targets';

export { reviewTargets } from './targets';

// Software review (the Review tab; see shared/software-review.ts): the app a worker is running, reviewed
// full screen in the review room (room.ts), which opens as soon as the tab is clicked. The tab itself
// says where the review stands and opens the room again, or, with nothing running yet, how to get the
// app here. The page comes through the office's relay to the worker's server, which adds the small
// script that makes pinning comments work (and does nothing else).

/** What Ask … to run it puts in the message box. */
const RUN_IT = 'Run the app you built on this machine and keep its server running (a dev server, or the built site served on a free port), so I can review it in the office.';

export function softwareReview(host: WorkspaceHost): Panel {
  let state: SoftwareReviewState | undefined;
  let seen = '';
  const body = h('div.rv-panel-body');
  const element = h('div.ws-review', {}, body);

  const openRoom = (target?: string) => openReviewRoom(host, { target, onClose: () => void load() });
  const load = () => loadReview(host.workerId).then((s) => {
    state = s;
    paint();
  }, () => undefined);

  function paint() {
    const targets = reviewTargets(host.workerId);
    const stamp = JSON.stringify([targets.map((t) => t.key), state, host.canSend()]);
    if (stamp === seen) return;
    seen = stamp;
    if (!targets.length) {
      const ask = h('button.btn.primary.small', { type: 'button', disabled: !host.canSend() }, `Ask ${host.workerName} to run it`);
      ask.addEventListener('click', () => host.draft(RUN_IT));
      body.replaceChildren(h('div.rv-empty', {},
        h('span.rv-icon', { 'aria-hidden': 'true' }, '\u{1f9ea}'),
        h('strong', {}, 'No app running yet'),
        h('p', {}, `When ${host.workerName} runs its app on this machine (npm run dev, or a built site served on a port), you review it here full screen: use it at any size, press C and click anything to pin a comment, and send them all back. A site published somewhere else doesn’t show here.`),
        ask));
      return;
    }
    const s = state ?? { rounds: [], comments: [] };
    const st = reviewStatus(s);
    const open = s.comments.filter((c) => !c.done).length;
    const drafts = loadDrafts(host.workerId).length;
    const start = h('button.btn.primary', { type: 'button' }, 'Open review ⤢');
    start.addEventListener('click', () => openRoom());
    body.replaceChildren(h('div.rv-summary', {},
      h('span.rv-state', { 'data-state': st }, STATUS_LABEL[st]),
      h('strong.rv-title', {}, targets.length === 1 ? targets[0].label : `${targets.length} apps running`),
      h('p.rv-counts', {}, [drafts && `${drafts} not sent`, `${open} open`, `${s.comments.length - open} done`, s.rounds.length && `${s.rounds.length} round${s.rounds.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')),
      start,
      targets.length > 1 ? h('ul.rv-apps', {}, ...targets.map((t) => {
        const b = h('button.link-button', { type: 'button' }, t.label);
        b.addEventListener('click', () => openRoom(t.key));
        return h('li', {}, b);
      })) : null,
      h('p.rv-hint', {}, 'Opens full screen. Press C in it to comment, Esc to come back.')));
  }

  const off = store.on('services', paint);
  void load();
  return {
    element,
    paint() {
      paint();
    },
    open() {
      if (reviewTargets(host.workerId).length) openRoom();
    },
    show() {
      /* a review isn't of a file */
    },
    stop() {
      off();
    },
  };
}
