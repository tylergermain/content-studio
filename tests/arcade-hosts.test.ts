import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFrame, type CabinetFrame, type GameFrame, type HighScore, type MinesFrame, type SnakeFrame } from '../src/shared/cabinet.js';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol.js';
import { Blockfall } from '../src/client/features/arcade/blockfall.js';
import { H, W, best, holder, placed, rank, setScores, table, type ScreenGame } from '../src/client/features/arcade/game.js';
import { makeGames } from '../src/client/features/arcade/games.js';
import { Link, lostGame } from '../src/client/features/arcade/link.js';
import { Minesweeper } from '../src/client/features/arcade/minesweeper.js';
import { Snake } from '../src/client/features/arcade/snake.js';
import { Twenty48 } from '../src/client/features/arcade/twenty48.js';
import { H as TUBE_H, W as TUBE_W, paintGame, paintPicker, rowAt, toGame } from '../src/client/features/cabinet/tube.js';
import { noise } from '../src/client/features/cabinet/ui.js';
import { cabinet as slice } from '../src/client/state/slices/cabinet.js';
import type { Store } from '../src/client/state/store.js';

// The arcade's games as its two hosts use them (the boss's monitor and the cabinet in the lounge):
// what each game says of its screen, the office's side of a game (link.ts), the one table both show,
// and the cabinet's tube.

/** A 2D context that takes anything: every call hands itself back, and anything's width is 10. */
function fakeContext(): CanvasRenderingContext2D {
  const g: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'width' ? 10 : g), set: () => true, apply: () => g });
  return g as CanvasRenderingContext2D;
}

const score = (game: string, title: HighScore['title'], name: string, n: number): HighScore => ({ game, title, name, color: '#ef476f', score: n, lines: 0, level: 1, at: 1 });
const left = { button: 0, flag: false };

test('every game’s screen is a frame the office takes for that game, and a copy shows it as it was sent', () => {
  const games = makeGames();
  const copies = makeGames();
  /** Sent, checked by the office, and put on the copy: the copy's own frame is the same again. */
  const across = (game: ScreenGame, why: string) => {
    const sent = JSON.parse(JSON.stringify(game.frame())) as unknown;
    const checked = checkFrame(sent, game.id);
    assert.deepEqual(checked, game.frame(), `${game.id} ${why}: the office takes it`);
    const copy = copies.find((c) => c.id === game.id)!;
    copy.show(checked!);
    if (game.id !== 'blockfall') assert.deepEqual(copy.frame(), game.frame(), `${game.id} ${why}: the copy shows the same`);
    assert.doesNotThrow(() => {
      copy.paint(fakeContext());
      paintGame(fakeContext(), copy, 'Ada');
    });
    for (const other of games) if (other.id !== game.id) assert.equal(checkFrame(sent, other.id), null, `${game.id}'s frame is not ${other.id}'s`);
  };
  for (const game of games) {
    game.start();
    across(game, 'as it starts');
  }
  const [mines, blocks, tiles, snake] = games as [Minesweeper, Blockfall, Twenty48, Snake];
  for (const code of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) tiles.key(code, true);
  across(tiles, 'after some moves');
  snake.key('ArrowUp', true);
  for (let i = 0; i < 5; i++) snake.update(1);
  across(snake, 'on its way');
  for (let i = 0; i < 40 && snake.state !== 'over'; i++) snake.update(1);
  across(snake, 'into the wall');
  blocks.key('Space', true);
  across(blocks, 'a piece down');
  mines.open(40);
  across(mines, 'dug');
  mines.flag((mines.frame().cells.indexOf('h') + 144) % 144);
  across(mines, 'flagged');
  for (let i = 0; i < 144 && mines.state === 'playing'; i++) mines.open(i);
  across(mines, 'finished');
});

