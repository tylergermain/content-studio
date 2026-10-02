import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StationKind } from '../shared/layout.js';
import { LIMITS, STUDIO_BOARDS, cleanPost, cleanSetup, isStudioBoard, postingBrief, type BoardFeed, type Post, type StudioBoard, type StudioSetup, type StudioState } from '../shared/studio.js';

/**
 * A floor made its own (see shared/studio.ts): what its wall boards are for and what's posted on
 * them, and who stands at its kiosks. Saved in .agent-office/studio.json.
 */
export class Studio {
  private setup: StudioSetup;
  private posts: Post[];
  private seen: StudioState['seen'];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'studio.json');
    const saved = this.load();
    this.setup = saved.setup;
    this.posts = saved.posts;
    this.seen = saved.seen;
  }

  state(): StudioState {
    return structuredClone({ setup: this.setup, posts: this.posts, seen: this.seen });
  }

  /** The boards the office fills by itself, and from what (see feeds.ts). */
  feeds(): { board: StudioBoard; feed: BoardFeed }[] {
    return STUDIO_BOARDS.flatMap((board) => (this.setup.boards[board]?.feed ? [{ board, feed: this.setup.boards[board]!.feed! }] : []));
  }

  /** What a board the office fills by itself shows now: whether that's any different from before. */
  fill(board: StudioBoard, posts: Omit<Post, 'board'>[]): boolean {
    const before = JSON.stringify(this.posts.filter((p) => p.board === board));
    const now = posts.slice(0, LIMITS.posts).map((p) => ({ ...p, board }));
    if (JSON.stringify(now) === before) return false;
    this.posts = [...this.posts.filter((p) => p.board !== board), ...now].sort((a, b) => b.at - a.at);
    this.save();
    return true;
  }

  /** Someone opened a board: what's on it now isn't new any more. */
  look(board: unknown): boolean {
    if (!isStudioBoard(board) || !this.setup.boards[board]) return false;
    this.seen[board] = Date.now();
    this.save();
    return true;
  }

  /** The symbols this floor's ticker shows. */
  symbols(): string[] {
    return this.setup.ticker?.symbols ?? [];
  }

  /** What the agent at a kiosk is called here, when the floor has its own. */
  agentName(kind: StationKind): string | undefined {
    return this.setup.agents[kind]?.name;
  }

  /**
   * What the agent at a kiosk is told when it's hired, when the floor has briefed it: who it is, the
   * floor's own brief, and how to post to the floor's boards. The first request follows.
   */
  brief(kind: StationKind, floor: string): string | undefined {
    const a = this.setup.agents[kind];
    if (!a?.brief) return undefined;
    return [
      `You're the ${a.name} on the ${floor} floor of a shared 3D office where a team works alongside AI agents. You stand at a kiosk, and whoever walks up types you a request. The first one is at the end of this message.`,
      a.brief,
      postingBrief(this.setup),
      `When you've done what was asked, say in a few lines what you did, with links. Then wait: the next request may come from someone else.`,
      `The request:`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Makes the floor's boards and agents what `raw` says (see cleanSetup). Posts on a board that's gone go with it. */
  configure(raw: unknown) {
    this.setup = cleanSetup(raw);
    this.posts = this.posts.filter((p) => this.setup.boards[p.board]);
    this.save();
  }

  /** Puts a post up on one of the floor's boards. The post, or why it can't. */
  post(raw: unknown, by: string): Post | string {
    const clean = cleanPost(raw);
    if (typeof clean === 'string') return clean;
    if (!this.setup.boards[clean.board]) return 'This floor has no such board';
    if (this.setup.boards[clean.board]!.feed) return 'The office fills that board by itself';
    const same = this.posts.find((p) => p.board === clean.board && ((clean.url && p.url === clean.url) || p.title.toLowerCase() === clean.title.toLowerCase()));
    if (same) return `That's already on the board (${same.id}): "${same.title}"`;
    const post: Post = { id: randomBytes(4).toString('hex'), ...clean, by, at: Date.now() };
    this.posts.unshift(post);
    // The oldest come off a board that's full.
    for (const board of STUDIO_BOARDS) {
      const on = this.posts.filter((p) => p.board === board);
      for (const old of on.slice(LIMITS.posts)) this.posts.splice(this.posts.indexOf(old), 1);
    }
    this.save();
    return post;
  }

  /** Takes a post down. The post, or why it can't. */
  remove(id: unknown): Post | string {
    const post = this.posts.find((p) => p.id === id);
    if (!post) return 'No such post';
    this.posts = this.posts.filter((p) => p !== post);
    this.save();
    return post;
  }

  private load(): StudioState {
    if (!existsSync(this.file)) return { setup: cleanSetup(undefined), posts: [], seen: {} };
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { setup?: unknown; posts?: unknown; seen?: Record<string, unknown> };
      const setup = cleanSetup(raw.setup);
      const posts: Post[] = [];
      for (const p of Array.isArray(raw.posts) ? (raw.posts as Partial<Post>[]) : []) {
        const clean = cleanPost(p);
        if (typeof clean === 'string' || !isStudioBoard(p.board) || !setup.boards[p.board] || typeof p.id !== 'string') continue;
        posts.push({ id: p.id.slice(0, 16), ...clean, by: typeof p.by === 'string' ? p.by.slice(0, 60) : '?', at: typeof p.at === 'number' ? p.at : 0 });
      }
      const seen: StudioState['seen'] = {};
      for (const b of STUDIO_BOARDS) if (typeof raw.seen?.[b] === 'number') seen[b] = raw.seen[b] as number;
      return { setup, posts, seen };
    } catch {
      // a broken file just means the floor as it comes
      return { setup: cleanSetup(undefined), posts: [], seen: {} };
    }
  }

  private save() {
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify({ setup: this.setup, posts: this.posts, seen: this.seen }, null, 2), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
