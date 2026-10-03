import { h } from '../dom';
import { markdownFile } from '../markdown';
import { localImages } from '../worker-chat/links';
import { artifactKey, type ChatArtifact, type ChatReview, type ChatSnapshot, type LinkedFile } from '../../../shared/worker-chat';
import { versionLabel } from '../../../shared/workspace';
import type { Panel, WorkspaceHost } from './types';

// The Files tab, which is the chat's preview as it always was: a strip of every file, and a stage that shows the one
// picked. Beside it are the pieces every panel lists files with: where a file came from, its pills and its line.

type FileRef = { root?: string; path: string };
const same = (a: FileRef | undefined, b: FileRef) => !!a && artifactKey(a) === artifactKey(b);
const isLinked = (f: ChatArtifact): f is LinkedFile => 'link' in f;

/** Where a listed file came from: a link in the worker's messages (or one remembered from them), a file beside one, or the floor's own scan. */
export type Origin = 'linked' | 'nearby' | 'floor';
export function originOf(file: FileRef, data: ChatSnapshot): Origin {
  if ((data.linked ?? []).some((f) => same(f, file))) return 'linked';
  if ((data.nearby ?? []).some((f) => same(f, file))) return 'nearby';
  return 'floor';
}

/** A tab's list in its two parts: "From <worker>" (its links, then what sits beside them) and "On this floor". Empty parts are left out. */
export function sections(files: ChatArtifact[], data: ChatSnapshot, workerName: string): { title: string; files: ChatArtifact[] }[] {
  const from = files.filter((f) => originOf(f, data) !== 'floor');
  const floor = files.filter((f) => originOf(f, data) === 'floor');
  return [{ title: `From ${workerName}`, files: from }, { title: 'On this floor', files: floor }].filter((s) => s.files.length);
}

/** The newest file the worker linked among `files`, which wears the Latest pill. */
export function latestLinked(files: ChatArtifact[], data: ChatSnapshot): ChatArtifact | undefined {
  let best: ChatArtifact | undefined;
  for (const f of files) if (originOf(f, data) === 'linked' && (!best || f.modified > best.modified)) best = f;
  return best;
}

/** What was sent about a file, oldest first (from the kept chat messages). */
export function reviewsOf(file: FileRef, data: ChatSnapshot): ChatReview[] {
  return data.messages.flatMap((m) => (m.review && m.review.files.some((f) => same(f, file)) ? [m.review] : []));
}

/** The pills a file earns from what was sent about it: Approved (Picked for a picture), Notes sent · n, Variations asked. */
export function badges(file: ChatArtifact, data: ChatSnapshot): string[] {
  const reviews = reviewsOf(file, data);
  const out: string[] = [];
  if (reviews.some((r) => r.kind === 'approve')) out.push(file.type.startsWith('image/') ? 'Picked' : 'Approved');
  const notes = reviews.reduce((n, r) => n + (r.kind === 'notes' ? r.notes?.length ?? 0 : 0), 0);
  if (notes) out.push(`Notes sent · ${notes}`);
  if (reviews.some((r) => r.kind === 'variations')) out.push('Variations asked');
  return out;
}

/** 657.3 MB, the way Finder counts. */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1000, i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** When a file last changed: a time today, else a day and a time. */
export function fileTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `Today ${time}` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** The folder a file sits in, by its last two names (jev-v01/renders). */
export function fileFolder(file: FileRef): string {
  const parts = file.path.split('/').slice(0, -1);
  return parts.slice(-2).join('/');
}

/** The file as the worker wrote it (its link), else its path in the worker's folder. */
export const fileTitle = (file: ChatArtifact) => (isLinked(file) ? file.link : file.path);

