import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Arcade, CLOCK_SLACK, GAME_BURST, GAME_EVERY, HighScores, MOVE_BURST, MOVES_PER_SECOND, RECORD_EVERY, STEP_BURST, STEPS_PER_SECOND, WIN_FLOOR, tilePoints, type Player } from '../src/server/cabinet.js';
import { cabinetHandlers, cabinetHooks, cabinetState } from '../src/server/ws/handlers/cabinet.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import { GAME_TITLES, MINE_CELLS, SCORES_KEPT, SNAKE_START, TITLES, beats, checkFrame, checkTitle, scoreLine, tableOf, type GameTitle, type HighScore, type MinesFrame, type SnakeFrame, type TilesFrame } from '../src/shared/cabinet.js';
import type { ServerMsg } from '../src/shared/protocol.js';
import { Snake } from '../src/client/features/arcade/snake.js';
import { Twenty48 } from '../src/client/features/arcade/twenty48.js';

// The building's high scores, one table per game (server/cabinet.ts): how each is ordered, the scores
// from before there were games other than Blockfall, and what the office takes for a score.

const game = (n: number) => `game${String(n).padStart(8, '0')}`;
const entry = (n: number, score: number, title?: GameTitle, name = 'Ada'): Omit<HighScore, 'at'> => ({ game: game(n), ...(title ? { title } : {}), name, color: '#ef476f', score, lines: 0, level: 1 });
const folder = (t: TestContext) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const scoresOf = (list: HighScore[], title: GameTitle) => tableOf(list, title).map((s) => s.score);

test('every game has a table of its own, and says how it is scored', () => {
  assert.deepEqual([...GAME_TITLES], ['blockfall', '2048', 'snake', 'minesweeper']);
  for (const t of GAME_TITLES) assert.ok(TITLES[t].name && TITLES[t].scored, `${t} says how it's scored`);
  // Points and length: more is better. A cleared field: fewer seconds is.
  for (const t of ['blockfall', '2048', 'snake'] as const) assert.ok(beats(t, 10, 9) && !beats(t, 9, 10) && !beats(t, 9, 9), t);
  assert.ok(beats('minesweeper', 41, 42) && !beats('minesweeper', 42, 41) && !beats('minesweeper', 42, 42));
  assert.deepEqual([scoreLine('blockfall', 12400), scoreLine('2048', 20480), scoreLine('snake', 24), scoreLine('minesweeper', 42)], ['12,400', '20,480', '24 long', '42s']);
});

