import test from 'node:test';
import assert from 'node:assert/strict';
import { Blockfall } from '../src/client/features/arcade/blockfall.js';
import { H, W, best, setBest } from '../src/client/features/arcade/game.js';
import { makeGames } from '../src/client/features/arcade/games.js';
import { Minesweeper } from '../src/client/features/arcade/minesweeper.js';
import { Snake } from '../src/client/features/arcade/snake.js';
import { Twenty48, slide } from '../src/client/features/arcade/twenty48.js';

// The games on the boss's monitor (features/arcade): what the desk's menu lists, and each one's rules
// as the keys and the mouse reach them through the host (ui.ts).

/**
 * A 2D context that takes anything: every call hands itself back (so a gradient or a text measure is
 * one too), and anything's width is 10.
 */
function fakeContext(): CanvasRenderingContext2D {
  const g: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'width' ? 10 : g), set: () => true, apply: () => g });
  return g as CanvasRenderingContext2D;
}

/** An rng that reads out `values` in turn, and says how many it has given. */
function scripted(values: number[]) {
  let used = 0;
  const rng = () => {
    assert.ok(used < values.length, 'the game asked for more random numbers than the test scripted');
    return values[used++];
  };
  return { rng, used: () => used };
}

const left = { button: 0, flag: false };
const flag = { button: 2, flag: true };

test('the desk has four games, each with its own id, and all of them draw', () => {
  const games = makeGames();
  assert.deepEqual(
    games.map((g) => g.id),
    ['minesweeper', 'blockfall', '2048', 'snake'],
  );
  assert.equal(new Set(games.map((g) => g.id)).size, games.length);
  assert.deepEqual([W, H], [960, 540]);
  for (const game of games) {
    assert.ok(game.icon && game.name && game.tip, `${game.id} has an icon, a name and a tip`);
    assert.doesNotThrow(() => {
      game.start();
      game.paint(fakeContext());
      game.update?.(0.05);
      game.leave?.();
      game.paint(fakeContext());
    }, `${game.id} starts, draws and is left`);
  }
});

test('no game takes Esc, V or M: they are the window’s and the call’s', () => {
  for (const game of makeGames()) {
    game.start();
    for (const code of ['Escape', 'KeyV', 'KeyM']) {
      assert.ok(!game.key?.(code, true), `${game.id} leaves ${code} alone`);
      assert.ok(!game.key?.(code, false), `${game.id} leaves ${code} coming back up alone`);
    }
  }
});

test('until the table has arrived your best is what this browser kept: nothing where there is nowhere to keep it, and keeping it there does no harm', () => {
  assert.equal(best('snake'), 0);
  assert.doesNotThrow(() => setBest('snake', 12));
  assert.equal(best('minesweeper'), 0);
});

test('2048: a row slides to its start, and two of the same become one, each tile once a move', () => {
  assert.deepEqual(slide([0, 2, 0, 2]), { row: [4, 0, 0, 0], gained: 4, merged: [0] });
  assert.deepEqual(slide([2, 2, 2, 2]), { row: [4, 4, 0, 0], gained: 8, merged: [0, 1] });
  assert.deepEqual(slide([4, 2, 2, 0]), { row: [4, 4, 0, 0], gained: 4, merged: [1] });
  // The pair nearest the edge they slide toward goes first, and the third stays as it is.
  assert.deepEqual(slide([2, 2, 2, 0]), { row: [4, 2, 0, 0], gained: 4, merged: [0] });
  assert.deepEqual(slide([2, 4, 8, 16]), { row: [2, 4, 8, 16], gained: 0, merged: [] });
  assert.deepEqual(slide([0, 0, 0, 0]), { row: [0, 0, 0, 0], gained: 0, merged: [] });
});

