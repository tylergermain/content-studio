import './reader.css';
import { h } from '../dom';
import { markdownFile } from '../markdown';
import { localImages } from '../worker-chat/links';
import { normalizeTarget } from '../../../shared/chat-links';
import { resolveDocLink } from '../../../shared/docs';
import { artifactKey, previewType, type ChatArtifact, type ChatSnapshot, type LinkedFile } from '../../../shared/worker-chat';
import { fileTab, versionLabel } from '../../../shared/workspace';
import { badges, fileItem, fileSize, fileTime, fileTitle, latestLinked, originOf, sections } from './files';
import { bareUrls, groupSources, sourceKey, sourcesText, type Source, type SourceLink } from './sources';
import type { Panel, WorkspaceHost } from './types';

// The Researcher's reader (kind 'reader', and the Read tab of every other kind): the documents a worker links, one
// at a time on a readable page, with the web pages it cites numbered in a Sources rail beside it. Markdown is wired
// the way the bookshelf wires a doc (features/bookshelf/ui.ts): pictures come through /file from the doc's own
// folder, a link to another document opens here, and web links stay web links. PDF and HTML stay in a sandboxed
// frame. "Ask about this report" and "Approve" are each one review (host.review), written into the prompt by the
// server.

const MAX_TEXT = 2 * 1024 * 1024;
type Head = { level: number; text: string; el: HTMLElement };

const ref = (f: ChatArtifact) => (f.root ? { root: f.root, path: f.path } : { path: f.path });
/** What was typed, as the server takes it: a pasted control character (a soft return from a doc) becomes a space. */
const plain = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim();
/** A pill as the other tabs show it (workspace.css): Latest in the accent, Approved in green. */
const pill = (label: string) => h(`span.ws-pill${label === 'Latest' ? '.latest' : /^(Approved|Picked)$/.test(label) ? '.good' : ''}`, {}, label);
const folderOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
const isMarkdown = (f: ChatArtifact) => /\.(md|markdown)$/i.test(f.path);
const framed = (f: ChatArtifact) => f.type === 'text/html' || f.type === 'application/pdf';
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
/** A heading's anchor as GitHub writes it, so a doc's own #links land (as the bookshelf does). */
const slug = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not a secure context (the office over plain http): a hidden textarea instead.
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { return document.execCommand('copy'); } catch { return false; } finally { ta.remove(); }
  }
}

