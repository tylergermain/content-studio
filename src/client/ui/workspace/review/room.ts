import '../room.css';
import { h, openModal } from '../../dom';
import { store } from '../../../state';
import { DEVICES, REVIEW_START, REVIEW_TAG, STATUS_LABEL, reviewStatus, type DeviceId, type ReviewPick, type SoftwareReviewState } from '../../../../shared/software-review';
import type { WorkspaceHost } from '../types';
import { approve, loadReview, markDone, myName, sendRound } from './api';
import { reviewComments, type Spot } from './comments';
import { appAddress, plainUrl, relayBase, reviewTargets, type ReviewTarget } from './targets';

// The review room: Software review full screen, the way Frame.io reviews a cut. The app sits on a dark
// stage at a device's size, with Use app / Comment (C) under it; the comments are down the right
// (comments.ts); the top bar has the page, the sizes, where the review stands and Approve. Esc steps
// back out: a comment being written, then comment mode, then the room.

type Size = DeviceId | 'fit';
const SIZES: { id: Size; label: string; key: string }[] = [...DEVICES.map((d, i) => ({ id: d.id as Size, label: d.label, key: String(i + 1) })), { id: 'fit', label: 'Fit', key: String(DEVICES.length + 1) }];
const SIZE_KEY = 'agent-office:review-size';
const POLL_MS = 10_000;

let current: { close(): void } | undefined;