test('each table is in its own order, and one game’s scores never crowd out another’s', (t) => {
  const table = new HighScores(folder(t));
  let n = 0;
  for (const score of [300, 900, 600]) table.record(entry(++n, score), entry(++n, score, '2048'), entry(++n, score, 'snake'), entry(++n, score, 'minesweeper'));
  assert.deepEqual(scoresOf(table.top(), 'blockfall'), [900, 600, 300]);
  assert.deepEqual(scoresOf(table.top(), '2048'), [900, 600, 300]);
  assert.deepEqual(scoresOf(table.top(), 'snake'), [900, 600, 300]);
  assert.deepEqual(scoresOf(table.top(), 'minesweeper'), [300, 600, 900], 'the fastest win first');
  // One after another, in the order the games are listed.
  assert.deepEqual(table.top().map((s) => s.title ?? 'blockfall'), GAME_TITLES.flatMap((title) => [title, title, title]));

  // A full Minesweeper table drops its slowest, and leaves the others as they were.
  for (let i = 0; i < SCORES_KEPT; i++) table.record(entry(++n, 100 + i, 'minesweeper'));
  const mines = scoresOf(table.top(), 'minesweeper');
  assert.equal(mines.length, SCORES_KEPT);
  assert.deepEqual(mines, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  assert.equal(table.record(entry(++n, 500, 'minesweeper')).changed, false, 'slower than every win on a full table');
  assert.deepEqual(scoresOf(table.top(), 'snake'), [900, 600, 300]);
  // Of two the same, the one that got there first stays ahead.
  const first = tableOf(table.top(), 'minesweeper')[0].game;
  table.record(entry(++n, 100, 'minesweeper', 'Grace'));
  assert.equal(tableOf(table.top(), 'minesweeper')[0].game, first);
});

test('a new leader is news on its own table, whichever game it is', (t) => {
  const table = new HighScores(folder(t));
  const news = (r: { changed: boolean; first: HighScore | null }) => r.first?.game ?? null;
  assert.equal(news(table.record(entry(1, 5000))), game(1));
  // The first Snake score leads Snake, though it's nowhere near Blockfall's.
  assert.equal(news(table.record(entry(2, 12, 'snake'))), game(2));
  assert.equal(news(table.record(entry(3, 9, 'snake'))), null);
  assert.equal(news(table.record(entry(4, 60, 'minesweeper'))), game(4));
  // A slower win isn't, a faster one is.
  assert.equal(news(table.record(entry(5, 75, 'minesweeper'))), null);
  assert.equal(news(table.record(entry(6, 41, 'minesweeper'))), game(6));
  // The same game only ever betters its own score: up for points, and not at all for someone else.
  assert.equal(table.record(entry(2, 11, 'snake')).changed, false);
  assert.equal(table.record(entry(2, 30, 'snake', 'Mallory')).changed, false);
  assert.equal(table.record(entry(2, 14, 'snake')).changed, true);
  assert.deepEqual(scoresOf(table.top(), 'snake'), [14, 9]);
});

test('the scores saved before there were other games carry over as Blockfall’s table, in the same file', (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'arcade.json');
  // arcade.json as it was: a list of games, none saying which game it's at.
  const before = [
    { game: game(1), name: 'Ada', color: '#ef476f', score: 12400, lines: 31, level: 4, at: 1 },
    { game: game(2), name: 'Grace', color: '#06d6a0', score: 800, lines: 4, level: 1, at: 2 },
  ];
  writeFileSync(file, JSON.stringify(before, null, 2));
  const table = new HighScores(dir);
  assert.deepEqual(tableOf(table.top(), 'blockfall'), before);
  for (const title of ['2048', 'snake', 'minesweeper'] as const) assert.deepEqual(tableOf(table.top(), title), []);

  // The other games' scores go in the same list, saying which game they're at; the old ones are as they were.
  table.record(entry(3, 24, 'snake', 'Linus'), entry(4, 42, 'minesweeper', 'Linus'), entry(5, 300));
  const saved = JSON.parse(readFileSync(file, 'utf8')) as HighScore[];
  assert.ok(Array.isArray(saved));
  assert.deepEqual(saved.slice(0, 2), before);
  assert.deepEqual(
    saved.map((s) => [s.title ?? null, s.name, s.score]),
    [
      [null, 'Ada', 12400],
      [null, 'Grace', 800],
      [null, 'Ada', 300],
      ['snake', 'Linus', 24],
      ['minesweeper', 'Linus', 42],
    ],
  );
  // And it all comes back after a restart.
  assert.deepEqual(new HighScores(dir).top(), table.top());
});

test('a saved score at a game the office doesn’t know is left out', (t) => {
  const dir = folder(t);
  writeFileSync(
    path.join(dir, 'arcade.json'),
    JSON.stringify([
      { ...entry(1, 300), at: 1 },
      { ...entry(2, 50, 'snake'), at: 2 },
      { ...entry(3, 999), title: 'pong', at: 3 },
      { ...entry(4, 999), title: 7, at: 4 },
      { ...entry(5, 20, 'minesweeper'), score: -3, at: 5 },
    ]),
  );
  assert.deepEqual(
    new HighScores(dir)
      .top()
      .map((s) => [s.title ?? 'blockfall', s.score]),
    [
      ['blockfall', 300],
      ['snake', 50],
    ],
  );
  assert.equal(checkTitle(undefined), 'blockfall');
  assert.equal(checkTitle('snake'), 'snake');
  assert.equal(checkTitle('pong'), null);
  assert.equal(checkTitle(null), null);
});

// ---- The office following the other games ---------------------------------------------------------

