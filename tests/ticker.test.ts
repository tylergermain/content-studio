// The stock ticker (client/features/studio/ticker-format.ts): what a bar and a market board say for a
// floor's prices, how a line of them fits a texture, and where a bar's faces are along it. And the two
// pieces of furniture that show them (shared/furniture.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_ROWS, TICKER_NOTES, boardPages, fitStrip, stripU, tickerItem, tickerName, tickerPrice, tickerShow } from '../src/client/features/studio/ticker-format.js';
import { FURNITURE, cleanFurniture, pieceCollider, type KindDef } from '../src/shared/furniture.js';
import type { Quote } from '../src/shared/studio.js';

const quote = (symbol: string, price: number, change: number): Quote => ({ symbol, price, change, pct: (change / (price - change)) * 100 });

test('a price is written the way a ticker has it: indexes by name, cents where they matter, the arrow for the sign', () => {
  assert.equal(tickerName('AAPL'), 'AAPL');
  assert.equal(tickerName('^GSPC'), 'S&P 500');
  assert.equal(tickerName('^XYZ'), 'XYZ');
  assert.equal(tickerName('BTC-USD'), 'BTC');
  assert.equal(tickerName('EURUSD=X'), 'EURUSD');
  assert.equal(tickerName('BRK.B'), 'BRK.B');
  assert.equal(tickerPrice(330.3), '330.30');
  assert.equal(tickerPrice(7666.45), '7,666.45');
  assert.equal(tickerPrice(86050.55), '86,051');
  assert.equal(tickerPrice(0.12345), '0.1235');
  assert.deepEqual(tickerItem(quote('AAPL', 330.32, -2.7)), { name: 'AAPL', price: '330.32', change: '2.70', pct: '0.81%', up: false });
  // How far it moved is written to the price's places, not its own: ten cents on a $500 stock is 0.10.
  assert.equal(tickerItem(quote('MSFT', 512.8, -0.1)).change, '0.10');
  assert.equal(tickerItem(quote('BTC-USD', 86050.55, 1200.62)).change, '1,201');
  assert.equal(tickerItem(quote('FLAT', 10, 0)).up, true);
});

test('a floor with no symbols says where to set them; one with symbols shows its prices, or why there are none yet', () => {
  const quotes = [quote('AAPL', 330.32, -2.7), quote('NVDA', 230.86, 2.48)];
  assert.deepEqual(tickerShow({ quotes: [], at: 0 }, []), { note: TICKER_NOTES.idle });
  assert.match(TICKER_NOTES.idle, /^Add ticker symbols in the floor.s setup$/);
  // The symbols were just taken away, and the prices haven't followed yet: it's idle already.
  assert.deepEqual(tickerShow({ quotes, at: 5 }, []), { note: TICKER_NOTES.idle });
  assert.deepEqual(tickerShow({ quotes: [], at: 0 }, ['AAPL']), { note: TICKER_NOTES.reading });
  assert.deepEqual(tickerShow({ quotes: [], at: 9, error: 'The market\'s prices couldn\'t be read: fetch failed' }, ['AAPL']), { note: TICKER_NOTES.failed });
  const live = tickerShow({ quotes, at: 9 }, ['AAPL', 'NVDA']);
  assert.ok('items' in live);
  assert.deepEqual(live.items.map((i) => `${i.name} ${i.price} ${i.up ? '+' : '-'}${i.pct}`), ['AAPL 330.32 -0.81%', 'NVDA 230.86 +1.09%']);
  assert.equal(live.at, 9);
});

test('a line of prices is painted at full size while it fits a texture, and scaled down as a whole when it does not', () => {
  assert.deepEqual(fitStrip(9364, 128, 16384, 4), { width: 9364, height: 128 });
  // Not a whole number of LEDs long: the nearest that is, so the dots meet at the seam.
  assert.deepEqual(fitStrip(9365.4, 128, 16384, 4), { width: 9364, height: 128 });
  const long = fitStrip(36000, 128, 16384, 4);
  assert.ok(long.width <= 16384 && long.width % 4 === 0 && long.height % 4 === 0, JSON.stringify(long));
  // The same shape as it was, near enough: the letters aren't squeezed.
  assert.ok(Math.abs(long.width / long.height - 36000 / 128) / (36000 / 128) < 0.04, JSON.stringify(long));
  assert.deepEqual(fitStrip(0, 128, 8192, 4), { width: 4, height: 128 });
});

test('a face shows the stretch of the line that fits its length, left to right, and a mirrored one still does', () => {
  // A 5.84 m face on a line that takes 21.9 m to come round: just over a quarter of it.
  const [left, right] = [stripU(-2.92, 5.84, 21.9), stripU(2.92, 5.84, 21.9)];
  assert.equal(left, 0);
  assert.ok(Math.abs(right - 5.84 / 21.9) < 1e-9);
  // A line shorter than the face comes round again along it.
  assert.ok(stripU(2.92, 5.84, 2) > 2);
  assert.equal(stripU(2.92, 5.84, 21.9, true), 0);
  assert.ok(Math.abs(stripU(-2.92, 5.84, 21.9, true) - right) < 1e-9);
});

test('the market board turns its prices over a page at a time, each page as full as the others', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);
  assert.deepEqual(boardPages(rows(0)), [[]]);
  assert.deepEqual(boardPages(rows(BOARD_ROWS)).map((p) => p.length), [BOARD_ROWS]);
  assert.deepEqual(boardPages(rows(9)).map((p) => p.length), [5, 4]);
  assert.deepEqual(boardPages(rows(30)).map((p) => p.length), [8, 8, 8, 6]);
  assert.deepEqual(boardPages(rows(30)).flat(), rows(30));
});

test('the ticker bar hangs clear of the floor, and the market board stands on it', () => {
  const kinds: Record<string, KindDef> = FURNITURE;
  assert.equal(kinds.ticker.group, 'Work');
  assert.equal(kinds['ticker-screen'].group, 'Work');
  // Neither is a video screen: features/screens leaves them alone.
  assert.ok(!kinds.ticker.plays && !kinds['ticker-screen'].plays);
  assert.equal(pieceCollider({ id: 'bar', kind: 'ticker', x: 0, z: 0, rotY: 0 }), undefined);
  assert.deepEqual(pieceCollider({ id: 'board', kind: 'ticker-screen', x: 2, z: 3, rotY: Math.PI / 2 }), { minX: 1.85, maxX: 2.15, minZ: 2.2, maxZ: 3.8, top: 1.5 });
  // The board's frame can be painted; the bar is what it is.
  assert.deepEqual(cleanFurniture([{ id: 'bar', kind: 'ticker', x: 0, z: 0, rotY: 0, color: '#ff0000' }, { id: 'board', kind: 'ticker-screen', x: 2, z: 3, rotY: 0, color: '#FF0000' }]), [
    { id: 'bar', kind: 'ticker', x: 0, z: 0, rotY: 0 },
    { id: 'board', kind: 'ticker-screen', x: 2, z: 3, rotY: 0, color: '#ff0000' },
  ]);
});