test('2048: a move that moves something brings in one tile, and one that moves nothing brings in none', () => {
  // Where each tile goes among the empty cells, then whether it is a 2 (under 0.9) or a 4.
  const script = scripted([0, 0, 0.999, 0.95, 0.5, 0]);
  const game = new Twenty48(script.rng);
  const tiles = () => game.cells.filter(Boolean).length;
  // A 2 in the top left corner and a 4 in the bottom right.
  assert.equal(game.cells[0], 2);
  assert.equal(game.cells[15], 4);
  assert.equal(tiles(), 2);
  assert.equal(script.used(), 4);

  // Left: the 4 goes along its row, and a 2 comes in halfway down the empty cells, on the left edge.
  assert.ok(game.key('ArrowLeft', true));
  assert.equal(game.cells[15], 0);
  assert.equal(game.cells[12], 4);
  assert.equal(game.cells[8], 2);
  assert.equal(tiles(), 3);
  assert.equal(script.used(), 6);

  // Left again: everything is against that edge already. The key is still the game's, but nothing comes in.
  const before = [...game.cells];
  assert.ok(game.key('KeyA', true));
  assert.deepEqual([...game.cells], before);
  assert.equal(script.used(), 6);
  assert.equal(game.move(-1, 0), false);
});

test('2048: the score is what the merges were worth', () => {
  // Two 2s, in the first and the last of the empty cells (the top left and bottom right corners), then every tile that comes in a 2 in the first empty cell.
  const script = scripted([0, 0, 0.999, 0, 0, 0, 0, 0]);
  const game = new Twenty48(script.rng);
  // Up: the bottom one goes to the top of its column, and a 2 comes in beside the first.
  game.key('ArrowUp', true);
  assert.deepEqual(game.cells.slice(0, 4), [2, 2, 0, 2]);
  assert.equal(game.score, 0);
  // Left: the first two meet, the third closes up, and a 2 comes in after it.
  game.key('ArrowLeft', true);
  assert.deepEqual(game.cells.slice(0, 4), [4, 2, 2, 0]);
  assert.equal(game.score, 4);
  assert.equal(script.used(), 8);
});

test('2048: with no move left it is stuck, and only then does Enter start again', () => {
  // The same game every run.
  let seed = 7;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const game = new Twenty48(rng);
  // Enter is the game's key, but with moves left it leaves the board alone.
  const before = [...game.cells];
  assert.ok(game.key('Enter', true));
  assert.deepEqual([...game.cells], before);

  const keys = ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'];
  for (let i = 0; i < 20000 && !game.stuck; i++) game.key(keys[i % 4], true);
  assert.equal(game.stuck, true);
  assert.ok(!game.cells.includes(0), 'a stuck board is a full one');
  const end = [...game.cells];
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) assert.equal(game.move(dx, dy), false);
  assert.deepEqual([...game.cells], end);
  assert.ok(game.score > 0);

  game.key('Enter', true);
  assert.equal(game.stuck, false);
  assert.equal(game.score, 0);
  assert.equal(game.cells.filter(Boolean).length, 2);
});