const ada: Player = { owner: 'name:Ada', name: 'Ada', color: '#ef476f' };
const grace: Player = { owner: 'account:grace', name: 'Grace', color: '#06d6a0' };

function arcadeFor(t: TestContext) {
  const dir = folder(t);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const table = new HighScores(dir);
  const news: string[] = [];
  const arcade = new Arcade(table, (first) => first && news.push(`${first.score.title ?? 'blockfall'}:${first.score.name}`));
  return { table, arcade, news, tick: (ms: number) => t.mock.timers.tick(ms) };
}

const snake = ({ long = SNAKE_START, ...f }: Partial<SnakeFrame> & { long?: number } = {}): SnakeFrame => ({ body: Array.from({ length: long }, (_, i) => 100 - i), apple: 5, dir: 0, steps: 0, state: 'play', ...f });
const tiles = (list: number[], f: Partial<TilesFrame> = {}): TilesFrame => ({ tiles: [...list, ...new Array<number>(16 - list.length).fill(0)], score: 0, moves: 0, state: 'play', ...f });
const mines = (f: Partial<MinesFrame> = {}): MinesFrame => ({ cells: 'h'.repeat(MINE_CELLS), seconds: 0, state: 'playing', ...f });

test('frames are only frames of the game they are for', () => {
  const s = snake({ long: 5, steps: 9 });
  assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(s)), 'snake'), s);
  assert.equal(checkFrame(s, 'blockfall'), null);
  assert.equal(checkFrame(s, '2048'), null);
  assert.equal(checkFrame({ ...s, body: [1, 2] }, 'snake'), null, 'shorter than a snake starts');
  assert.equal(checkFrame({ ...s, body: [1, 2, 9999] }, 'snake'), null, 'off the grass');
  assert.equal(checkFrame({ ...s, dir: 4 }, 'snake'), null);
  const b = tiles([2, 4, 2048]);
  assert.deepEqual(checkFrame(b, '2048'), b);
  assert.equal(checkFrame(tiles([3]), '2048'), null, 'not a power of two');
  assert.equal(checkFrame(tiles([262144]), '2048'), null, 'bigger than sixteen cells can make');
  assert.equal(checkFrame({ ...b, tiles: b.tiles.slice(1) }, '2048'), null);
  const m = mines({ cells: `012345678fmbx${'h'.repeat(MINE_CELLS - 13)}`, state: 'lost' });
  assert.deepEqual(checkFrame(m, 'minesweeper'), m);
  assert.equal(checkFrame(mines({ cells: `<${'h'.repeat(MINE_CELLS - 1)}` }), 'minesweeper'), null);
  assert.equal(checkFrame(mines({ seconds: -1 }), 'minesweeper'), null);
  assert.equal(checkFrame(mines({ state: 'over' as never }), 'minesweeper'), null);
});

test('a real Snake game goes on Snake’s table at the length it got to', (t) => {
  const { arcade, table, news, tick } = arcadeFor(t);
  // Every apple in the first free cell, so it's always in the top left: up to the top row, then along it.
  const g = new Snake(() => 0);
  const id = arcade.start(ada, undefined, 'snake');
  const send = () => assert.equal(arcade.frame(id, g.frame(), 'f1'), 'ok', `at ${g.length} long`);
  const go = (code: string, n: number) => {
    g.key(code, true);
    for (let i = 0; i < n && g.state === 'play'; i++) {
      g.update(1);
      tick(140);
      send();
    }
  };
  go('ArrowUp', g.head.y);
  go('ArrowLeft', g.head.x);
  assert.equal(g.length, SNAKE_START + 1);
  // Left on into the wall.
  go('ArrowLeft', 3);
  assert.equal(g.state, 'over');
  tick(1);
  assert.deepEqual(
    table.top().map((s) => [s.title, s.game, s.name, s.score]),
    [['snake', id, 'Ada', SNAKE_START + 1]],
  );
  assert.deepEqual(news, ['snake:Ada']);
  // Over: nothing more for it.
  assert.equal(arcade.frame(id, g.frame(), 'f1'), 'none');
});