const ICONS: [RegExp, string][] = [[/^video\//, '▶'], [/^audio\//, '♪'], [/^text\/html$/, '↗'], [/^application\/pdf$/, '⎙']];
const icon = (type: string) => ICONS.find(([re]) => re.test(type))?.[1] ?? '▤';

/**
 * One file in a list, as a button: a thumbnail for a picture (else an icon), the name with its version (v01), the
 * folder, size and time, and its pills. `.ws-file` in workspace.css; a `.ws-strip` parent shows it compact.
 */
export function fileItem(file: ChatArtifact, o: { data: ChatSnapshot; url(f: FileRef): string; selected: boolean; latest: boolean; onClick(): void }): HTMLButtonElement {
  const version = versionLabel(file.path);
  const pills = [...(o.latest ? ['Latest'] : []), ...badges(file, o.data)];
  const thumb = file.type.startsWith('image/') ? h('img', { src: o.url(file), alt: '', loading: 'lazy', decoding: 'async' }) : h('span.ws-file-icon', { 'aria-hidden': 'true' }, icon(file.type));
  const b = h('button.ws-file', { type: 'button', 'data-key': artifactKey(file), 'aria-pressed': String(o.selected), title: fileTitle(file) },
    h('span.ws-file-thumb', {}, thumb),
    h('span.ws-file-main', {},
      h('span.ws-file-name', {}, h('span.ws-file-label', {}, file.name), version ? h('span.ws-version', {}, version) : null),
      h('span.ws-file-meta', {}, [fileFolder(file), fileSize(file.size), fileTime(file.modified)].filter(Boolean).join(' · '))),
    pills.length ? h('span.ws-pills', {}, ...pills.map((p) => h(`span.ws-pill${p === 'Latest' ? '.latest' : /^(Approved|Picked)$/.test(p) ? '.good' : ''}`, {}, p))) : null);
  b.addEventListener('click', o.onClick);
  return b;
}

export interface StageOptions {
  url(f: FileRef): string;
  /** The worker's linked files, so a Markdown file's pictures that it linked load. */
  linked: LinkedFile[];
  signal?: AbortSignal;
  /** False once the stage has moved on to another file, so a slow text fetch doesn't land on it. */
  current?(): boolean;
}

/**
 * Shows one file in `stage`: a picture, a 2D video or audio player that streams by Range (never a 3D texture), HTML
 * and PDF in a sandboxed frame, and text or Markdown up to 2 MB inline.
 */
export async function previewStage(stage: HTMLElement, file: ChatArtifact, o: StageOptions): Promise<void> {
  const url = o.url(file);
  stage.replaceChildren();
  if (file.type.startsWith('image/')) { stage.append(h('img', { src: url, alt: file.name, decoding: 'async' })); return; }
  if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
    const media = h(file.type.startsWith('video/') ? 'video' : 'audio', { src: url, controls: true, preload: 'metadata', playsinline: true });
    media.addEventListener('error', () => {
      if (!media.isConnected) return;
      media.replaceWith(h('p.chat-empty', {}, `This browser can’t play ${file.name}. A ProRes, HEVC or 10-bit file may need an H.264 copy to preview. On the Mac it is at ${fileTitle(file)}.`));
    }, { once: true });
    stage.append(media);
    return;
  }
  if (file.type === 'text/html' || file.type === 'application/pdf') { stage.append(h('iframe', { src: url, title: file.name, sandbox: '' })); return; }
  if (file.size > 2 * 1024 * 1024) { stage.append(h('p.chat-empty', {}, 'This text file is too large for an inline preview.')); return; }
  try {
    const response = await fetch(url, { signal: o.signal });
    if (!response.ok) throw new Error('This file is no longer available');
    const text = await response.text();
    if (o.current && !o.current()) return;
    const body = file.name.toLowerCase().endsWith('.md') ? markdownFile(text) : h('pre', {}, text);
    localImages(body, o.linked, o.url, { root: file.root, dir: file.path.slice(0, file.path.lastIndexOf('/') + 1) });
    stage.append(body);
  } catch (error) {
    if (o.signal?.aborted || (o.current && !o.current())) return;
    stage.append(h('p.chat-empty', {}, error instanceof Error ? error.message : 'Preview unavailable'));
  }
}

/** Every file, as the chat's preview always showed them: the strip and the stage. */
export function filesPanel(host: WorkspaceHost): Panel {
  const strip = h('div.ws-strip', { 'aria-label': 'Files' });
  // .preview-stage is the stage's old name, which tests/support/studio-hire-browser.mjs still looks for.
  const stage = h('div.ws-stage.preview-stage');
  const caption = h('div.ws-caption', {}, 'Choose a file to preview it here.');
  const element = h('div.ws-panel.ws-files', {}, strip, stage, caption);
  const abort = new AbortController();
  let data: ChatSnapshot | undefined, selected: ChatArtifact | undefined, autoPicked = false;

  function open(file: ChatArtifact) {
    selected = file;
    caption.textContent = fileTitle(file);
    for (const b of strip.querySelectorAll<HTMLButtonElement>('.ws-file')) b.setAttribute('aria-pressed', String(b.dataset.key === artifactKey(file)));
    void previewStage(stage, file, { url: host.url, linked: data?.linked ?? [], signal: abort.signal, current: () => same(selected, file) });
  }
  const playing = () => [...stage.querySelectorAll<HTMLMediaElement>('video,audio')].some((m) => !m.paused);

  function paint(files: ChatArtifact[], next: ChatSnapshot) {
    data = next;
    const left = strip.scrollLeft;
    strip.replaceChildren();
    const fresh = selected && files.find((f) => same(selected, f));
    // A shared file that is no longer linked, or no longer shared, leaves the stage.
    if (selected && !fresh && selected.root) { selected = undefined; caption.textContent = 'Choose a file to preview it here.'; stage.replaceChildren(); }
    if (!files.length) {
      strip.append(h('span.chat-note', {}, 'No preview files yet'));
      if (!selected) stage.replaceChildren(h('p.chat-empty', {}, `Images, videos, scripts and pages ${host.workerName} links or saves on this floor will appear here.`));
    }
    const latest = latestLinked(files, next);
    for (const s of sections(files, next, host.workerName)) {
      strip.append(h('span.ws-strip-label', {}, s.title));
      for (const f of s.files) strip.append(fileItem(f, { data: next, url: host.url, selected: same(selected, f), latest: f === latest, onClick: () => { autoPicked = false; open(f); } }));
    }
    strip.scrollLeft = left;
    // With nothing chosen: the newest linked video, else picture, else a picture from the floor. A pick from the floor
    // gives way to a linked file once there is one, unless it is playing.
    const linked = files.filter((f) => originOf(f, next) === 'linked');
    const pick = linked.find((f) => f.type.startsWith('video/')) ?? linked.find((f) => f.type.startsWith('image/'));
    if (selected) {
      if (autoPicked && pick && !playing() && !same(selected, pick)) { autoPicked = false; open(pick); }
      else if (fresh && fresh.modified !== selected.modified) open(fresh);
    } else if (pick) open(pick);
    else if (files.length) { autoPicked = true; open(files.find((f) => f.type.startsWith('image/')) ?? files[0]); }
  }

  return {
    element,
    paint,
    // Asked for the file already on the stage (a second click on its link): leave it playing.
    show(file) { autoPicked = false; if (!same(selected, file) || !stage.childElementCount) open(file); },
    stop() { abort.abort(); for (const m of stage.querySelectorAll<HTMLMediaElement>('video,audio')) m.pause(); },
  };
}