test('Snake: it steps as time passes, a reverse is no turn, an apple makes it longer, a wall ends it, Enter starts again', () => {
  const game = new Snake(() => 0.5);
  assert.equal(game.state, 'ready');
  assert.equal(game.length, 3);
  const from = { ...game.head };
  // Nothing moves until a key sets it off.
  assert.equal(game.update(1), false);
  assert.deepEqual(game.head, from);

  // It sets off to the right. Left is straight back into itself: the key is taken, the turn isn't.
  assert.ok(game.key('ArrowLeft', true));
  assert.equal(game.state, 'play');
  assert.equal(game.update(1), true);
  assert.deepEqual(game.head, { x: from.x + 1, y: from.y });
  // Not enough time for a step.
  assert.equal(game.update(0.001), false);

  /** Turns it with `code` and steps it `n` times. */
  const go = (code: string, n: number) => {
    game.key(code, true);
    game.key(code, false);
    for (let i = 0; i < n && game.state === 'play'; i++) game.update(1);
  };
  // To the apple: up or down to its row first (one row off and back when it is in this one), then along it.
  const apple = { ...game.food };
  if (apple.y === game.head.y) go('ArrowUp', 1);
  const dy = apple.y - game.head.y;
  go(dy < 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(dy));
  if (game.head.y !== apple.y) go(apple.y < game.head.y ? 'ArrowUp' : 'ArrowDown', Math.abs(apple.y - game.head.y));
  const dx = apple.x - game.head.x;
  assert.notEqual(dx, 0, 'the apple is off to one side');
  go(dx < 0 ? 'ArrowLeft' : 'ArrowRight', Math.abs(dx));
  assert.deepEqual(game.head, apple);
  assert.equal(game.length, 4);
  assert.notDeepEqual(game.food, apple, 'a new apple somewhere else');
  assert.equal(game.state, 'play');

  // Straight on into the wall.
  for (let i = 0; i < 40 && game.state === 'play'; i++) game.update(1);
  assert.equal(game.state, 'over');
  // Over, the arrows do nothing; Enter is a new game, waiting for a key.
  assert.ok(game.key('ArrowUp', true));
  assert.equal(game.state, 'over');
  assert.ok(game.key('Enter', true));
  assert.equal(game.state, 'ready');
  assert.equal(game.length, 3);
});

test('Snake: left mid-game it waits where it is, until a key carries on', () => {
  const game = new Snake(() => 0);
  // The apple is in the top left corner, out of the way.
  assert.deepEqual(game.food, { x: 0, y: 0 });
  game.key('ArrowRight', true);
  game.update(1);
  const at = { ...game.head };
  game.leave();
  assert.equal(game.state, 'paused');
  assert.equal(game.update(1), false);
  // Coming back to it leaves it waiting, and a key carries on.
  game.start();
  assert.equal(game.state, 'paused');
  assert.deepEqual(game.head, at);
  game.key('ArrowUp', true);
  assert.equal(game.state, 'play');
  assert.equal(game.update(1), true);
  assert.deepEqual(game.head, { x: at.x, y: at.y - 1 });
});

test('Snake: its tail gets out of the way of its head, and the rest of it does not', () => {
  // Every apple in the first free cell, counting along the rows from the top left.
  const game = new Snake(() => 0);
  const go = (code: string, n: number) => {
    game.key(code, true);
    for (let i = 0; i < n; i++) game.update(1);
  };
  // Up to the top row and along it to the apple in the corner. Three long, a tight square is no crash.
  go('ArrowUp', game.head.y);
  go('ArrowLeft', game.head.x);
  assert.deepEqual(game.head, { x: 0, y: 0 });
  assert.equal(game.length, 4);
  // The next apple is just past its tail. Round underneath itself and up to it.
  assert.deepEqual(game.food, { x: 4, y: 0 });
  go('ArrowDown', 1);
  go('ArrowRight', 4);
  go('ArrowUp', 1);
  assert.deepEqual(game.head, { x: 4, y: 0 });
  assert.equal(game.length, 5);
  assert.equal(game.state, 'play');
  // Five long, left and down again is into its own side.
  go('ArrowLeft', 1);
  assert.equal(game.state, 'play');
  go('ArrowDown', 1);
  assert.equal(game.state, 'over');
});