test('a snake that never ate has nothing to show, and a forged one is off the table', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  const hungry = arcade.start(ada, undefined, 'snake');
  tick(2000);
  assert.equal(arcade.frame(hungry, snake({ steps: 12, state: 'over' }), 'f1'), 'ok');
  // Longer than its steps could have fed it.
  const fat = arcade.start(ada, undefined, 'snake');
  tick(2000);
  assert.equal(arcade.frame(fat, snake({ long: 10, steps: 6 }), 'f1'), 'void');
  // Straight in at the whole screen: more steps than anyone takes in the time.
  const instant = arcade.start(grace, undefined, 'snake');
  assert.equal(arcade.frame(instant, snake({ long: 500, steps: 497 }), 'f1'), 'void');
  // Getting shorter, or its steps going back.
  const shrinks = arcade.start(grace, undefined, 'snake');
  tick(4000);
  assert.equal(arcade.frame(shrinks, snake({ long: 6, steps: 20 }), 'f1'), 'ok');
  assert.equal(arcade.frame(shrinks, snake({ long: 5, steps: 22 }), 'f1'), 'void');
  // A frame of some other game, sent for it.
  const other = arcade.start({ ...grace, owner: 'account:grace2' }, undefined, 'snake');
  assert.equal(arcade.frame(other, tiles([2, 2]), 'f1'), 'void');
  for (const id of [hungry, fat, instant, shrinks, other]) arcade.leave(id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(table.top(), []);
});

test('a snake goes no faster than STEPS_PER_SECOND, whatever its frames say', (t) => {
  const { arcade, tick } = arcadeFor(t);
  // As fast as the game itself ever steps (every 70 ms), for a minute: fine.
  const quick = arcade.start(ada, undefined, 'snake');
  for (let i = 1; i <= 850; i++) {
    tick(70);
    assert.equal(arcade.frame(quick, snake({ long: SNAKE_START + Math.floor(i / 20), steps: i }), 'f1'), 'ok', `step ${i}`);
  }
  // Twice that: through its burst within a few seconds, and out.
  const fast = arcade.start(grace, undefined, 'snake');
  let caught = 0;
  for (let i = 1; i <= 400 && !caught; i++) {
    tick(35);
    if (arcade.frame(fast, snake({ steps: i }), 'f1') === 'void') caught = i;
  }
  assert.ok(caught > STEP_BURST && caught < STEP_BURST + 3 * STEPS_PER_SECOND, `caught at step ${caught}`);
});

test('a real 2048 game goes on its table at the score it got', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  let seed = 7;
  const g = new Twenty48(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const id = arcade.start(ada, undefined, '2048');
  const keys = ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'];
  for (let i = 0; i < 20000 && !g.stuck; i++) {
    const before = g.frame().moves;
    g.key(keys[i % 4], true);
    if (g.frame().moves === before) continue;
    tick(200);
    assert.equal(arcade.frame(id, g.frame(), 'f1'), 'ok', `move ${g.frame().moves}, ${g.score} points`);
  }
  assert.equal(g.stuck, true);
  assert.ok(g.score > 100);
  tick(1);
  assert.deepEqual(
    table.top().map((s) => [s.title, s.name, s.score]),
    [['2048', 'Ada', g.score]],
  );
});