test('Minesweeper’s frame says nothing of where the mines are until it’s lost', () => {
  // Enough games that one is lost with a wrong flag standing.
  for (let n = 0; n < 20; n++) {
    const game = new Minesweeper();
    game.open(72);
    const during = game.frame();
    assert.equal(during.state, 'playing');
    assert.match(during.cells, /^[h0-8]+$/, 'only what is dug shows');
    const shut = [...during.cells].flatMap((ch, i) => (ch === 'h' ? [i] : []));
    game.flag(shut[0]);
    assert.equal(game.frame().cells[shut[0]], 'f');
    for (const i of shut.slice(1)) if (game.state === 'playing') game.open(i);
    const end = game.frame();
    if (end.state === 'won') {
      // Every mine is flagged for you, and the clock is the score.
      assert.equal([...end.cells].filter((ch) => ch === 'f').length, 22);
      continue;
    }
    assert.equal(end.state, 'lost');
    assert.equal([...end.cells].filter((ch) => ch === 'b').length, 1, 'the one that went off');
    // 22 mines: the one that went off, the others shown, and the first cell's flag was right or wrong.
    const count = (ch: string) => [...end.cells].filter((c) => c === ch).length;
    assert.equal(count('b') + count('m') + count('f'), 22);
    assert.ok(count('x') + count('f') === 1);
  }
});

test('each game says what it stands at while one of yours is waiting, and nothing when none is', () => {
  const [mines, blocks, tiles, snake] = makeGames() as [Minesweeper, Blockfall, Twenty48, Snake];
  for (const game of [mines, blocks, tiles, snake]) {
    game.start();
    game.leave?.();
    assert.equal(game.left, null, `${game.id} never begun`);
  }
  snake.key('ArrowUp', true);
  snake.update(1);
  snake.leave();
  assert.equal(snake.left, 3);
  blocks.start();
  blocks.key('Space', true);
  blocks.leave();
  assert.equal(blocks.left, blocks.score);
  assert.ok(blocks.score > 0);
  tiles.key('ArrowLeft', true);
  tiles.key('ArrowUp', true);
  assert.equal(tiles.left, tiles.score);
  mines.open(40);
  mines.update(2.5);
  assert.equal(mines.left, 2);
  // A new game is nobody's until the office names it.
  for (const game of [mines, blocks, tiles, snake]) {
    game.office = 'feedfacefeedface';
    game.reset();
    assert.equal(game.office, '', game.id);
    assert.equal(game.left, null, game.id);
  }
});

/** A game with nothing to it but what the link looks at. */
class Fake implements ScreenGame {
  readonly id = 'snake';
  readonly icon = '🧪';
  readonly name = 'Fake';
  readonly tip = '';
  readonly left = null;
  office = '';
  steps = 0;
  state: SnakeFrame['state'] = 'play';
  resets = 0;
  start() {}
  reset() {
    this.office = '';
    this.steps = 0;
    this.state = 'play';
    this.resets++;
  }
  paint() {}
  frame(): SnakeFrame {
    return { body: [2, 1, 0], apple: 9, dir: 0, steps: this.steps, state: this.state };
  }
  show() {}
}

