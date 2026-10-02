// A floor made its own: what its wall boards are for, who stands at its kiosks, and the prices on
// its stock ticker. The office as it comes has an Issues board and a Pull Requests board, with an agent by
// each (and one by the task queue), all about a GitHub repository. A floor that's a team's place
// rather than a repository's can turn either board into a bulletin of its own ("Newsroom", "Leads"),
// which its people and its agents post to, and brief each kiosk's agent for the job it has there.
// Kept per floor by server/studio.ts, in .agent-office/studio.json.

import type { StationKind } from './layout.js';

/** The wall boards a floor can make its own: the ones that hang where Issues and Pull Requests do. */
export const STUDIO_BOARDS = ['issues', 'pulls'] as const;
export type StudioBoard = (typeof STUDIO_BOARDS)[number];
export const STUDIO_AGENTS: readonly StationKind[] = ['issues', 'queue', 'pulls'];

/** A wall board as a floor has it: a bulletin, with this over it. */
export interface BoardSetup {
  /** What it's called, on the sign over it: "Newsroom". */
  title: string;
  icon: string;
  /** What goes on it, in a line: told to the agents that post to it, and shown in its window. */
  about: string;
  /** Where its posts come from, when it isn't people and agents posting: the office reads them itself (server/feeds.ts). */
  feed?: BoardFeed;
}

/** A board the office fills by itself: the latest in some Slack channels, or how the socials are doing on Metricool. */
export type BoardFeed = { kind: 'slack'; channels: SlackChannel[] } | { kind: 'metricool' };

export interface SlackChannel {
  id: string;
  name: string;
}

/** A kiosk's agent as a floor has it. */
export interface AgentSetup {
  /** What it's called: "News agent". */
  name: string;
  /** What it says it's for, on the card over its head: "Ask me for today's news". */
  offer: string;
  /** What it's told when it's hired, ahead of the first request typed to it. */
  brief: string;
}

/** The floor's stock ticker (the bar and the market board in the builder's catalog): the symbols they show, in order. None, and there are no prices to show. */
export interface TickerSetup {
  symbols: string[];
}

export interface StudioSetup {
  boards: Partial<Record<StudioBoard, BoardSetup>>;
  agents: Partial<Record<StationKind, AgentSetup>>;
  ticker?: TickerSetup;
}

/** Something posted to one of a floor's bulletin boards. */
export interface Post {
  id: string;
  board: StudioBoard;
  title: string;
  /** A few lines more: what it's about, why it matters. */
  body?: string;
  /** Where it's from, to open. */
  url?: string;
  /** Who published it: "The Verge". */
  source?: string;
  /** Who put it on the board: a person's name or a worker's. */
  by: string;
  at: number;
}

export interface StudioState {
  setup: StudioSetup;
  /** Newest first. */
  posts: Post[];
  /** When someone on the floor last opened each board: what's been posted since is new. */
  seen: Partial<Record<StudioBoard, number>>;
}

export const EMPTY_STUDIO: StudioState = { setup: { boards: {}, agents: {} }, posts: [], seen: {} };

/** How many of a board's posts are new: put up since someone last opened it. */
export function unseen(studio: StudioState, board: StudioBoard): number {
  const since = studio.seen[board] ?? 0;
  return studio.posts.filter((p) => p.board === board && p.at > since).length;
}

/** What the office is signed in to, for the boards it fills by itself. Never the tokens themselves. */
export interface IntegrationsState {
  slack: boolean;
  metricool: boolean;
  /** Why the last read didn't work, by which it was. */
  errors: { slack?: string; metricool?: string };
}

export const NO_INTEGRATIONS: IntegrationsState = { slack: false, metricool: false, errors: {} };

/** A price on the ticker. */
export interface Quote {
  symbol: string;
  price: number;
  /** How far it's moved since the last close, and that as a percentage. */
  change: number;
  pct: number;
}

export interface TickerState {
  quotes: Quote[];
  /** When they were read, or 0 before the first time. */
  at: number;
  /** Why there are none, when the market's data couldn't be read. */
  error?: string;
}

export const LIMITS = { title: 140, body: 600, url: 500, source: 60, name: 40, offer: 60, about: 200, brief: 6000, posts: 60, symbols: 30 } as const;

const flat = (v: unknown, max: number): string =>
  typeof v === 'string'
    ? [...v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim()
    : '';
/** Text that keeps its lines (a brief, a post's body). */
const lines = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim().slice(0, max) : '');

export function isStudioBoard(v: unknown): v is StudioBoard {
  return (STUDIO_BOARDS as readonly unknown[]).includes(v);
}

/** A link someone can be sent to: http or https, or nothing. */
export function cleanUrl(v: unknown): string | undefined {
  const s = flat(v, LIMITS.url);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : undefined;
}