test('a 2048 score is no more than its tiles are worth, and its tiles no more than its moves brought in', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  // What tiles can have scored: an 8 is two 4s (8) made of four 2s (4 + 4).
  assert.equal(tilePoints([2, 0, 4, 8]), 0 + 4 + 16);
  assert.equal(tilePoints([2048]), 2048 * 10);
  const honest = arcade.start(ada, undefined, '2048');
  tick(10_000);
  assert.equal(arcade.frame(honest, tiles([8, 4, 2], { score: 20, moves: 6 }), 'f1'), 'ok');
  // A point more than those tiles are worth.
  const greedy = arcade.start(ada, undefined, '2048');
  assert.equal(arcade.frame(greedy, tiles([8, 4, 2], { score: 21, moves: 6 }), 'f1'), 'void');
  // A 2048 after ten moves: twelve tiles came in, 48 at the most between them.
  const rich = arcade.start(ada, undefined, '2048');
  assert.equal(arcade.frame(rich, tiles([2048], { score: 20000, moves: 10 }), 'f1'), 'void');
  // The moves it would take, all at once.
  const instant = arcade.start(grace, undefined, '2048');
  assert.equal(arcade.frame(instant, tiles([2048], { score: 20000, moves: 600 }), 'f1'), 'void');
  // Made-up frames at the fastest pace allowed: a 2048 of nothing but 4s takes over a minute of moves,
  // and scores what a 2048 made of 4s is worth.
  const paced = arcade.start({ ...grace, owner: 'account:grace2' }, undefined, '2048');
  const need = 2048 / 4 - 2;
  let moves = MOVE_BURST;
  let seconds = 0;
  assert.equal(arcade.frame(paced, tiles([4, 4], { moves }), 'f1'), 'ok');
  while (moves < need) {
    tick(1000);
    seconds++;
    moves = Math.min(need, moves + MOVES_PER_SECOND);
    const f = moves < need ? tiles([4, 4], { moves }) : tiles([2048], { score: 2048 * 9, moves, state: 'over' });
    assert.equal(arcade.frame(paced, f, 'f1'), 'ok', `${moves} moves`);
  }
  assert.ok(seconds > 60, `${seconds} seconds`);
  for (const id of [honest, greedy, rich, instant]) arcade.leave(id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top().map((s) => [s.title, s.name, s.score]),
    [
      ['2048', 'Grace', 2048 * 9],
      ['2048', 'Ada', 20],
    ],
  );
});

test('a Minesweeper win takes as long as the office’s own clock saw it take', (t) => {
  const { arcade, table, news, tick } = arcadeFor(t);
  const won = (seconds: number) => mines({ cells: `${'f'.repeat(22)}${'0'.repeat(MINE_CELLS - 22)}`, seconds, state: 'won' });
  // An honest game: first dig, 40 seconds of play, cleared. The browser says 40, and so does the office.
  const honest = arcade.start(ada, undefined, 'minesweeper');
  assert.equal(arcade.frame(honest, mines({ state: 'ready' }), 'f1'), 'ok');
  tick(5000);
  assert.equal(arcade.frame(honest, mines(), 'f1'), 'ok');
  tick(40_400);
  assert.equal(arcade.frame(honest, won(40), 'f1'), 'ok');
  tick(1);
  assert.deepEqual(scoresOf(table.top(), 'minesweeper'), [40]);
  assert.deepEqual(news, ['minesweeper:Ada']);

  // Says 5 after a minute at it: it took the minute (less the slack a slow connection gets).
  const slow = arcade.start(grace, undefined, 'minesweeper');
  assert.equal(arcade.frame(slow, mines(), 'f1'), 'ok');
  tick(60_000);
  assert.equal(arcade.frame(slow, won(5), 'f1'), 'ok');
  // Won the moment it began: nobody clears it faster than WIN_FLOOR.
  const instant = arcade.start({ ...grace, owner: 'account:grace2' }, undefined, 'minesweeper');
  assert.equal(arcade.frame(instant, won(0), 'f1'), 'ok');
  // Time away from it doesn't count: 10 seconds, an hour away, 10 more.
  const left = arcade.start({ ...grace, owner: 'account:grace3' }, undefined, 'minesweeper');
  assert.equal(arcade.frame(left, mines(), 'f1'), 'ok');
  tick(10_000);
  arcade.leave(left, 'f1');
  tick(60 * 60_000);
  assert.equal(arcade.start({ ...grace, owner: 'account:grace3' }, left, 'minesweeper'), left);
  assert.equal(arcade.frame(left, mines({ seconds: 10 }), 'f1'), 'ok');
  tick(10_000);
  assert.equal(arcade.frame(left, won(20), 'f1'), 'ok');
  // A lost game is nothing.
  const lost = arcade.start(ada, undefined, 'minesweeper');
  assert.equal(arcade.frame(lost, mines(), 'f1'), 'ok');
  tick(9000);
  assert.equal(arcade.frame(lost, mines({ state: 'lost', seconds: 9 }), 'f1'), 'ok');
  tick(RECORD_EVERY);
  assert.deepEqual(scoresOf(table.top(), 'minesweeper'), [WIN_FLOOR, 20, 40, Math.floor((60_000 - CLOCK_SLACK) / 1000)]);
});

