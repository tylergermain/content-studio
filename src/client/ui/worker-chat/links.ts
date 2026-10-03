import { h } from '../dom';
import { normalizeTarget } from '../../../shared/chat-links';
import type { ChatSnapshot, LinkedFile } from '../../../shared/worker-chat';

// A worker's message links its files by the paths it sees on the Mac (/Users/…/render.mp4, outputs/x.png). Left as
// written, a click takes the browser to that path on the office's own address, which is the office again. The server
// says which of them it can serve (`ChatSnapshot.linked`, keyed by `normalizeTarget`); those open in the window's
// preview, web and mail links stay as they are, and the rest become plain text, so a chat link never leaves the office.

type FileRef = { root?: string; path: string };
export interface LinkHost {
  /** The authenticated /api/worker-chat/file address of a file. */
  url(f: FileRef): string;
  /** Show a linked file in the window's preview. */
  open(f: LinkedFile): void;
  /** Share a folder with the floor (an admin's choice), then refresh. */
  share(folder: string): Promise<void>;
}

const WEB = /^(?:https?|mailto):/i;
const NOT_SHARED = 'Not shared with the office';

function linkedFile(linked: LinkedFile[], raw: string | null | undefined): LinkedFile | undefined {
  const key = raw ? normalizeTarget(raw) : '';
  return key ? linked.find((f) => f.link === key) : undefined;
}

/** A link that opens `file` in the preview on a plain click, and in a tab of its own on a modified one. */
function opens(a: HTMLAnchorElement, file: LinkedFile, o: LinkHost) {
  a.setAttribute('href', o.url(file));
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  a.classList.add('chat-file');
  a.title = `Open ${file.name} here`;
  a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    o.open(file);
  });
}

/** Asks an admin to share a folder that holds files this message links: one card per folder. */
function shareCard(folder: string, label: string, o: LinkHost): HTMLElement {
  const button = h('button.btn.primary', { type: 'button' }, `Share ${label} with this floor`);
  const status = h('p.share-status', {}, 'Only the files a worker links there, and the files beside them, open in the office.');
  button.addEventListener('click', () => {
    button.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Sharing…';
    void o.share(folder).then(
      () => { status.textContent = 'Shared. The links open here in a moment.'; },
      (error: unknown) => {
        button.disabled = false;
        status.classList.add('error');
        status.textContent = error instanceof Error ? error.message : 'The folder could not be shared';
      },
    );
  });
  return h('div.share-card', {}, h('p', {}, h('strong', {}, label), ' isn’t shared with this floor, so these links can’t open here.'), button, status);
}

/** Points a rendered message's links, and the code spans that name a linked file, at the office (see the top of the file). */
export function wireLinks(body: HTMLElement, data: ChatSnapshot, o: LinkHost): void {
  const linked = data.linked ?? [];
  const outside = new Map<string, string>(); // folder → label, for an admin
  let unshared = false;
  const offer = (key: string) => {
    const out = data.liveAdmin && key ? data.outside?.find((x) => x.link === key) : undefined;
    if (out) outside.set(out.folder, out.label);
  };
  // Taken first: the anchors made for code spans below already point at the office.
  const anchors = [...body.querySelectorAll('a')];
  const codes = [...body.querySelectorAll('code')].filter((c) => !c.closest('pre, a'));
  for (const a of anchors) {
    const raw = a.getAttribute('href');
    if (raw && WEB.test(raw.trim())) continue;
    const file = linkedFile(linked, raw);
    if (file) { opens(a, file, o); continue; }
    const key = raw ? normalizeTarget(raw) : '';
    // No href at all is most often a file:// link the sanitizer emptied.
    const named = !!key || raw === null;
    const text = h('span.local-link', { title: named ? `${key || 'A file link'}\n${NOT_SHARED}` : undefined });
    text.append(...a.childNodes);
    if (named) text.append(h('span.link-chip', {}, NOT_SHARED));
    a.replaceWith(text);
    unshared ||= named;
    offer(key);
  }
  for (const code of codes) {
    const file = linkedFile(linked, code.textContent);
    if (!file) { offer(normalizeTarget(code.textContent ?? '')); continue; }
    const a = h('a', {});
    code.replaceWith(a);
    a.append(code);
    opens(a, file, o);
  }
  for (const [folder, label] of outside) body.append(shareCard(folder, label, o));
  if (unshared && !data.liveAdmin) body.append(h('div.share-card', {}, h('p', {}, 'These files aren’t shared with the office. Ask an admin to share this folder.')));
}

/**
 * Points a rendered message's (or Markdown preview's) pictures at the office: a linked file first, then a path
 * relative to `base` in the worker's folder, or a share's when `base.root` is one. Anything else is removed.
 */
export function localImages(body: HTMLElement, linked: LinkedFile[], url: (f: FileRef) => string, base: { root?: string; dir?: string } = {}): void {
  for (const img of body.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const file = linkedFile(linked, src);
    if (file) { img.src = url(file); continue; }
    if (!src) { img.remove(); continue; }
    try {
      const at = new URL(src, `http://workspace.invalid/${base.dir ?? ''}`);
      if (at.protocol !== 'http:' || at.hostname !== 'workspace.invalid') { img.remove(); continue; }
      img.src = url({ root: base.root, path: decodeURIComponent(at.pathname.slice(1)) });
    } catch { img.remove(); }
  }
}