test('the link asks the office for a game, sends it as it changes, and hands it back', () => {
  const sent: ClientMsg[] = [];
  let lost = 0;
  const link = new Link(
    (m) => sent.push(m),
    () => lost++,
  );
  const out = () => sent.splice(0);
  const g = new Fake();
  const A = 'a'.repeat(16);
  const B = 'b'.repeat(16);
  const C = 'c'.repeat(16);

  // Opened on the boss's monitor: a new game, away from the cabinet.
  link.follow(g, true);
  assert.deepEqual(out(), [{ t: 'cabinet.play', title: 'snake', game: undefined, away: true }]);
  assert.equal(link.asking, true);
  link.named(A, 'snake');
  assert.equal(g.office, A);
  assert.equal(link.asking, false);
  assert.equal(lost, 0);

  // The game goes out as it is, once, and again when it has changed, but not more often than it should.
  link.tick(1000);
  assert.deepEqual(out(), [{ t: 'cabinet.frame', frame: g.frame() }]);
  link.tick(1010);
  g.steps = 1;
  link.tick(1020);
  assert.deepEqual(out(), []);
  link.tick(1100);
  assert.deepEqual(out(), [{ t: 'cabinet.frame', frame: g.frame() }]);
  // Its ending doesn't wait its turn: that's the frame that puts the score up.
  g.steps = 2;
  g.state = 'over';
  link.tick(1110);
  assert.deepEqual(out(), [{ t: 'cabinet.frame', frame: g.frame() }]);

  // A new game on the screen is a new game for the office, asked for before any of it is sent.
  g.reset();
  link.tick(1120);
  assert.deepEqual(out(), [
    { t: 'cabinet.play', title: 'snake', game: undefined, away: true },
    { t: 'cabinet.frame', frame: g.frame() },
  ]);
  // Not asked for twice while the answer is on its way.
  link.tick(1130);
  assert.deepEqual(out(), []);
  link.named(B, 'snake');
  assert.equal(g.office, B);
  assert.equal(g.resets, 1);

  // Its window closes: the office sees it as it stands, and it's put down.
  g.steps = 7;
  link.drop();
  assert.deepEqual(out(), [{ t: 'cabinet.frame', frame: g.frame() }, { t: 'cabinet.leave' }]);
  assert.equal(link.following, null);
  link.tick(2000);
  assert.deepEqual(out(), []);

  // The same game at the cabinet: carried on by name, and asking for the cabinet with it.
  link.follow(g, false);
  assert.deepEqual(out(), [{ t: 'cabinet.play', title: 'snake', game: B, away: undefined }]);
  // The office names another: it lost that game (a restart), so the one on the screen is a new one too.
  assert.equal(lostGame(B, C), true);
  link.named(C, 'snake');
  assert.deepEqual([g.office, g.resets, lost], [C, 2, 1]);
  // '' is the office saying it's following none of yours: ask again, for the game you're on.
  link.named('', 'snake');
  assert.deepEqual(out(), [{ t: 'cabinet.play', title: 'snake', game: C, away: undefined }]);
  // An answer about some other game isn't this one's name.
  link.named(A, '2048');
  assert.equal(g.office, C);
  link.named(C, 'snake');

  // Another game opened somewhere else (the boss's monitor): the cabinet's is handed back first.
  const other = new Fake();
  link.tick(3000);
  out();
  link.follow(other, true);
  assert.deepEqual(
    out().map((m) => m.t),
    ['cabinet.leave', 'cabinet.play'],
  );
  assert.equal(link.following, other);
  // On to another in the same place: the last one goes out as it stands, and asking for the next is
  // what puts it down, so nobody watching sees the player gone in between.
  const next = new Fake();
  link.follow(next, true);
  assert.deepEqual(
    out().map((m) => m.t),
    ['cabinet.frame', 'cabinet.play'],
  );
  assert.equal(link.following, next);
});

test('the score to beat is the top of the building’s table, the same wherever the game is played', (t) => {
  t.after(() => setScores(null));
  // Before the table has arrived: what this browser kept, which is nothing here.
  setScores(null);
  assert.deepEqual(table('snake'), []);
  assert.equal(best('snake'), 0);
  assert.equal(holder('snake'), '');

  const scores = [score('g1', undefined, 'Ada', 12400), score('g2', 'snake', 'Grace', 24), score('g3', 'snake', 'Linus', 9), score('g4', 'minesweeper', 'Ken', 42)];
  setScores(scores);
  assert.deepEqual(
    table('snake').map((s) => s.name),
    ['Grace', 'Linus'],
  );
  assert.equal(table('blockfall')[0].name, 'Ada', 'a score that says no game is Blockfall’s');
  assert.deepEqual([best('blockfall'), best('snake'), best('minesweeper'), best('2048')], [12400, 24, 42, 0]);
  assert.equal(holder('snake'), ' · GRACE');
  assert.equal(holder('2048'), '');
  assert.deepEqual([rank('snake', 'g3'), rank('snake', 'g2'), rank('snake', 'nope'), rank('snake', '')], [2, 1, 0, 0]);
  assert.deepEqual([placed('snake', 'g3'), placed('snake', 'nope')], ['🏆 #2 on the table · ', '']);

  // Both hosts' games read the same table: Blockfall's own picture shows it wherever it's drawn.
  const [, blocks] = makeGames();
  assert.doesNotThrow(() => {
    blocks.paint(fakeContext());
    blocks.paintTube!(fakeContext(), 'Ada');
  });
});