test('a game is only carried on as the game it is, and each title counts its own new games', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  const hers = arcade.start(grace, undefined, 'snake');
  tick(2000);
  assert.equal(arcade.frame(hers, snake({ long: 5, steps: 20 }), 'f1'), 'ok');
  arcade.leave(hers, 'f1');
  // Asked for as a 2048 (or as Blockfall, saying nothing), it's a new game; as Snake, it's hers again.
  assert.notEqual(arcade.start(grace, hers, '2048'), hers);
  assert.notEqual(arcade.start(grace, hers), hers);
  assert.equal(arcade.start(grace, hers, 'snake'), hers);

  // New Snake games one after another stop counting; a 2048 started then still does.
  const counted = Array.from({ length: GAME_BURST + 1 }, () => arcade.counts(arcade.start(ada, undefined, 'snake')));
  assert.deepEqual(counted, [...new Array(GAME_BURST).fill(true), false]);
  assert.equal(arcade.counts(arcade.start(ada, undefined, '2048')), true);
  tick(GAME_EVERY);
  assert.equal(arcade.counts(arcade.start(ada, undefined, 'snake')), true);

  // Minesweepers are over in a click or two, so they're counted when they're won: the fourth win in a row is off the table.
  const linus: Player = { owner: 'name:Linus', name: 'Linus', color: '#ffd166' };
  for (let i = 0; i < 12; i++) {
    const quick = arcade.start(linus, undefined, 'minesweeper');
    assert.equal(arcade.counts(quick), true);
    arcade.frame(quick, mines({ state: 'lost' }), 'f1');
  }
  for (let i = 0; i < GAME_BURST + 1; i++) {
    const id = arcade.start(linus, undefined, 'minesweeper');
    arcade.frame(id, mines(), 'f1');
    tick(WIN_FLOOR * 1000);
    arcade.frame(id, mines({ state: 'won', seconds: WIN_FLOOR }), 'f1');
  }
  tick(RECORD_EVERY);
  assert.equal(tableOf(table.top(), 'minesweeper').length, GAME_BURST);
});

// ---- The handler: who's where, and what the office answers ------------------------------------------

/** An office with one floor and its arcade, and what each browser was sent. */
function officeFor(t: TestContext) {
  const dir = folder(t);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const highScores = new HighScores(dir);
  const floor = { id: 'f1' };
  const clients = new Map<string, Client>();
  const sent = new Map<string, ServerMsg[]>();
  const to = (c: Client, m: ServerMsg) => void sent.get(c.id)!.push(m);
  const ctx = {
    clients,
    highScores,
    arcade: new Arcade(highScores, () => {}),
    floorOf: (c: Client) => (c.peer.floor === floor.id ? floor : undefined),
    warn: (c: Client, error: string) => to(c, { t: 'toast', level: 'warn', text: error } as ServerMsg),
    sendTo: to,
    toFloor: (_f: unknown, m: ServerMsg) => clients.forEach((c) => to(c, m)),
    toNeighbors: (from: Client, m: ServerMsg) => clients.forEach((c) => c !== from && to(c, m)),
  } as unknown as Ctx;
  const join = (id: string, name: string): Client => {
    const c = { id, accountId: undefined, throttles: new Map<string, number>(), peer: { name, color: '#4f86f7', floor: floor.id } } as unknown as Client;
    clients.set(id, c);
    sent.set(id, []);
    return c;
  };
  /** What `c` was sent since the last look, by type. */
  const got = (c: Client) => sent.get(c.id)!.splice(0).map((m) => m.t);
  const last = <T extends ServerMsg['t']>(c: Client, type: T) => sent.get(c.id)!.findLast((m): m is Extract<ServerMsg, { t: T }> => m.t === type);
  return { ctx, floor, join, got, last, tick: (ms: number) => t.mock.timers.tick(ms) };
}

