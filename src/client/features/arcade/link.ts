import type { GameTitle } from '../../../shared/cabinet';
import type { ClientMsg } from '../../../shared/protocol';
import type { ScreenGame } from './game';

/** Your game goes out to the office (and from the cabinet, to everyone watching) at most this often (ms), unless it just ended. */
const FRAME_MS = 90;

/**
 * The office's side of the game you have open, wherever you have it open: the cabinet in the lounge
 * or the boss's monitor (`away`). The office names every game, follows it frame by frame and puts its
 * score on the building's high-score table itself (server/cabinet.ts), so both hosts hand the game
 * they open to this, and take it back when its window closes. One game at a time.
 */
export class Link {
  private game: ScreenGame | null = null;
  private away = false;
  /** The game asked for, until the office says which one you're on ('' for a new one); null with nothing asked. */
  private asked: string | null = null;
  private sent = { frame: '', state: '', at: 0 };

  constructor(
    private readonly send: (msg: ClientMsg) => void,
    /** The office started a new game where you asked to carry one on: the game on the screen is a new one too. */
    private readonly lost: () => void = () => {},
  ) {}

  /** The game it has. */
  get following(): ScreenGame | null {
    return this.game;
  }

  /** Still waiting to hear which game the office has you on. */
  get asking(): boolean {
    return this.asked !== null;
  }

  /** Takes `game`, which just opened: at the cabinet (and asking for it), or `away` on the boss's monitor. */
  follow(game: ScreenGame, away: boolean) {
    // On to another game in the same place: asking for it is what puts the last one down, so whoever's
    // watching the cabinet never sees you gone in between.
    if (this.game && this.game !== game && this.away === away) this.push(Infinity);
    else if (this.game && this.game !== game) this.drop();
    this.game = game;
    this.away = away;
    this.ask();
  }

  /** Asks the office to carry on with the game's game, or for a new one when it has none: it says which in `named`. */
  ask() {
    const g = this.game;
    if (!g) return;
    this.asked = g.office;
    // Whichever it is, the office hasn't seen it as it stands.
    this.sent.frame = '';
    this.send({ t: 'cabinet.play', title: g.id, game: g.office || undefined, away: this.away || undefined });
  }

  /** The office's answer: the game of `title` you're on, or '' when it's following none of yours (a connection it dropped). */
  named(id: string, title: GameTitle) {
    const g = this.game;
    if (!g) return;
    if (!id) return this.ask();
    if (g.id !== title) return;
    // It can't follow the old game on from where it was, so a new one for the new game it started.
    if (this.asked !== null && lostGame(this.asked, id)) {
      g.reset();
      this.lost();
    }
    this.asked = null;
    g.office = id;
  }

  /** Every frame: a new game on the screen is one for the office to name, and the game goes out as it changes. */
  tick(now = performance.now()) {
    const g = this.game;
    if (!g) return;
    if (!g.office && this.asked === null) this.ask();
    this.push(now);
  }

  /** Gives the game back (its window closed): the office sees it as it stands, and it waits there for you. */
  drop() {
    if (!this.game) return;
    this.push(Infinity);
    this.send({ t: 'cabinet.leave' });
    this.game = null;
    this.asked = null;
  }

  /** The game as it is now, unless the office has seen it already. A change of state (it ended) doesn't wait its turn. */
  push(now: number) {
    const g = this.game;
    if (!g) return;
    const frame = g.frame();
    const text = JSON.stringify(frame);
    if (text === this.sent.frame || (now - this.sent.at < FRAME_MS && frame.state === this.sent.state)) return;
    this.sent = { frame: text, state: frame.state, at: Number.isFinite(now) ? now : 0 };
    this.send({ t: 'cabinet.frame', frame });
  }
}

/**
 * Whether the office let go of the game you asked it to carry on with (`asked`, '' for a new one):
 * it restarted, or gave up waiting for you, and started game `id` for you instead.
 */
export function lostGame(asked: string, id: string): boolean {
  return asked !== '' && id !== asked;
}