/** A ticker symbol as the market data knows it: letters, digits, and the dots, dashes, carets and equals signs some have (BRK.B, BTC-USD, ^GSPC). */
export function cleanSymbol(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z0-9^][A-Z0-9.\-=^]{0,11}$/.test(s) ? s : undefined;
}

function cleanFeed(raw: unknown): BoardFeed | undefined {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (r.kind === 'metricool') return { kind: 'metricool' };
  if (r.kind !== 'slack') return undefined;
  const channels: SlackChannel[] = [];
  for (const c of Array.isArray(r.channels) ? (r.channels as Record<string, unknown>[]) : []) {
    const id = typeof c?.id === 'string' && /^[A-Z][A-Z0-9]{5,15}$/.test(c.id) ? c.id : undefined;
    const name = flat(c?.name, 80).replace(/^#/, '');
    if (id && name && !channels.some((x) => x.id === id) && channels.length < 12) channels.push({ id, name });
  }
  return { kind: 'slack', channels };
}

/** A setup from somewhere it can't be trusted (a browser, a file): what's valid of it. */
export function cleanSetup(raw: unknown): StudioSetup {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const setup: StudioSetup = { boards: {}, agents: {} };
  const boards = r.boards && typeof r.boards === 'object' ? (r.boards as Record<string, unknown>) : {};
  for (const key of STUDIO_BOARDS) {
    const b = boards[key] && typeof boards[key] === 'object' ? (boards[key] as Record<string, unknown>) : undefined;
    const title = flat(b?.title, LIMITS.name);
    const feed = cleanFeed(b?.feed);
    if (b && title) setup.boards[key] = { title, icon: [...flat(b.icon, 8)].slice(0, 2).join('') || '📌', about: flat(b.about, LIMITS.about), ...(feed ? { feed } : {}) };
  }
  const agents = r.agents && typeof r.agents === 'object' ? (r.agents as Record<string, unknown>) : {};
  for (const key of STUDIO_AGENTS) {
    const a = agents[key] && typeof agents[key] === 'object' ? (agents[key] as Record<string, unknown>) : undefined;
    const name = flat(a?.name, LIMITS.name);
    if (a && name) setup.agents[key] = { name, offer: flat(a.offer, LIMITS.offer), brief: lines(a.brief, LIMITS.brief) };
  }
  const t = r.ticker && typeof r.ticker === 'object' ? (r.ticker as Record<string, unknown>) : undefined;
  const symbols = Array.isArray(t?.symbols) ? [...new Set(t.symbols.map(cleanSymbol).filter((s): s is string => !!s))].slice(0, LIMITS.symbols) : [];
  if (symbols.length) setup.ticker = { symbols };
  return setup;
}

/** What someone's posting, as it's kept: its title at least, or why it won't do. */
export function cleanPost(raw: unknown): Omit<Post, 'id' | 'by' | 'at'> | string {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (!isStudioBoard(r.board)) return 'Say which board it goes on';
  const title = flat(r.title, LIMITS.title);
  if (!title) return 'A post needs a title';
  if (r.url !== undefined && r.url !== '' && !cleanUrl(r.url)) return 'The link has to start with http:// or https://';
  const body = lines(r.body, LIMITS.body);
  const url = cleanUrl(r.url);
  const source = flat(r.source, LIMITS.source);
  return { board: r.board, title, ...(body ? { body } : {}), ...(url ? { url } : {}), ...(source ? { source } : {}) };
}

/** The board a floor calls `name`: by which of the two it is, or by its title ("newsroom"); with no name, the first it has. */
export function boardNamed(setup: StudioSetup, name: unknown): StudioBoard | undefined {
  if (isStudioBoard(name)) return setup.boards[name] ? name : undefined;
  const want = flat(name, LIMITS.name).toLowerCase();
  if (!want) return STUDIO_BOARDS.find((key) => setup.boards[key]);
  return STUDIO_BOARDS.find((key) => setup.boards[key]?.title.toLowerCase() === want);
}

/** How to post to the floor's boards, for the brief of an agent that does: the boards there are, and the command. */
export function postingBrief(setup: StudioSetup): string {
  const boards = STUDIO_BOARDS.flatMap((key) => (setup.boards[key] ? [`- "${setup.boards[key]!.title}": ${setup.boards[key]!.about || 'whatever the team wants up there'}`] : []));
  if (!boards.length) return '';
  return [
    `This floor has bulletin boards on its wall, which everyone on the floor reads:`,
    ...boards,
    `Post to one with the office-board command, which is on your PATH (it knows who you are, so don't export anything):`,
    `- See what's up: office-board list [--board "Title"]`,
    `- Post: office-board post --board "Title" --title "One clear headline" [--url https://…] [--source "Who published it"], with a few lines about it on stdin in a quoted heredoc (or --body "…"). It prints the post's id.`,
    `- Take one down: office-board remove <id>`,
    `Post each thing once, with its real link: check what's already up before adding, and never post something you haven't verified at its source.`,
  ].join('\n');
}
