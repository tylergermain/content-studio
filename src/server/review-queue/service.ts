import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { appOn } from '../../shared/apps.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import type { ReviewItem, ReviewQueueView, ReviewState } from '../../shared/review-queue.js';
import type { ChatArtifact, ChatMessage } from '../../shared/worker-chat.js';
import { fileTab, reviewText, WORKSPACE_TABS, type WorkspaceTab } from '../../shared/workspace.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import type { Ctx } from '../office/context.js';
import { employeeWorkerError } from '../org-chart/access.js';
import { listArtifacts } from '../worker-chat/artifacts.js';
import { chatHistory, mergeMessages } from '../worker-chat/history.js';
import { defaultRoot, workerLinks } from '../worker-chat/links.js';
import { reviewFiles } from '../worker-chat/review.js';
import { sendable, sendToWorker } from '../worker-chat/send.js';
import { shareGuard } from '../worker-chat/shares.js';
import { conversation } from '../worker-chat/transcripts.js';
import { jevPick, typesafeKey, type JevAsk } from './jev.js';
import { ReviewStore } from './store.js';

// The review queue: an agent worker that finishes a task (working, then done) puts it in the office's queue once it's
// settled, with what it said and the files it made or linked that turn, and the app it's best looked at in: Jev's
// pick of the apps the floor has on and has something to show, or the newest file's own app when Jev can't be asked.
// A worker that's just acknowledging an approval isn't queued. Deciding an item here (approve, notes) tells the worker
// as its window's rooms do; approving or sending notes from a room decides its item too (see refresh).

const SETTLE_MS = 4000;
const MAX_FILES = 12;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);

const instances = new WeakMap<Ctx, ReviewQueue>();
/** The office's review queue, made the first time anything asks for it. */
export function reviewQueueOf(ctx: Ctx): ReviewQueue {
  let q = instances.get(ctx);
  if (!q) instances.set(ctx, (q = new ReviewQueue(ctx)));
  return q;
}

/** The app a finished task is shown in when Jev isn't asked: its newest file's, else Software review for a running app, else Files. */
export function fallbackApp(files: { path: string; type: string }[], serving: boolean, on: readonly WorkspaceTab[]): WorkspaceTab {
  for (const f of files) {
    const tab = fileTab(f);
    if (tab && on.includes(tab)) return tab;
  }
  return serving && on.includes('review') ? 'review' : 'files';
}

/** The apps there's something to show in: those the floor has on, for the kinds of file it made (and its app, running). */
export function candidateApps(files: { path: string; type: string }[], serving: boolean, on: readonly WorkspaceTab[]): WorkspaceTab[] {
  const kinds = new Set(files.map((f) => fileTab(f)).filter(Boolean));
  return WORKSPACE_TABS.filter((t) => on.includes(t) && (t === 'files' || (t === 'review' ? serving : kinds.has(t))));
}

/** What a worker that just finished made and said this turn: since the last thing it was told. */
export function turnOf(messages: ChatMessage[], linked: ChatArtifact[], artifacts: ChatArtifact[], since: number): { said?: string; asked?: string; files: ChatArtifact[] } {
  const lastAsk = messages.reduce((n, m, i) => (m.role === 'user' ? i : n), -1);
  const turn = messages.slice(lastAsk + 1).filter((m) => m.role === 'assistant');
  const said = turn.at(-1)?.text;
  const text = turn.map((m) => m.text).join('\n');
  const start = lastAsk >= 0 ? (messages[lastAsk].at ?? since) : since;
  const seen = new Set<string>();
  const files: ChatArtifact[] = [];
  const add = (f: ChatArtifact) => {
    const key = `${f.root ?? ''}:${f.path}`;
    if (seen.has(key) || files.length >= MAX_FILES) return;
    seen.add(key);
    files.push(f);
  };
  // What it linked this turn (named in what it said, or made since it was asked), then what else it made meanwhile.
  for (const f of linked) if (text.includes(path.basename(f.path)) || f.modified >= start) add(f);
  for (const f of [...artifacts].sort((a, b) => b.modified - a.modified)) if (f.modified >= start) add(f);
  return { said, asked: lastAsk >= 0 ? messages[lastAsk].text : undefined, files };
}

export class ReviewQueue {
  readonly store: ReviewStore;
  private latest = new Map<string, WorkerInfo['status']>();
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(private ctx: Ctx) {
    this.store = new ReviewStore(ctx.cfg.dataDir);
  }

  /** Every worker update, from every floor (office/floors.ts): a worker gone, or one that may have finished. */
  onWorker(floor: Floor, w: WorkerInfo | string) {
    if (typeof w === 'string') {
      this.latest.delete(w);
      this.cancel(w);
      this.store.workerGone(floor.id, w);
      return;
    }
    const prev = this.latest.get(w.id);
    this.latest.set(w.id, w.status);
    // First sight (the office starting) isn't finishing; nor is anything but going to done.
    if (!prev || prev === w.status || w.status !== 'done' || w.kind !== 'agent') return;
    if (w.meeting || DESK_BY_ID.get(w.deskId)?.station) return;
    this.cancel(w.id);
    const timer = setTimeout(() => {
      this.pending.delete(w.id);
      if (this.latest.get(w.id) === 'done') void this.capture(floor, w.id).catch(() => {});
    }, SETTLE_MS);
    timer.unref();
    this.pending.set(w.id, timer);
  }

  private cancel(id: string) {
    const t = this.pending.get(id);
    if (t) clearTimeout(t);
    this.pending.delete(id);
  }

