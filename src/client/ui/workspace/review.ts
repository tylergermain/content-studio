import './review.css';
import { store } from '../../state';
import { h } from '../dom';
import { DEVICES, REVIEW_START, REVIEW_TAG, type DeviceId, type ReviewPick, type SoftwareNote } from '../../../shared/software-review';
import { serviceUrl } from '../services';
import type { Panel, WorkspaceHost } from './types';

// Software review (the Review tab; see shared/software-review.ts): the app a worker is running, used
// right here at a desktop, laptop, tablet or phone size. Comment mode (C) turns a click into a pin on
// the element under it: write what should change, and Send sends every comment to the worker as one
// request naming each page, element and the selector that finds it. The page comes through the
// office's relay to the worker's server, which adds the small script that makes the pinning work (and
// does nothing else); the office and it talk only by postMessage, with the office's origin checked.

/** Something of the worker's to review: one of its servers by port, or its project room's app elsewhere. */
export interface ReviewTarget {
  key: string;
  label: string;
  port?: number;
  /** An address outside the office (a deployed preview): shown as it is, without comments. */
  direct?: string;
}

const LOCAL = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?(\/.*)?$/i;

/** What a worker has to review: the servers it started, and its project room's app when that's somewhere else. */
export function reviewTargets(workerId: string): ReviewTarget[] {
  const out: ReviewTarget[] = store.services.items
    .filter((s) => s.workerId === workerId)
    .sort((a, b) => a.port - b.port)
    .map((s) => ({ key: `port:${s.port}`, label: `${s.title || s.command} \u00b7 port ${s.port}`, port: s.port }));
  const url = store.workers.get(workerId)?.project?.url;
  if (url) {
    const local = LOCAL.exec(url);
    const port = local ? Number(local[1] || 80) : undefined;
    if (port && !out.some((t) => t.port === port)) out.push({ key: `port:${port}`, label: `${store.workers.get(workerId)?.project?.name ?? 'Project'} app \u00b7 port ${port}`, port });
    else if (!local) out.push({ key: `url:${url}`, label: `${store.workers.get(workerId)?.project?.name ?? 'Project'} app`, direct: url });
  }
  return out;
}

/**
 * Where a worker's server is reached through the office's relay in review mode from this browser: on
 * the tailnet by its port, or on the office's own machine at p<port>.localhost. Nowhere else, since the
 * relay takes comments only for an office at one of those addresses (server/review/relay.ts).
 */
function relayBase(port: number): string | undefined {
  const { tailnet } = store.services;
  if (tailnet && location.hostname === tailnet) return `https://${tailnet}:${port}`;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return `${location.protocol}//p${port}.localhost:${location.port || (location.protocol === 'https:' ? 443 : 80)}`;
  return undefined;
}

interface Note extends SoftwareNote {
  n: number;
}