test('at the cabinet you take it and everyone sees your game; on the boss’s monitor you don’t, and nobody does', (t) => {
  const { ctx, floor, join, got, last, tick } = officeFor(t);
  const state = () => cabinetState(ctx, floor as never);
  const a = join('a', 'Ada');
  const b = join('b', 'Grace');

  // Ada plays Snake on the boss's monitor: the office names her game, and the cabinet stays free.
  cabinetHandlers['cabinet.play'](ctx, a, { t: 'cabinet.play', title: 'snake', away: true });
  const away = last(a, 'cabinet.game')!;
  assert.match(away.game, /^[0-9a-f]{16}$/);
  assert.equal(away.title, 'snake');
  assert.deepEqual(got(a), ['cabinet.game']);
  assert.deepEqual(got(b), []);
  assert.equal(state().player, null);
  tick(3000);
  cabinetHandlers['cabinet.frame'](ctx, a, { t: 'cabinet.frame', frame: snake({ long: 6, steps: 30 }) });
  assert.deepEqual(got(b), [], 'nobody watches the boss’s monitor');

  // Grace takes the cabinet for 2048 meanwhile, and her frames go to everyone else on the floor.
  cabinetHandlers['cabinet.play'](ctx, b, { t: 'cabinet.play', title: '2048' });
  assert.deepEqual(got(b), ['cabinet.game', 'cabinet']);
  assert.deepEqual(got(a), ['cabinet']);
  assert.deepEqual([state().player?.name, state().player?.title], ['Grace', '2048']);
  cabinetHandlers['cabinet.frame'](ctx, b, { t: 'cabinet.frame', frame: tiles([2, 2]) });
  assert.deepEqual(got(a), ['cabinet.frame']);
  // A Snake frame from her isn't a 2048 frame: it goes nowhere.
  cabinetHandlers['cabinet.frame'](ctx, b, { t: 'cabinet.frame', frame: snake() as never });
  assert.deepEqual(got(a), []);

  // Ada steps up to the cabinet: it's Grace's.
  cabinetHandlers['cabinet.play'](ctx, a, { t: 'cabinet.play', title: 'snake', game: away.game });
  assert.deepEqual(got(a), ['toast', 'cabinet']);
  assert.equal(state().player?.name, 'Grace');

  // Ada puts her game down: its score so far is on Snake's table, the same one the cabinet shows.
  cabinetHandlers['cabinet.leave'](ctx, a, { t: 'cabinet.leave' });
  tick(RECORD_EVERY);
  assert.deepEqual(
    state().scores.map((s) => [s.title, s.name, s.score]),
    [['snake', 'Ada', 6]],
  );
  // Grace leaves the office: the cabinet's free again.
  cabinetHooks.closed!(ctx, b);
  assert.equal(state().player, null);
});

test('only a game the office knows is started, and a frame it isn’t following is answered with a nudge to ask again', (t) => {
  const { ctx, floor, join, got, last } = officeFor(t);
  const a = join('a', 'Ada');
  cabinetHandlers['cabinet.play'](ctx, a, { t: 'cabinet.play', title: 'pong' as never });
  assert.deepEqual(got(a), []);
  assert.equal(cabinetState(ctx, floor as never).player, null);
  // A frame with no game on (the office restarted under the browser): '' says ask again, once a second at the most.
  cabinetHandlers['cabinet.frame'](ctx, a, { t: 'cabinet.frame', frame: snake() });
  cabinetHandlers['cabinet.frame'](ctx, a, { t: 'cabinet.frame', frame: snake() });
  assert.equal(last(a, 'cabinet.game')!.game, '');
  assert.deepEqual(got(a), ['cabinet.game']);
  // Saying nothing is Blockfall, as it was before there were other games.
  cabinetHandlers['cabinet.play'](ctx, a, { t: 'cabinet.play' });
  assert.equal(last(a, 'cabinet.game')!.title, 'blockfall');
  assert.equal(cabinetState(ctx, floor as never).player?.title, 'blockfall');
});