  /** Puts what a worker just finished in the queue. */
  async capture(floor: Floor, id: string): Promise<ReviewItem | undefined> {
    const w = floor.workers.sessionContext(id);
    if (!w || w.info.kind !== 'agent') return undefined;
    const data = path.join(floor.dir, '.agent-office');
    const messages = mergeMessages(await conversation(w, data), chatHistory(data, id));
    // The last thing it was told was an approval: it's only saying it's noted.
    const lastAsk = [...messages].reverse().find((m) => m.role === 'user');
    if (lastAsk?.review?.kind === 'approve') return undefined;
    const links = await workerLinks(floor, id, shareGuard(this.ctx), messages);
    const artifacts = await listArtifacts(defaultRoot(floor, id));
    const turn = turnOf(messages, links.linked, artifacts, w.info.lastInput?.at ?? w.info.createdAt);
    const serving = this.ctx.services.list().some((s) => s.workerId === id);
    const setup = floor.studio.state().setup;
    const on = WORKSPACE_TABS.filter((t) => appOn(setup, t));
    const files = turn.files.map((f) => ({ path: f.path, type: f.type, ...(f.root ? { root: f.root } : {}) }));
    // What it was asked this turn (its first request, or the notes it's working through): its task's name stays its first.
    const task = clip((turn.asked ?? w.info.task?.name ?? w.info.title ?? w.info.prompt ?? 'A task').replace(/\s+/g, ' ').trim(), 200);
    const ask: JevAsk = { task, said: turn.said, files, serving };
    const pick = await this.pick(ask, candidateApps(files, serving, on), on);
    return this.store.add({
      floor: floor.id,
      floorName: floor.def.name,
      workerId: id,
      workerName: w.info.name,
      task,
      ...(turn.said ? { said: clip(turn.said.trim(), 4000) } : {}),
      files,
      ...pick,
    });
  }

  private async pick(ask: JevAsk, apps: WorkspaceTab[], on: readonly WorkspaceTab[]): Promise<Pick<ReviewItem, 'app' | 'by' | 'confidence'>> {
    const fallback = { app: fallbackApp(ask.files, ask.serving, on), by: 'files' as const };
    // One place to look (or only Files): nothing to ask.
    if (apps.filter((a) => a !== 'files').length < 2) return { ...fallback, app: apps.find((a) => a !== 'files') ?? fallback.app };
    const key = typesafeKey(this.ctx.cfg.dataDir);
    const jev = key ? await jevPick(key, ask, apps) : undefined;
    return jev ? { app: jev.app, by: 'jev', confidence: jev.confidence } : fallback;
  }

  /**
   * The queue as it is now: waiting items whose worker has since been approved or sent notes from its window's rooms
   * are decided as that, first.
   */
  view(): ReviewQueueView {
    for (const i of this.store.list()) {
      if (i.state !== 'waiting') continue;
      const floor = this.ctx.floors.get(i.floor);
      if (!floor) continue;
      const later = chatHistory(path.join(floor.dir, '.agent-office'), i.workerId).filter((m) => m.role === 'user' && m.review && (m.at ?? 0) > i.updatedAt);
      const kind = later.at(-1)?.review?.kind;
      if (kind === 'approve') this.store.decide(i.id, 'approved', 'In its room');
      else if (kind === 'notes' || kind === 'variations') this.store.decide(i.id, 'notes', 'In its room');
    }
    const items = [...this.store.list()].sort((a, b) => (a.state === 'waiting' ? 0 : 1) - (b.state === 'waiting' ? 0 : 1) || (a.state === 'waiting' ? a.updatedAt - b.updatedAt : (b.decidedAt ?? 0) - (a.decidedAt ?? 0)));
    return { items, waiting: items.filter((i) => i.state === 'waiting').length, jev: !!typesafeKey(this.ctx.cfg.dataDir) };
  }

  /**
   * Decides an item: approving tells the worker its files are final (as a room's Approve does), notes are sent to it as
   * a message, dismissing tells it nothing, and 'waiting' puts a decided one back. Why not, as a string.
   */
  async decide(id: string, state: ReviewState, by: string, account: string | undefined, notes?: string): Promise<string | undefined> {
    const item = this.store.get(id);
    if (!item) return 'That item is no longer in the queue';
    const floor = this.ctx.floors.get(item.floor);
    const here = floor?.workers.get(item.workerId);
    if ((state === 'approved' || state === 'notes') && floor && here) {
      const denied = employeeWorkerError(this.ctx, floor, account, item.workerId);
      if (denied) return denied;
      const requestId = `queue-${randomUUID()}`;
      if (state === 'notes') {
        const text = (notes ?? '').trim();
        if (!text || !sendable(text)) return 'Write the notes to send (up to 20,000 characters)';
        const sent = sendToWorker(floor, item.workerId, text, requestId, by);
        if (sent.status !== 200) return String((sent.body as { error?: string }).error ?? 'The notes could not be sent');
      } else if (item.files.length) {
        const files = item.files.slice(0, 4).map((f) => (f.root ? { root: f.root, path: f.path } : { path: f.path }));
        const real = await reviewFiles(floor, item.workerId, shareGuard(this.ctx), files);
        if (real) {
          const sent = sendToWorker(floor, item.workerId, reviewText('approve', real), requestId, by, { kind: 'approve', files });
          if (sent.status !== 200) return String((sent.body as { error?: string }).error ?? 'The approval could not be sent');
        }
      }
      if (state === 'approved') this.ctx.toastFloor(floor, `\u2705 ${by} approved ${item.workerName}'s work`);
    } else if (state === 'notes') return `${item.workerName} has gone home: there's nobody to send notes to`;
    this.store.decide(id, state, by);
    return undefined;
  }
}