/** Opens the review room for `host`'s worker, on `target` (a ReviewTarget key) or its first app. */
export function openReviewRoom(host: WorkspaceHost, opts: { target?: string; onClose?: () => void } = {}): void {
  current?.close();
  let targets: ReviewTarget[] = reviewTargets(host.workerId);
  let target: ReviewTarget | undefined;
  let page = '/';
  let ready = false;
  let commentable = false;
  let commenting = false;
  let revealAfterLoad: Spot | undefined;
  let state: SoftwareReviewState = { rounds: [], comments: [] };
  let size: Size = (() => {
    try {
      const v = localStorage.getItem(SIZE_KEY);
      return SIZES.some((s) => s.id === v) ? (v as Size) : 'laptop';
    } catch {
      return 'laptop';
    }
  })();

  // ---- The frame ----
  const close = h('button.rr-close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const appName = h('strong');
  const pick = h('select.rr-pick', { 'aria-label': 'App' }) as HTMLSelectElement;
  const back = h('button.rr-btn', { type: 'button', title: 'Back', 'aria-label': 'Back' }, '←');
  const reload = h('button.rr-btn', { type: 'button', title: 'Reload', 'aria-label': 'Reload' }, '⟳');
  const address = h('input.rr-address', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Page' }) as HTMLInputElement;
  const sizes = h('div.rr-sizes', { role: 'group', 'aria-label': 'Size' }, ...SIZES.map((s) => {
    const b = h('button', { type: 'button', 'data-size': s.id, title: `${s.label} (${s.key})` }, s.label);
    b.addEventListener('click', () => setSize(s.id));
    return b;
  }));
  const pill = h('span.rr-state');
  const approveBtn = h('button.rr-approve', { type: 'button' });
  const openOut = h('a.rr-btn', { target: '_blank', rel: 'noopener', title: 'Open it in a tab of its own', 'aria-label': 'Open in a new tab' }, '↗');
  const frame = h('iframe.rr-frame', { title: 'App under review', allow: 'clipboard-read; clipboard-write' }) as HTMLIFrameElement;
  const device = h('div.rr-device', {}, frame);
  const useBtn = h('button', { type: 'button', 'aria-pressed': 'true', title: 'Use the app as it is' }, h('span.rr-mode-icon', { 'aria-hidden': 'true' }, '↖'), 'Use app');
  const commentBtn = h('button', { type: 'button', 'aria-pressed': 'false', title: 'Click anything in the app to comment on it (C)' }, h('span.rr-mode-icon', { 'aria-hidden': 'true' }, '\u{1f4ac}'), 'Comment', h('kbd', {}, 'C'));
  const modes = h('div.rr-modes', { role: 'group', 'aria-label': 'Mode' }, useBtn, commentBtn);
  const notice = h('div.rr-notice.hidden');
  const banner = h('p.rr-banner.hidden');
  const stage = h('div.rr-stage', {}, banner, device, notice, modes);

  const comments = reviewComments({
    workerId: host.workerId,
    workerName: host.workerName,
    me: myName,
    canSend: () => host.canSend(),
    where: () => (target ? { app: appAddress(target), page } : undefined),
    focus: (s) => tell({ t: 'focus', selector: s && target && s.app === appAddress(target) && s.page === page ? s.selector : '' }),
    reveal,
    changed: () => {
      // A comment just added (or a pick let go of) takes the selection off its element.
      pins(comments.hasPick());
      paintTop();
    },
    async send(drafts) {
      if (!target) return;
      const d = DEVICES.find((x) => x.id === size);
      const seen = d ? { w: d.w, h: d.h, label: d.label } : { w: frame.offsetWidth, h: frame.offsetHeight };
      setState(await sendRound(host.workerId, appAddress(target), seen, drafts.map(({ text, page: p, what, selector }) => ({ text, page: p, what, selector }))));
      void host.refresh();
    },
    async done(id, done) {
      setState(await markDone(host.workerId, id, done));
    },
  });

  const root = h('div.review-room', { role: 'dialog', 'aria-label': `Review ${host.workerName}’s app`, tabindex: '-1' },
    h('header.rr-top', {},
      h('div.rr-left', {}, close, h('div.rr-title', {}, appName, h('span', {}, host.workerName)), pick),
      h('div.rr-nav', {}, back, reload, address),
      h('div.rr-right', {}, sizes, pill, approveBtn, openOut)),
    h('div.rr-body', {}, stage, comments.element));

  // ---- Talking to the page ----
  const tell = (m: Record<string, unknown>) => {
    if (!commentable || !frame.contentWindow || !frame.src) return;
    try {
      frame.contentWindow.postMessage({ ...m, tag: REVIEW_TAG }, new URL(frame.src).origin);
    } catch {
      /* not loaded yet */
    }
  };
  const pins = (keep = true) => target && tell({ t: 'pins', pins: comments.pins(appAddress(target), page), keep });

  function onMessage(e: MessageEvent) {
    const m = e.data;
    if (e.source !== frame.contentWindow || !m || m.tag !== REVIEW_TAG) return;
    if (m.t === 'ready' || m.t === 'where') {
      ready = true;
      if (typeof m.page === 'string' && m.page !== page) {
        page = m.page;
        comments.paint();
      }
      if (document.activeElement !== address) address.value = page;
      tell({ t: 'comment', on: commenting });
      pins(false);
      if (revealAfterLoad && revealAfterLoad.page === page) {
        tell({ t: 'reveal', selector: revealAfterLoad.selector });
        tell({ t: 'focus', selector: revealAfterLoad.selector });
        revealAfterLoad = undefined;
      }
    } else if (m.t === 'picked' && m.pick && commenting) {
      comments.pick({ pick: m.pick as ReviewPick, page: typeof m.page === 'string' ? m.page : page });
      pins();
    } else if (m.t === 'key' && (m.key === 'Escape' || m.key === 'c')) {
      onKey(new KeyboardEvent('keydown', { key: m.key }));
    }
  }

  function open(t: ReviewTarget, path = '/') {
    target = t;
    ready = false;
    page = path;
    address.value = path;
    appName.textContent = t.label.replace(/ · port \d+$/, '');
    appName.title = t.label;
    const base = t.port ? relayBase(t.port) : undefined;
    commentable = !!base;
    if (!commentable) setCommenting(false);
    const url = base ? `${base}${REVIEW_START}?${new URLSearchParams({ office: location.origin, next: path })}` : plainUrl(t, path);
    frame.src = url;
    openOut.setAttribute('href', base ? `${base}${path}` : plainUrl(t, path));
    banner.textContent = t.direct
      ? 'This app is outside the office, so it shows as it is. Comments here are about each page as a whole.'
      : base ? '' : 'To pin comments to what you click, open the office on its tailnet address or on its own machine. Comments here are about each page as a whole.';
    banner.classList.toggle('hidden', !banner.textContent);
    notice.classList.add('hidden');
    device.hidden = false;
    paintTop();
    comments.paint();
  }

  function reveal(s: Spot) {
    if (!target || s.app !== appAddress(target)) {
      const t = targets.find((x) => appAddress(x) === s.app);
      if (!t) return;
      revealAfterLoad = s;
      return open(t, s.page);
    }
    if (s.page !== page) {
      revealAfterLoad = s;
      return ready && commentable ? tell({ t: 'go', path: s.page }) : open(target, s.page);
    }
    tell({ t: 'reveal', selector: s.selector });
    tell({ t: 'focus', selector: s.selector });
  }

  // ---- Sizes ----
  function layout() {
    const d = DEVICES.find((x) => x.id === size);
    // The stage's padding (room.css) leaves the mode buttons room under the app.
    const narrow = innerWidth <= 960;
    const W = stage.clientWidth - (narrow ? 32 : 64), H = stage.clientHeight - (narrow ? 92 : 108) - (banner.classList.contains('hidden') ? 0 : banner.offsetHeight + 12);
    for (const b of sizes.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.size === size);
    if (!d) {
      Object.assign(frame.style, { width: `${Math.max(320, W)}px`, height: `${Math.max(240, H)}px`, transform: '' });
      Object.assign(device.style, { width: '', height: '' });
      return;
    }
    const s = Math.min(1, W / d.w, H / d.h);
    Object.assign(frame.style, { width: `${d.w}px`, height: `${d.h}px`, transform: s < 1 ? `scale(${s})` : '' });
    Object.assign(device.style, { width: `${d.w * s}px`, height: `${d.h * s}px` });
  }
  function setSize(id: Size) {
    size = id;
    try {
      localStorage.setItem(SIZE_KEY, id);
    } catch {
      /* a private window */
    }
    layout();
  }
  const resize = new ResizeObserver(layout);
  resize.observe(stage);

  // ---- Modes ----
  function setCommenting(on: boolean) {
    commenting = on && commentable && host.canSend() && !!target;
    commentBtn.setAttribute('aria-pressed', String(commenting));
    useBtn.setAttribute('aria-pressed', String(!commenting));
    commentBtn.disabled = !commentable || !host.canSend();
    root.classList.toggle('commenting', commenting);
    tell({ t: 'comment', on: commenting });
    if (!commenting && comments.hasPick()) comments.clearPick(), pins(false);
  }
  useBtn.addEventListener('click', () => setCommenting(false));
  commentBtn.addEventListener('click', () => setCommenting(true));

  // ---- Where the review stands ----
  function setState(s: SoftwareReviewState) {
    state = s;
    comments.setState(s);
    pins();
    paintTop();
  }
  function paintTop() {
    const st = reviewStatus(state);
    pill.textContent = STATUS_LABEL[st];
    pill.dataset.state = st;
    const waiting = target ? comments.drafts().some((d) => d.app === appAddress(target!)) : false;
    approveBtn.textContent = st === 'approved' ? '✓ Approved' : 'Approve';
    approveBtn.classList.toggle('on', st === 'approved');
    approveBtn.disabled = !target || !host.canSend() || (st !== 'approved' && waiting);
    approveBtn.title = st === 'approved' ? `Approved by ${state.approved!.by}. Click to take it back.` : waiting ? 'Send or remove the comments not sent yet first' : `Tell ${host.workerName} the app is good as it is`;
    back.disabled = reload.disabled = !target;
  }
  approveBtn.addEventListener('click', async () => {
    if (!target) return;
    approveBtn.disabled = true;
    try {
      setState(await approve(host.workerId, appAddress(target), reviewStatus(state) !== 'approved'));
      void host.refresh();
    } catch {
      paintTop();
    }
  });

  // ---- The apps ----
  function paintTargets() {
    targets = reviewTargets(host.workerId);
    pick.replaceChildren(...targets.map((t) => h('option', { value: t.key }, t.label)));
    pick.hidden = targets.length < 2;
    if (target && !targets.some((t) => t.key === target!.key)) {
      // Its server stopped: say so, and pick it up again when it's back.
      notice.replaceChildren(h('strong', {}, 'The app stopped'), h('p', {}, `It comes back here when ${host.workerName} runs it again. Your comments are kept.`));
      notice.classList.remove('hidden');
      device.hidden = true;
      return;
    }
    if (!target) {
      const t = targets.find((x) => x.key === opts.target) ?? targets[0];
      if (t) open(t);
      else {
        notice.replaceChildren(h('strong', {}, 'No app running yet'), h('p', {}, `When ${host.workerName} runs its app on this machine, it shows here.`));
        notice.classList.remove('hidden');
        device.hidden = true;
      }
    } else if (!notice.classList.contains('hidden') && device.hidden) open(target, page);
    if (target) pick.value = target.key;
  }
  pick.addEventListener('change', () => {
    const t = targets.find((x) => x.key === pick.value);
    if (t) open(t);
  });
  address.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !target) return;
    e.preventDefault();
    const raw = address.value.trim();
    const path = raw.startsWith('/') ? raw : `/${raw.replace(/^https?:\/\/[^/]+/i, '')}`;
    if (ready && commentable) tell({ t: 'go', path });
    else open(target, path);
    address.blur();
  });
  reload.addEventListener('click', () => (ready && commentable ? tell({ t: 'reload' }) : target && open(target, page)));
  back.addEventListener('click', () => (commentable ? tell({ t: 'back' }) : undefined));

  // ---- Keys ----
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  function onKey(e: KeyboardEvent) {
    if (document.getElementById('modal-root')?.lastElementChild !== modal.backdrop) return;
    if (e.key === 'Escape') {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (typing(e.target) || comments.busy()) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (comments.hasPick()) comments.clearPick(), pins(false);
        return;
      }
      if (commenting) return setCommenting(false);
      return modal.close();
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault?.();
      setCommenting(!commenting);
      if (commenting) frame.focus();
      return;
    }
    const s = SIZES.find((x) => x.key === e.key);
    if (s) setSize(s.id);
  }

  // ---- Open and close ----
  let poll = 0;
  const refresh = () => loadReview(host.workerId).then(setState, () => undefined);
  const offServices = store.on('services', paintTargets);
  window.addEventListener('message', onMessage);
  window.addEventListener('keydown', onKey, true);
  const modal = openModal(root, {
    escCloses: false,
    closeButton: false,
    doing: `reviewing ${host.workerName}’s app`,
    onClose: () => {
      window.clearInterval(poll);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey, true);
      offServices();
      resize.disconnect();
      frame.src = 'about:blank';
      current = undefined;
      opts.onClose?.();
    },
  });
  close.addEventListener('click', () => modal.close());
  current = { close: () => modal.close() };
  paintTargets();
  setCommenting(false);
  comments.paint();
  void refresh();
  poll = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
  requestAnimationFrame(() => {
    layout();
    root.focus({ preventScroll: true });
  });
}