export function softwareReview(host: WorkspaceHost): Panel {
  let targets: ReviewTarget[] = [];
  let current: ReviewTarget | undefined;
  let device: DeviceId | 'fit' = 'laptop';
  let page = '/';
  let commenting = false;
  let ready = false;
  /** Whether the app open here takes comments: it came through the relay in review mode. */
  let commentable = false;
  const notes: Note[] = [];
  let pending: { pick: ReviewPick; page: string } | undefined;

  const pick = h('select.review-pick', { 'aria-label': 'App' }) as HTMLSelectElement;
  const back = h('button.btn.small', { type: 'button', title: 'Back' }, '\u2190');
  const reload = h('button.btn.small', { type: 'button', title: 'Reload' }, '\u27f3');
  const address = h('input.review-address', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Page' }) as HTMLInputElement;
  const sizes = h('div.review-sizes', { role: 'group', 'aria-label': 'Size' }, ...[...DEVICES.map((d) => ({ id: d.id as DeviceId | 'fit', label: d.label })), { id: 'fit' as const, label: 'Fit' }].map((d) => {
    const b = h('button.btn.small', { type: 'button', 'data-size': d.id, title: d.id === 'fit' ? 'As big as the space here' : `${d.label} size` }, d.label);
    b.addEventListener('click', () => setDevice(d.id));
    return b;
  }));
  const comment = h('button.btn.small.review-comment', { type: 'button', 'aria-pressed': 'false', title: 'Click anything on the page to comment on it (C)' }, '\u{1f4ac} Comment');
  const openOut = h('a.btn.small', { target: '_blank', rel: 'noopener', title: 'Open it in a tab of its own' }, '\u2197');
  const frame = h('iframe.review-frame', { title: 'App under review', allow: 'clipboard-read; clipboard-write' }) as HTMLIFrameElement;
  const device_ = h('div.review-device', {}, frame);
  const pop = h('div.review-pop.hidden', { role: 'dialog', 'aria-label': 'Comment' });
  const empty = h('div.review-empty.hidden');
  const stage = h('div.review-stage', {}, device_, pop, empty);
  const status = h('p.review-status', { 'aria-live': 'polite' });
  const list = h('ol.review-notes-list');
  const send = h('button.btn.primary.small', { type: 'button' }, 'Send comments');
  const notesBar = h('div.review-notes.hidden', {}, h('div.review-notes-head', {}, h('strong', {}, 'Comments'), send), list);
  const element = h('div.ws-review', {},
    h('div.review-bar', {}, pick, back, reload, address, sizes, comment, openOut),
    stage, status, notesBar);

  const setStatus = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };
  const tell = (m: Record<string, unknown>) => {
    if (!current?.port || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ ...m, tag: REVIEW_TAG }, new URL(frame.src).origin);
    } catch {
      /* not loaded yet */
    }
  };
  const pinsHere = () => notes.filter((n) => n.page === page).map((n) => ({ n: n.n, selector: n.selector }));

  // ---- The size it's seen at: the device's own pixels, scaled down to fit the space here ----

  function layout() {
    const d = DEVICES.find((x) => x.id === device);
    const W = stage.clientWidth - 24, H = stage.clientHeight - 24;
    for (const b of sizes.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.size === device);
    if (!d) {
      Object.assign(frame.style, { width: `${Math.max(320, W)}px`, height: `${Math.max(240, H)}px`, transform: '' });
      Object.assign(device_.style, { width: '', height: '' });
      return;
    }
    // The frame is scaled inside a box as big as it looks, so nothing hangs out of the stage, where
    // the browser would take clicks on it for the stage's own.
    const s = Math.min(1, W / d.w, H / d.h);
    Object.assign(frame.style, { width: `${d.w}px`, height: `${d.h}px`, transform: s < 1 ? `scale(${s})` : '' });
    Object.assign(device_.style, { width: `${d.w * s}px`, height: `${d.h * s}px` });
  }
  function setDevice(id: DeviceId | 'fit') {
    device = id;
    layout();
  }
  new ResizeObserver(layout).observe(stage);

  // ---- The app ----

  function open(t: ReviewTarget, path = '/') {
    current = t;
    ready = false;
    page = path;
    address.value = path;
    closePop();
    const base = t.port ? relayBase(t.port) : undefined;
    commentable = !!base;
    comment.disabled = !commentable || !host.canSend();
    if (!base) {
      const url = t.direct ?? `${serviceUrl(t.port!)}${path}`;
      frame.src = url;
      openOut.setAttribute('href', url);
      if (t.direct) address.value = url;
      setStatus(t.direct ? 'This app is outside the office, so it shows as it is, without comments.' : 'Comments work with the office open on its tailnet address or on its own machine. Here the app shows as it is, through your service tunnel.');
      return;
    }
    frame.src = `${base}${REVIEW_START}?${new URLSearchParams({ office: location.origin, next: path })}`;
    openOut.setAttribute('href', `${base}${path}`);
    setStatus('');
  }
  pick.addEventListener('change', () => {
    const t = targets.find((x) => x.key === pick.value);
    if (t) open(t);
  });
  address.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !current) return;
    e.preventDefault();
    const raw = address.value.trim();
    const path = raw.startsWith('/') ? raw : `/${raw.replace(/^https?:\/\/[^/]+/i, '')}`;
    if (ready) tell({ t: 'go', path });
    else open(current, path);
  });
  reload.addEventListener('click', () => (ready ? tell({ t: 'reload' }) : current && open(current, page)));
  back.addEventListener('click', () => tell({ t: 'back' }));

  function setCommenting(on: boolean) {
    comment.disabled = !commentable || !host.canSend();
    commenting = on && !comment.disabled;
    comment.classList.toggle('on', commenting);
    comment.setAttribute('aria-pressed', String(commenting));
    tell({ t: 'comment', on: commenting });
    if (!commenting) closePop();
  }
  comment.addEventListener('click', () => setCommenting(!commenting));

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== frame.contentWindow || !m || m.tag !== REVIEW_TAG) return;
    if (m.t === 'ready' || m.t === 'where') {
      ready = true;
      if (typeof m.page === 'string') {
        page = m.page;
        if (document.activeElement !== address) address.value = page;
      }
      tell({ t: 'comment', on: commenting });
      tell({ t: 'pins', pins: pinsHere() });
    } else if (m.t === 'picked' && m.pick && commenting) {
      pending = { pick: m.pick as ReviewPick, page: typeof m.page === 'string' ? m.page : page };
      openPop();
    }
  });

  // ---- Comments ----

  function openPop() {
    if (!pending) return;
    const { pick: p } = pending;
    const input = h('textarea.review-input', { rows: 3, placeholder: 'What should change here?', 'aria-label': 'Comment' }) as HTMLTextAreaElement;
    const add = h('button.btn.primary.small', { type: 'button' }, 'Add comment');
    const cancel = h('button.btn.small', { type: 'button' }, 'Cancel');
    pop.replaceChildren(h('p.review-where', {}, h('strong', {}, p.what), ` on ${pending.page}`), input, h('div.review-row', {}, add, cancel));
    pop.classList.remove('hidden');
    // Next to the element, as the frame is scaled.
    const scale = device_.getBoundingClientRect().width / Math.max(1, frame.offsetWidth);
    const box = device_.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const x = box.left - sr.left + (p.rect.x + p.rect.w) * scale + 10;
    const y = box.top - sr.top + p.rect.y * scale;
    const w = Math.min(300, stage.clientWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(x, stage.clientWidth - w - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(y, stage.clientHeight - 170))}px`;
    const commit = () => {
      const text = input.value.trim();
      if (!text || !pending) return input.focus();
      notes.push({ n: (notes.at(-1)?.n ?? 0) + 1, text, page: pending.page, what: pending.pick.what, selector: pending.pick.selector });
      closePop();
      renderNotes();
      tell({ t: 'pins', pins: pinsHere() });
    };
    add.addEventListener('click', commit);
    cancel.addEventListener('click', () => {
      closePop();
      tell({ t: 'pins', pins: pinsHere() });
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    });
    setTimeout(() => input.focus({ preventScroll: true }), 0);
  }
  function closePop() {
    pending = undefined;
    pop.classList.add('hidden');
    pop.replaceChildren();
  }

  function renderNotes() {
    notesBar.classList.toggle('hidden', !notes.length);
    send.textContent = `Send ${notes.length === 1 ? 'this comment' : `${notes.length} comments`} to ${host.workerName}`;
    list.replaceChildren(...notes.map((n, i) => {
      const remove = h('button.review-remove', { type: 'button', 'aria-label': `Remove comment ${n.n}`, title: 'Remove' }, '\u2715');
      remove.addEventListener('click', () => {
        notes.splice(i, 1);
        renderNotes();
        tell({ t: 'pins', pins: pinsHere(), keep: true });
      });
      const go = h('button.review-go', { type: 'button', title: 'Go to its page' }, h('span.review-pin', {}, String(n.n)));
      go.addEventListener('click', () => (n.page !== page ? tell({ t: 'go', path: n.page }) : undefined));
      return h('li', {}, go, h('div', {}, h('span.review-note-where', {}, `${n.what} \u00b7 ${n.page}`), h('span.review-note-text', {}, n.text)), remove);
    }));
  }

  send.addEventListener('click', async () => {
    if (!current || !notes.length) return;
    send.disabled = true;
    setStatus('Sending\u2026');
    const d = DEVICES.find((x) => x.id === device);
    const size = d ? { w: d.w, h: d.h, label: d.label } : { w: frame.offsetWidth, h: frame.offsetHeight };
    const app = current.port ? `http://localhost:${current.port}` : (current.direct ?? '');
    try {
      const params = new URLSearchParams({ floor: store.floor ?? '', worker: host.workerId });
      const res = await fetch(`/api/review/notes?${params}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, app, size, notes: notes.map(({ n: _n, ...rest }) => rest) }) });
      const out = await res.json().catch(() => undefined);
      if (!res.ok) throw new Error(out?.error ?? 'The comments couldn\u2019t be sent');
      setStatus(`Sent ${notes.length === 1 ? 'your comment' : `${notes.length} comments`}. ${host.workerName}\u2019s fixes show up here as the app reloads.`);
      notes.length = 0;
      renderNotes();
      tell({ t: 'pins', pins: [] });
      await host.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The comments couldn\u2019t be sent', true);
    } finally {
      send.disabled = false;
    }
  });

  // ---- The panel ----

  function paintTargets() {
    targets = reviewTargets(host.workerId);
    pick.replaceChildren(...targets.map((t) => h('option', { value: t.key }, t.label)));
    pick.hidden = targets.length < 2;
    empty.classList.toggle('hidden', targets.length > 0);
    empty.replaceChildren(
      h('p', {}, h('strong', {}, 'No app running yet.')),
      h('p', {}, `When ${host.workerName} starts its app (npm run dev, a preview build), it shows here: use it at any size, turn on Comment, click anything to pin a comment, and send them all back.`),
    );
    if (current && !targets.some((t) => t.key === current!.key)) current = undefined;
    if (!current && targets[0]) open(targets[0]);
    if (current) pick.value = current.key;
  }
  const off = store.on('services', paintTargets);
  layout();

  return {
    element,
    paint() {
      paintTargets();
      // Whether you may send this worker comments is only known once its window has heard from the office.
      comment.disabled = !commentable || !host.canSend();
    },
    show() {
      /* a review isn't of a file */
    },
    key(e) {
      if (e.key === 'c' || e.key === 'C') return setCommenting(!commenting), true;
      return false;
    },
    stop() {
      off();
    },
  };
}
