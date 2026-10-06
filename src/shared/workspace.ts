import type { ReviewKind, ReviewNote } from './worker-chat.js';
import { previewType } from './worker-chat.js';
import { isDesignFile } from './design-canvas.js';

// A specialist's workspace: the interface its chat window opens with beside the conversation. A kind
// only says which tabs come first and what the window is called; the tabs themselves are panels in
// client/ui/workspace/, one per kind of output (Watch for video and audio, Board for images, Read for
// documents, and Files for everything). A new kind is one id in WORKSPACE_KINDS and one entry in
// WORKSPACES, and the typecheck fails until both are there. Both sides read this file: the server to
// put a role's kind into the chat snapshot and to write review prompts, the browser to lay out the
// window and to say what E does at a worker's desk.

export const WORKSPACE_KINDS = ['files', 'screening', 'board', 'reader'] as const;
export type WorkspaceKind = typeof WORKSPACE_KINDS[number];
/** Every tab a worker's window can have, in the order the ones a kind doesn't list come after its own (see shared/apps.ts). */
export const WORKSPACE_TABS = ['canvas', 'review', 'watch', 'board', 'read', 'files'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

/**
 * Each kind's name, the words E shows at the worker's desk, a line for the admin choosing it, and its
 * tabs in order. The first tab is the one the window opens on; every kind ends with Files, so nothing
 * a worker links is ever out of reach.
 */
export const WORKSPACES: Readonly<Record<WorkspaceKind, { label: string; hint: string; about: string; tabs: readonly WorkspaceTab[] }>> = Object.freeze({
  files: { label: 'Files', hint: 'Open chat', about: 'The conversation, with the files the worker links or makes beside it.', tabs: ['files'] },
  screening: { label: 'Screening room', hint: 'Open the screening room', about: 'Watch each cut, leave notes at timestamps, send them back as a revision request, and approve the final version.', tabs: ['watch', 'read', 'board', 'canvas', 'files'] },
  board: { label: 'Design board', hint: 'Open the design board', about: 'Watch designs take shape live and pin notes to them, compare images side by side and at YouTube size, pick one, or ask for variations.', tabs: ['canvas', 'board', 'read', 'watch', 'files'] },
  reader: { label: 'Reports', hint: 'Read the reports', about: 'Read reports with their sources listed beside them, ask about them, and approve them.', tabs: ['read', 'board', 'watch', 'canvas', 'files'] },
});

/** The starter roles' kinds. Any other role is 'files' until an admin picks one in Manage specialists. */
export const STARTER_WORKSPACES: Readonly<Record<string, WorkspaceKind>> = Object.freeze({ 'video-editor': 'screening', designer: 'board', researcher: 'reader' });

export const isWorkspaceKind = (v: unknown): v is WorkspaceKind => typeof v === 'string' && (WORKSPACE_KINDS as readonly string[]).includes(v);

/** A role's kind: the one its profile declares when that is a kind, else its starter's, else 'files'. */
export function workspaceOf(specialist?: string, declared?: unknown): WorkspaceKind {
  if (isWorkspaceKind(declared)) return declared;
  return specialist && Object.hasOwn(STARTER_WORKSPACES, specialist) ? STARTER_WORKSPACES[specialist] : 'files';
}

/**
 * What E says at a worker's desk. The desk only knows the worker's role, not its profile, so a custom
 * role reads 'Open chat' even when an admin gave it another interface.
 */
export function workspaceHint(specialist?: string): string {
  return WORKSPACES[workspaceOf(specialist)].hint;
}

/** The tab a file belongs on: a design on the canvas (see shared/design-canvas.ts), anything else by its preview type. */
export function fileTab(file: { path: string; type: string }): Exclude<WorkspaceTab, 'files'> | undefined {
  return isDesignFile(file.path) ? 'canvas' : tabOf(file.type);
}

/** The tab a file's preview type belongs on. Anything else is only under Files. */
export function tabOf(type: string): Exclude<WorkspaceTab, 'files' | 'canvas'> | undefined {
  if (/^(video|audio)\//.test(type)) return 'watch';
  if (type.startsWith('image/')) return 'board';
  if (type.startsWith('text/') || type === 'application/pdf') return 'read';
  return undefined;
}

/** A time in a video as players write it: '8:54', or '1:02:03' past the hour. Parts of a second are dropped. */
export function clock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// '00:29 Title', '1:02:03 - Title', '[04:01] Title' or '- 0:29 Title', the way chapters.txt and a
// YouTube description list them.
const CHAPTER = /^\s*(?:[-*•]\s+|\d{1,3}[.)]\s+)?[[(]?((?:\d{1,2}:)?\d{1,3}:\d{2})(?!\d)[\])]?\s*(?:[-–—:|.]\s*)?(\S.*?)\s*$/;

/** The chapters in a chapters.txt, in time order: one per line that starts with a time and goes on with a title. */
export function parseChapters(text: string): { at: number; title: string }[] {
  const out: { at: number; title: string }[] = [];
  for (const line of text.split(/\r?\n/).slice(0, 500)) {
    const m = CHAPTER.exec(line);
    if (!m) continue;
    const parts = m[1].split(':').map(Number);
    if (parts.slice(1).some((n) => n > 59)) continue;
    const at = parts.reduce((sum, n) => sum * 60 + n, 0);
    out.push({ at, title: m[2].slice(0, 200) });
  }
  return out.sort((a, b) => a.at - b.at);
}

const VERSION = /(?:^|[^a-z0-9])(v\d{1,3})(?![0-9])/i;

/**
 * Which version a file is, as its name or nearest folder writes it ('v01', 'v2'): the file's own name
 * first, then up to three folders above it. Undefined when none of them says.
 */
export function versionLabel(path: string): string | undefined {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const name = (parts.pop() ?? '').replace(/\.[^.]*$/, '');
  for (const part of [name, ...parts.slice(-3).reverse()]) {
    const m = VERSION.exec(part);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

/** The version after this one, written as wide: 'v01' gives 'v02', 'v9' gives 'v10'. */
function nextVersion(label: string | undefined): string {
  if (!label) return 'v02';
  const digits = label.slice(1);
  return `v${String(Number(digits) + 1).padStart(digits.length, '0')}`;
}

const baseName = (file: string) => file.split('/').filter(Boolean).pop() ?? file;
/** A file's name, with its version when only its folder says which: 'cut.mp4 (v02)'. */
function titled(file: string): string {
  const name = baseName(file), version = versionLabel(file);
  return version && versionLabel(name) !== version ? `${name} (${version})` : name;
}
/** A path as inline code, so a path with spaces reads as one; plain when it holds a backtick itself. */
const code = (file: string) => (file.includes('`') ? file : `\`${file}\``);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** How every review asks for what the worker makes next, so the office can open it. */
const LINKED = 'in your reply as a Markdown link to its full path';

/**
 * The prompt a review sends to the worker, written on the server from what the viewer chose. `files`
 * are the absolute paths the review is about (1 to 4), so the agent can act on them wherever it
 * works. Notes are listed in time order, at the time a player shows. Never an em dash: the prompt
 * stays in the worker's chat, and Tyler's roles are told not to write them.
 */
export function reviewText(kind: ReviewKind, files: string[], notes?: ReviewNote[], text?: string): string {
  const extra = text?.trim();
  const listed = files.map((f) => `- ${code(f)}`).join('\n');
  const one = files.length === 1 ? files[0] : undefined;
  const parts: string[] = [];
  if (kind === 'notes') {
    const version = one ? versionLabel(one) : undefined;
    parts.push(one ? `Revision notes on ${titled(one)}:\n${code(one)}` : `Revision notes on these files:\n${listed}`);
    const sorted = [...(notes ?? [])].sort((a, b) => a.at - b.at).map((n) => (n.where ? `- On ${oneLine(n.where)}: ${oneLine(n.text)}` : `- ${clock(n.at)} ${oneLine(n.text)}`));
    if (sorted.length) parts.push(sorted.join('\n'));
    if (extra) parts.push(extra);
    const next = nextVersion(version);
    // A design is open live on the canvas: the changes go into it, where the reviewer watches them land.
    if (one && isDesignFile(one)) parts.push(`Make these changes in that design file itself: it is open on the canvas, so I see each change as you save it. Keep each artboard's name, and link the file ${LINKED} when you are done.`);
    else parts.push(one
      ? `Make these changes in a new version saved as a new file with ${next} in its name, and leave ${version ?? 'this file'} as it is. When it is ready, link it ${LINKED}.`
      : `Make these changes in new versions saved as new files next to the originals, and leave the originals as they are. When they are ready, link each new file ${LINKED}.`);
  } else if (kind === 'approve') {
    const images = files.every((f) => previewType(f)?.startsWith('image/'));
    if (one) parts.push(`${images ? `Approved: I pick ${titled(one)}.` : `Approved: ${titled(one)} is final.`}\n${code(one)}`);
    else parts.push(`Approved: these are final.\n${listed}`);
    if (extra) parts.push(extra);
    parts.push(`Change nothing in ${one ? 'it' : 'them'}, and do not publish, upload or send ${one ? 'it' : 'them'} anywhere until I give you an explicit go-ahead.`);
  } else if (kind === 'variations') {
    parts.push(`Please make variations of ${one ? 'this file' : 'these files'}:\n${listed}`);
    if (extra) parts.push(extra);
    parts.push(`Save each variation as a new file next to its original, leave the originals as they are, and link every new file ${LINKED}.`);
  } else {
    parts.push(one ? `A question about ${code(one)}:` : `A question about these files:\n${listed}`);
    if (extra) parts.push(extra);
    parts.push(`Answer here in the chat. If you make or change a file, link it ${LINKED}.`);
  }
  return parts.join('\n\n');
}