test('the cabinet’s tube: a game made for the monitor sits across its middle, and the picker’s rows are where they’re drawn', () => {
  assert.deepEqual([TUBE_W, TUBE_H], [800, 600]);
  // 960×540 across an 800-wide tube is 450 high: 75 above it and 75 below.
  assert.deepEqual(toGame(0, 75), [0, 0]);
  assert.deepEqual(
    toGame(800, 525).map((n) => Math.round(n)),
    [W, H],
  );
  assert.deepEqual(
    toGame(400, 300).map((n) => Math.round(n)),
    [W / 2, H / 2],
  );
  // Above the game is off its top.
  assert.ok(toGame(400, 10)[1] < 0);

  const games = makeGames();
  assert.deepEqual(
    [140, 240, 340, 440].map((y) => rowAt(400, y, games.length)),
    [0, 1, 2, 3],
  );
  assert.equal(rowAt(400, 60, games.length), -1, 'the title');
  assert.equal(rowAt(400, 560, games.length), -1, 'the prompt');
  assert.equal(rowAt(10, 240, games.length), -1, 'beside the rows');
  assert.doesNotThrow(() => {
    paintPicker(fakeContext(), games, -1, 'PRESS E TO PLAY');
    paintPicker(fakeContext(), games, 2, '');
    for (const game of games) paintGame(fakeContext(), game, 'Ada');
  });
  // A click on the tube lands on Minesweeper's cell under it.
  const mines = games[0] as Minesweeper;
  const cell = mines.cellAt(...toGame(400, 300));
  assert.equal(cell, mines.cellAt(W / 2, H / 2));
  mines.pointer('down', ...toGame(400, 300), left);
  mines.pointer('up', ...toGame(400, 300), left);
  assert.equal(mines.isOpen(cell), true);
});

test('what a game being watched just did makes the cabinet’s noises', () => {
  const blocks = (f: Partial<CabinetFrame>): CabinetFrame => ({ cells: '', next: 1, hold: 0, score: 0, lines: 0, level: 1, pieces: 0, state: 'play', ...f });
  assert.deepEqual(noise('blockfall', blocks({ pieces: 3 }), blocks({ pieces: 4 })), { kind: 'land' });
  assert.deepEqual(noise('blockfall', blocks({ pieces: 3, lines: 2 }), blocks({ pieces: 4, lines: 6 })), { kind: 'clear', lines: 4 });
  assert.equal(noise('blockfall', blocks({ pieces: 3 }), blocks({ pieces: 3, score: 5 })), null);
  assert.deepEqual(noise('blockfall', blocks({ pieces: 3 }), blocks({ pieces: 4, state: 'over' })), { kind: 'over' });
  assert.equal(noise('blockfall', blocks({ state: 'over' }), blocks({ state: 'over' })), null, 'over only ends once');
  const snake = (long: number, state: SnakeFrame['state'] = 'play'): SnakeFrame => ({ body: Array.from({ length: long }, (_, i) => i), apple: 99, dir: 0, steps: 1, state });
  assert.deepEqual(noise('snake', snake(4), snake(5)), { kind: 'land' });
  assert.equal(noise('snake', snake(5), snake(5)), null);
  assert.deepEqual(noise('snake', snake(5), snake(5, 'over')), { kind: 'over' });
  const mines = (seconds: number, state: MinesFrame['state'] = 'playing'): MinesFrame => ({ cells: '', seconds, state });
  assert.equal(noise('minesweeper', mines(4), mines(5)), null, 'its clock just ticks');
  assert.deepEqual(noise('minesweeper', mines(40), mines(41, 'won')), { kind: 'clear', lines: 4 });
  assert.deepEqual(noise('minesweeper', mines(40), mines(41, 'lost')), { kind: 'over' });
});

test('the cabinet’s screen is cleared when whoever’s on it starts another game, not when the scores change', () => {
  const s = {} as Store;
  slice.init!(s);
  assert.deepEqual(s.cabinet, { player: null, scores: [] });
  const state = (game: string, title: string, scores: HighScore[] = []) => ({ t: 'cabinet', state: { player: { id: 'p-a', name: 'Ada', game, title }, scores } }) as ServerMsg & { t: 'cabinet' };
  const frame: GameFrame = { body: [2, 1, 0], apple: 9, dir: 0, steps: 4, state: 'play' };
  slice.on!.cabinet!(s, state('g1', 'snake'));
  slice.on!['cabinet.frame']!(s, { t: 'cabinet.frame', frame });
  // The table changed under her game: the screen stays.
  slice.on!.cabinet!(s, state('g1', 'snake', [score('g9', 'snake', 'Grace', 12)]));
  assert.deepEqual(s.cabinetFrame, frame);
  // She's on to 2048: a Snake frame is no picture of it.
  slice.on!.cabinet!(s, state('g2', '2048'));
  assert.equal(s.cabinetFrame, null);
});
