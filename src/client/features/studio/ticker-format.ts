import type { Quote, TickerState } from '../../../shared/studio';

// What the stock ticker says, apart from how it's painted (ticker.ts): each price as it's written,
// how a line of them fits a texture, where a face is along it, and the market board's pages.

/** What the market's big indexes are called up there, in place of the symbols the market data knows them by. */
const NAMES: Readonly<Record<string, string>> = { '^GSPC': 'S&P 500', '^DJI': 'DOW', '^IXIC': 'NASDAQ', '^RUT': 'RUSSELL', '^VIX': 'VIX', '^FTSE': 'FTSE 100', '^N225': 'NIKKEI' };

/** A symbol as a ticker has it: an index by its name, crypto without the dollars it's priced in ("BTC-USD" is "BTC"). */
export function tickerName(symbol: string): string {
  return NAMES[symbol] ?? symbol.replace(/^\^/, '').replace(/-USD$/, '').replace(/=[XF]$/, '');
}

/** How many decimal places a price is written to: cents on most, none on the ones in the tens of thousands, and more on what's under a dollar. */
const places = (n: number) => (Math.abs(n) >= 10_000 ? 0 : Math.abs(n) >= 1 ? 2 : 4);

/** A price as it's written, to its own number of places or to `digits` (how far it moved is written to the price's). */
export function tickerPrice(n: number, digits = places(n)): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** One price, ready to paint: what it's called, what it's at, and how far it's moved since the last close. */
export interface TickerItem {
  name: string;
  price: string;
  /** How far it's moved, without its sign: the arrow and the color say which way. */
  change: string;
  pct: string;
  up: boolean;
}

export function tickerItem(q: Quote): TickerItem {
  return { name: tickerName(q.symbol), price: tickerPrice(q.price), change: tickerPrice(Math.abs(q.change), places(q.price)), pct: `${Math.abs(q.pct).toFixed(2)}%`, up: q.change >= 0 };
}

/** What a ticker shows: the floor's prices, or a line about why there are none. */
export type TickerShow = { items: TickerItem[]; at: number } | { note: string };

export const TICKER_NOTES = {
  idle: 'Add ticker symbols in the floor’s setup',
  reading: 'Reading the market’s prices…',
  failed: 'The market’s prices can’t be read just now',
} as const;

/**
 * What goes up for a floor with these `symbols` set, given the prices the office last read: the floor's
 * symbols decide whether there's a ticker at all, so taking them away clears it before the prices follow.
 */
export function tickerShow(state: TickerState, symbols: readonly string[]): TickerShow {
  if (!symbols.length) return { note: TICKER_NOTES.idle };
  if (state.quotes.length) return { items: state.quotes.map(tickerItem), at: state.at };
  return { note: state.error ? TICKER_NOTES.failed : TICKER_NOTES.reading };
}

/**
 * The canvas a line of prices `total` px long and `height` px high is painted on: scaled down as a
 * whole where it's longer than a texture may be (`limit`), and a whole number of LEDs (`grid` px
 * each) both ways, so the dots meet where the line comes round again.
 */
export function fitStrip(total: number, height: number, limit: number, grid: number): { width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(1, total));
  const cells = (px: number) => Math.max(1, Math.round((px * scale) / grid));
  const most = Math.max(1, Math.floor(limit / grid));
  return { width: Math.min(most, cells(total)) * grid, height: cells(height) * grid };
}

/**
 * Where along the line (in passes of it) the point `x` meters from the middle of a face is, on a face
 * `len` long that one pass covers `span` meters of. A face that's mirrored rather than turned runs the
 * other way, so what's on it still reads left to right.
 */
export function stripU(x: number, len: number, span: number, mirrored = false): number {
  return ((mirrored ? -x : x) + len / 2) / span;
}

/** The most rows the market board shows at once. */
export const BOARD_ROWS = 8;

/** The board's pages: as few as hold every row, each as full as the others (nine prices are five and four, not eight and one). */
export function boardPages<T>(rows: readonly T[], most = BOARD_ROWS): T[][] {
  const pages = Math.max(1, Math.ceil(rows.length / most));
  const each = Math.ceil(rows.length / pages);
  return Array.from({ length: pages }, (_, i) => rows.slice(i * each, (i + 1) * each));
}