/** `onOpen` hears each document as it opens, for a room built around the reader (reader/room.ts). */
export function reportReader(host: WorkspaceHost, o: { onOpen?(f: ChatArtifact): void } = {}): Panel {
  let data: ChatSnapshot | undefined;
  /** This tab's documents, the worker's first (`mine`: what it linked and what sits beside that) and then the floor's. */
  let files: ChatArtifact[] = [];
  let mine: ChatArtifact[] = [];
  /** Words in the open document, for its reading time. */
  let words: number | undefined;
  let byKey = new Map<string, ChatArtifact>();
  let linked: LinkedFile[] = [];
  let latest: ChatArtifact | undefined;
  let current: ChatArtifact | undefined;
  /** The documents followed here by links, to go back through. */
  let trail: ChatArtifact[] = [];
  let sources: Source[] = [];
  let touched = false;
  let busy = false;
  let stopped = false;
  let abort: AbortController | undefined;
  let listStamp = '';

  const docs = h('nav.ws-strip.reader-docs', { 'aria-label': 'Documents' });
  const back = h('button.reader-back.hidden', { type: 'button' });
  const crumbs = h('div.reader-crumbs');
  const pills = h('span.reader-pills');
  const meta = h('div.reader-meta');
  const ask = h('button.btn.small', { type: 'button' }, 'Ask about this report');
  const approve = h('button.btn.small', { type: 'button' }, 'Approve');
  const newTab = h('a.btn.small.hidden', { target: '_blank', rel: 'noopener noreferrer' }, 'Open in a new tab');
  const actions = h('div.reader-actions', {}, ask, approve);
  const readOnly = h('p.reader-readonly.hidden', {}, `You can read along, but only an admin or ${host.workerName}’s owner can send it questions and approvals.`);
  const sheet = h('div.reader-sheet.hidden');
  const status = h('p.reader-status', { 'aria-live': 'polite' });
  const page = h('div.reader-page', { tabindex: '-1' });
  const tocBox = h('section.reader-toc.hidden', {}, h('h4', {}, 'Contents'));
  const toc = h('ol');
  tocBox.append(toc);
  const sourceCount = h('span.reader-count');
  const copy = h('button.btn.small', { type: 'button', disabled: true }, 'Copy sources');
  const sourceList = h('ol.reader-sources-list');
  const rail = h('aside.reader-rail.hidden', { 'aria-label': 'Contents and sources' }, tocBox,
    h('section.reader-sources', {}, h('div.reader-sources-head', {}, h('h4', {}, 'Sources ', sourceCount), copy), sourceList));
  const head = h('header.reader-head.hidden', {}, h('div.reader-title', {}, back, crumbs, pills), meta, h('div.reader-tools', {}, actions, newTab));
  const element = h('div.ws-reader', {}, docs,
    h('div.reader-body', {}, h('section.reader-main', {}, head, readOnly, sheet, status, page), rail));

  function setStatus(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  const pillsOf = (f: ChatArtifact) => (data ? badges(f, data) : []);

  // ---- The documents ----

  function paintList() {
    if (!data) return;
    const snapshot = data;
    const floor = files.filter((f) => !mine.includes(f));
    const stamp = JSON.stringify([mine.map((f) => [artifactKey(f), f.modified, f.size, pillsOf(f)]), floor.map(artifactKey), latest && artifactKey(latest)]);
    if (stamp !== listStamp) {
      listStamp = stamp;
      docs.replaceChildren();
      if (mine.length) docs.append(h('span.ws-strip-label', {}, `From ${host.workerName}`));
      else docs.append(h('span.reader-none', {}, `No documents from ${host.workerName} yet.`));
      for (const f of mine) docs.append(fileItem(f, { data: snapshot, url: host.url, selected: false, latest: f === latest, onClick: () => choose(f) }));
      if (floor.length) {
        const pickFloor = h('select.reader-floor', { 'aria-label': 'Other documents on this floor' },
          h('option', { value: '' }, `On this floor (${floor.length})`), ...floor.map((f) => h('option', { value: artifactKey(f) }, f.path)));
        pickFloor.addEventListener('change', () => {
          const f = byKey.get(pickFloor.value);
          pickFloor.value = '';
          if (f) choose(f);
        });
        docs.append(pickFloor);
      }
    }
    for (const b of docs.querySelectorAll<HTMLElement>('.ws-file')) b.setAttribute('aria-pressed', String(!!current && b.dataset.key === artifactKey(current)));
  }

  function choose(f: ChatArtifact) {
    touched = true;
    trail = [];
    void open(f);
  }

  function step(by: number) {
    const all = mine.length ? mine : files;
    if (!all.length) return;
    const at = current ? all.findIndex((f) => artifactKey(f) === artifactKey(current!)) : -1;
    choose(all[at < 0 ? 0 : (at + by + all.length) % all.length]);
  }

  // ---- One document ----

  function paintHead(f: ChatArtifact) {
    head.classList.remove('hidden');
    rail.classList.remove('hidden');
    const prev = trail[trail.length - 1];
    back.classList.toggle('hidden', !prev);
    back.textContent = prev ? `← ${prev.name}` : '';
    const dir = folderOf(f.path);
    crumbs.replaceChildren(dir ? h('span.reader-dir', {}, dir) : '', h('strong', {}, f.name));
    crumbs.title = fileTitle(f);
    const known = byKey.get(artifactKey(f)) ?? f;
    const version = versionLabel(f.path);
    pills.replaceChildren(...(version ? [h('span.ws-version', {}, version)] : []), ...pillsOf(known).map(pill));
    meta.textContent = [words ? `${Math.max(1, Math.round(words / 220))} min read` : '', known.size ? fileSize(known.size) : '', known.modified ? `Updated ${fileTime(known.modified)}` : ''].filter(Boolean).join(' · ');
    newTab.href = host.url(f);
    newTab.classList.toggle('hidden', !framed(f) && f.size <= MAX_TEXT);
    paintActions();
  }

  function notice(text: string, f?: ChatArtifact): HTMLElement {
    return h('div.reader-notice', {}, h('p', {}, text), f ? h('a', { href: host.url(f), target: '_blank', rel: 'noopener noreferrer' }, 'Open it in a new tab') : null);
  }

  async function fetchText(f: ChatArtifact, signal: AbortSignal): Promise<string> {
    const r = await fetch(host.url(f), { credentials: 'same-origin', cache: 'no-store', signal });
    if (r.status === 403) throw new Error('You don’t have access to files in this shared folder.');
    if (r.status === 404) throw new Error('This file isn’t available here. It may have moved, or it isn’t in a folder shared with this floor.');
    if (!r.ok) throw new Error('This file could not be opened.');
    // A document reached by a link has no size in the list yet: its header says, before it is read.
    const size = Number(r.headers.get('content-length') ?? 0);
    if (size > MAX_TEXT) {
      void r.body?.cancel();
      throw new Error(`This file is ${fileSize(size)}, too large to read here.`);
    }
    return r.text();
  }

  /** Opens a document; `keep` re-reads the open one in place (it changed on disk) without losing the reader's spot. */
  async function open(f: ChatArtifact, opts: { hash?: string; keep?: boolean } = {}) {
    abort?.abort();
    const ctrl = (abort = new AbortController());
    const scroll = opts.keep ? page.scrollTop : 0;
    current = f;
    o.onOpen?.(f);
    if (!opts.keep) { closeSheet(); words = undefined; }
    paintList();
    paintHead(f);
    page.classList.toggle('framed', framed(f));
    if (!opts.keep) {
      page.replaceChildren(h('p.reader-empty', {}, 'Opening…'));
      paintRail([], []);
    }
    if (framed(f)) {
      // Agent HTML and PDFs never run in the office: a frame with every sandbox flag (the server's CSP sandboxes them too).
      page.replaceChildren(h('iframe', { src: host.url(f), title: f.name, sandbox: '' }));
      // A page's own links can't be read through the sandbox, so its HTML is read as text for the rail, and never run.
      if (f.type === 'text/html' && f.size <= MAX_TEXT) {
        try {
          const text = await fetchText(f, ctrl.signal);
          if (current !== f || stopped) return;
          const doc = new DOMParser().parseFromString(text, 'text/html');
          paintRail(groupSources([...doc.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href') ?? '', text: a.textContent ?? '' }))), []);
        } catch { /* the frame says what went wrong */ }
      }
      return;
    }
    if (f.size > MAX_TEXT) {
      page.replaceChildren(notice(`This file is ${fileSize(f.size)}, too large to read here.`, f));
      return;
    }
    let text: string;
    try {
      text = await fetchText(f, ctrl.signal);
    } catch (error) {
      if (ctrl.signal.aborted || stopped || current !== f) return;
      page.replaceChildren(notice(error instanceof Error ? error.message : 'This file could not be opened.', /too large/.test(String(error)) ? f : undefined));
      return;
    }
    if (ctrl.signal.aborted || stopped || current !== f) return;
    const body = isMarkdown(f) ? (text.trim() ? markdownFile(text) : h('div.md', {}, h('p.none', {}, 'This file is empty.'))) : plainText(f, text);
    const { links, web, heads } = wire(body, f);
    page.replaceChildren(body);
    words = text.split(/\s+/).filter(Boolean).length;
    paintHead(f);
    paintRail(groupSources(links), heads);
    const numbers = new Map(sources.map((s) => [s.key, s.n]));
    for (const a of web) {
      const n = numbers.get(sourceKey(a.getAttribute('href') ?? '') ?? '');
      if (n) a.after(h('sup.reader-cite', { title: `Source ${n}` }, String(n)));
    }
    page.scrollTop = scroll;
    if (opts.hash) jump(opts.hash);
  }

  /** Text that isn't Markdown, as written (JSON laid out), with its web addresses made links so the rail can list them. */
  function plainText(f: ChatArtifact, text: string): HTMLElement {
    let shown = text;
    if (/\.json$/i.test(f.path)) {
      try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* shown as written */ }
    }
    const pre = h('pre.reader-text');
    let at = 0;
    for (const u of bareUrls(shown)) {
      pre.append(shown.slice(at, u.at), h('a', { href: u.url, target: '_blank', rel: 'noopener noreferrer' }, u.url));
      at = u.at + u.url.length;
    }
    pre.append(shown.slice(at));
    return pre;
  }

  /**
   * Where a link in a document goes: a file the worker linked by its full path, or a path from the document's own
   * folder in the same root. Undefined for anything the office has no preview for, or that climbs out of the root.
   */
  function linkTarget(from: ChatArtifact, raw: string): { file: ChatArtifact; hash: string } | undefined {
    const href = raw.trim();
    const hashAt = href.indexOf('#');
    if (href.startsWith('/') || /^file:/i.test(href)) {
      const key = normalizeTarget(href);
      const hit = key ? linked.find((l) => l.link === key) : undefined;
      return hit ? { file: hit, hash: hashAt >= 0 ? href.slice(hashAt + 1) : '' } : undefined;
    }
    const to = resolveDocLink(from.path, href);
    if (!to) return undefined;
    const known = byKey.get(artifactKey({ root: from.root, path: to.path }));
    const type = known?.type ?? previewType(to.path);
    if (!type) return undefined;
    const name = to.path.split('/').pop() ?? to.path;
    return { file: known ?? { ...(from.root ? { root: from.root } : {}), path: to.path, name, type, size: 0, modified: 0 }, hash: to.hash };
  }

  /** Points a rendered document's links and pictures at the office (see the top of the file). */
  function wire(body: HTMLElement, f: ChatArtifact): { links: SourceLink[]; web: HTMLAnchorElement[]; heads: Head[] } {
    localImages(body, linked, host.url, { root: f.root, dir: folderOf(f.path) });
    const links: SourceLink[] = [];
    const web: HTMLAnchorElement[] = [];
    const heads: Head[] = [];
    const seen = new Map<string, number>();
    for (const el of body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const base = slug(el.textContent ?? '');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      el.dataset.anchor = n ? `${base}-${n}` : base;
      const level = Number(el.tagName[1]);
      if (level <= 3 && el.textContent?.trim()) heads.push({ level, text: el.textContent.trim(), el });
    }
    for (const a of [...body.querySelectorAll<HTMLAnchorElement>('a')]) {
      const raw = a.getAttribute('href');
      const href = raw?.trim() ?? '';
      if (/^https?:/i.test(href)) {
        links.push({ href, text: a.textContent ?? '' });
        web.push(a);
        continue;
      }
      if (/^mailto:/i.test(href)) continue;
      if (href.startsWith('#')) {
        a.removeAttribute('target');
        a.addEventListener('click', (e) => { e.preventDefault(); jump(href.slice(1)); });
        continue;
      }
      const to = href ? linkTarget(f, href) : undefined;
      if (!to) {
        // Left as written, a local path would take the office page to itself: plain text instead.
        const text = h('span.reader-dead', { title: href ? `${href}\nNot a file the office can open` : 'A link the office can’t open' });
        text.append(...a.childNodes);
        a.replaceWith(text);
        continue;
      }
      a.setAttribute('href', host.url(to.file));
      a.classList.add('reader-file');
      if (fileTab(to.file) !== 'read') continue;
      a.title = `Open ${to.file.name} here`;
      a.addEventListener('click', (e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        follow(to.file, to.hash);
      });
    }
    return { links, web, heads };
  }

  /** A link inside a document: open it here, and remember where it was followed from. */
  function follow(f: ChatArtifact, hash: string) {
    touched = true;
    if (current && artifactKey(current) === artifactKey(f)) return jump(hash);
    if (current) trail.push(current);
    void open(f, { hash });
  }
  back.addEventListener('click', () => {
    const prev = trail.pop();
    if (prev) void open(prev);
  });

  function jump(hash: string) {
    if (!hash) return page.scrollTo({ top: 0, behavior: 'smooth' });
    let id = hash;
    try { id = decodeURIComponent(hash); } catch { /* not encoded after all */ }
    id = id.replace(/^user-content-/, '');
    const all = [...page.querySelectorAll<HTMLElement>('[data-anchor]')];
    (all.find((el) => el.dataset.anchor === id) ?? all.find((el) => el.dataset.anchor === id.toLowerCase()))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---- The rail ----

  function paintRail(next: Source[], heads: Head[]) {
    sources = next;
    tocBox.classList.toggle('hidden', heads.length < 3);
    toc.replaceChildren(...heads.map((hd) => {
      const b = h('button.reader-toc-item', { type: 'button', 'data-level': hd.level }, hd.text);
      b.addEventListener('click', () => hd.el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      return h('li', {}, b);
    }));
    sourceCount.textContent = next.length ? String(next.length) : '';
    copy.disabled = !next.length;
    sourceList.replaceChildren(...(next.length ? next.map((s) => h('li.reader-source', {},
      h('span.reader-source-n', {}, String(s.n)),
      h('div.reader-source-text', {},
        h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.url }, s.title),
        h('span.reader-source-host', {}, s.count > 1 ? `${s.host} · cited ${s.count} times` : s.host)))) : [h('li.reader-none', {}, noSources())]));
  }

  const noSources = () => (current?.type === 'application/pdf' ? 'A PDF’s links aren’t listed here.' : 'No web pages linked in this document.');

  copy.addEventListener('click', () => {
    const n = sources.length;
    void copyText(sourcesText(sources)).then((ok) => {
      if (stopped) return;
      copy.textContent = ok ? `Copied ${n}` : 'Couldn’t copy';
      setTimeout(() => { if (!stopped) copy.textContent = 'Copy sources'; }, 1600);
    });
  });

  // ---- Questions and approval ----

  function paintActions() {
    const can = host.canSend();
    actions.classList.toggle('hidden', !can);
    readOnly.classList.toggle('hidden', can || !current);
    if (!can) closeSheet();
    ask.disabled = approve.disabled = busy || !current;
  }

  function closeSheet() {
    sheet.classList.add('hidden');
    sheet.replaceChildren();
  }

  function openSheet(...children: (Node | string)[]) {
    sheet.replaceChildren(...children);
    sheet.classList.remove('hidden');
    setStatus('');
  }

  const cancelButton = () => {
    const b = h('button.btn.small', { type: 'button' }, 'Cancel');
    b.addEventListener('click', closeSheet);
    return b;
  };

  ask.addEventListener('click', () => {
    const f = current;
    if (!f) return;
    touched = true;
    const text = h('textarea', { rows: 3, maxlength: 3500, 'aria-label': `Your question about ${f.name}`,
      placeholder: 'What do you want to know? For example: which claims rest on a single source, or what is still missing for a script.' }) as HTMLTextAreaElement;
    const go = h('button.btn.small.primary', { type: 'button', disabled: true }, `Send to ${host.workerName}`);
    text.addEventListener('input', () => { go.disabled = busy || !text.value.trim(); });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go.click(); }
    });
    go.addEventListener('click', () => {
      const asked = plain(text.value);
      if (asked) void send('question', f, asked, `Sent. ${host.workerName}’s answer will appear in the chat.`);
    });
    openSheet(h('label', {}, `Ask about ${f.name}`), text, h('div.reader-sheet-actions', {}, go, cancelButton(), h('span.reader-hint', {}, '⌘↩ sends')));
    text.focus();
  });

  approve.addEventListener('click', () => {
    const f = current;
    if (!f) return;
    touched = true;
    const go = h('button.btn.small.primary', { type: 'button' }, `Approve ${f.name}`);
    go.addEventListener('click', () => void send('approve', f, undefined, `Sent. ${host.workerName} knows ${f.name} is approved.`));
    openSheet(h('p', {}, `Tell ${host.workerName} `, h('strong', {}, f.name), ' is final? It keeps the file as it is, and won’t publish or send it anywhere without your go-ahead.'),
      h('div.reader-sheet-actions', {}, go, cancelButton()));
    go.focus();
  });

  async function send(kind: 'question' | 'approve', f: ChatArtifact, text: string | undefined, done: string) {
    if (busy) return;
    busy = true;
    for (const b of sheet.querySelectorAll('button')) b.disabled = true;
    paintActions();
    setStatus('Sending…');
    try {
      await host.review({ kind, files: [ref(f)], ...(text ? { text } : {}) });
      if (stopped) return;
      closeSheet();
      setStatus(done);
    } catch (error) {
      if (stopped) return;
      for (const b of sheet.querySelectorAll('button')) b.disabled = false;
      setStatus(error instanceof Error ? error.message : `${host.workerName} could not be reached`, true);
    } finally {
      busy = false;
      if (!stopped) paintActions();
    }
  }

  return {
    element,
    paint(next, snapshot) {
      data = snapshot;
      linked = snapshot.linked ?? [];
      files = sections(next, snapshot, host.workerName).flatMap((s) => s.files);
      mine = files.filter((f) => originOf(f, snapshot) !== 'floor');
      byKey = new Map(files.map((f) => [artifactKey(f), f]));
      latest = latestLinked(files, snapshot);
      paintList();
      const fresh = current && byKey.get(artifactKey(current));
      if (fresh && current && fresh.modified !== current.modified) void open(fresh, { keep: true });
      else if (current) paintHead(current);
      // Until the viewer chooses, the page follows the newest document the worker linked; the floor's wait to be chosen.
      if (!touched) {
        const first = latest ?? mine[0];
        if (first && (!current || artifactKey(first) !== artifactKey(current))) void open(first);
        else if (!first && !current) page.replaceChildren(h('p.reader-empty', {}, `Reports and notes ${host.workerName} links in the chat open here, with the web pages they cite listed beside them.`));
      }
    },
    show(file) {
      touched = true;
      trail = [];
      if (current && artifactKey(current) === artifactKey(file)) return;
      void open(byKey.get(artifactKey(file)) ?? file);
    },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key === 'j' || e.key === 'k') { step(e.key === 'j' ? 1 : -1); return true; }
      return false;
    },
    stop() {
      stopped = true;
      abort?.abort();
      closeSheet();
    },
  };
}