test('Minesweeper: a click digs when it comes back up, a right-click flags, and a flag is not dug', () => {
  const game = new Minesweeper();
  game.start();
  // The middle of the cell four across and four down.
  const [x, y] = [64 + 3.5 * 52, 62 + 3.5 * 52];
  const cell = game.cellAt(x, y);
  assert.ok(cell >= 0);
  assert.equal(game.pointer('down', x, y, left), true);
  assert.equal(game.isOpen(cell), false, 'held down, nothing is dug yet');
  assert.equal(game.pointer('up', x, y, left), true);
  assert.equal(game.isOpen(cell), true);
  assert.equal(game.state, 'playing');

  // Some cell that is still shut.
  let shut = -1;
  let at: [number, number] = [0, 0];
  for (let r = 0; r < 9 && shut < 0; r++) {
    for (let c = 0; c < 16 && shut < 0; c++) {
      at = [64 + (c + 0.5) * 52, 62 + (r + 0.5) * 52];
      if (!game.isOpen(game.cellAt(...at))) shut = game.cellAt(...at);
    }
  }
  assert.ok(shut >= 0);
  assert.equal(game.pointer('down', ...at, flag), true);
  // A click on the flag: not dug, and nothing went off.
  game.pointer('down', ...at, left);
  game.pointer('up', ...at, left);
  assert.equal(game.isOpen(shut), false);
  assert.equal(game.state, 'playing');
  // The flag off again, and the same click digs it (or it was a mine).
  game.pointer('down', ...at, flag);
  game.pointer('down', ...at, left);
  game.pointer('up', ...at, left);
  assert.ok(game.isOpen(shut) || game.state === 'lost');
});

test('Minesweeper: it digs where the button comes up, not where it went down, and a finished game is new when you sit down again', () => {
  const game = new Minesweeper();
  const a: [number, number] = [64 + 0.5 * 52, 62 + 0.5 * 52];
  const b: [number, number] = [64 + 8.5 * 52, 62 + 4.5 * 52];
  game.pointer('down', ...a, left);
  // Off the board with the button down changes nothing, and moving on to another cell moves the dig there.
  assert.equal(game.pointer('leave', -5, -5, { button: -1, flag: false }), false);
  assert.equal(game.pointer('move', ...b, { button: -1, flag: false }), true);
  assert.equal(game.pointer('move', ...b, { button: -1, flag: false }), false, 'the same cell again is no change');
  game.pointer('up', ...b, left);
  assert.equal(game.isOpen(game.cellAt(...b)), true);
  assert.equal(game.state, 'playing');

  // The clock counts seconds of play.
  assert.equal(game.update(0.4), false);
  assert.equal(game.update(0.7), true);

  // Lose it, by digging every cell that's left.
  for (let i = 0; i < 16 * 9 && game.state === 'playing'; i++) game.open(i);
  assert.ok(game.state === 'lost' || game.state === 'won');
  game.leave();
  game.start();
  assert.equal(game.state, 'ready');
});

test('Blockfall: the arrows are its keys, a game ends when the well is full, and Enter starts another', () => {
  const game = new Blockfall();
  game.start();
  assert.equal(game.key('ArrowLeft', true), true);
  assert.equal(game.key('ArrowLeft', false), true);
  assert.equal(game.key('KeyQ', true), false, 'a key it has no use for is not its key');
  // Drop piece after piece down the middle until there is no room for the next.
  for (let i = 0; i < 400 && !game.over; i++) game.key('Space', true);
  assert.equal(game.over, true);
  assert.ok(game.score > 0);
  // Over, the arrows do nothing but are still its keys.
  assert.equal(game.key('ArrowLeft', true), true);
  assert.equal(game.over, true);
  assert.equal(game.key('Enter', true), true);
  assert.equal(game.over, false);
  assert.equal(game.score, 0);
});

test('Blockfall: stepping away pauses it, a game under way is kept, and one never begun is not', () => {
  const game = new Blockfall();
  game.start();
  game.leave();
  assert.equal(game.paused, true);
  // Nothing was played: sitting down again is a fresh game, running.
  game.start();
  assert.equal(game.paused, false);

  game.key('Space', true);
  const score = game.score;
  assert.ok(score > 0);
  game.leave();
  game.start();
  assert.equal(game.paused, true, 'a game under way waits, paused');
  assert.equal(game.score, score);
  // Paused, a move does nothing; P or Enter carries on.
  game.key('Space', true);
  assert.equal(game.score, score);
  game.key('KeyP', true);
  assert.equal(game.paused, false);
  // It moves on by itself as time passes: the picture changes.
  game.paint(fakeContext());
  let changed = false;
  for (let i = 0; i < 30; i++) changed = game.update(0.1) || changed;
  assert.equal(changed, true);
});
