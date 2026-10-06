// The toys on every floor: pictures, the jukebox, the arcade, the whiteboard, the ball, the cars and the dog.

import type { CabinetState, GameFrame, GameTitle } from '../cabinet.js';
import type { DecorPlacement, Decoration } from '../decor.js';
import type { DogState } from '../dog.js';
import type { CarSeat, CarState } from '../garage.js';
import type { BallState } from '../hoop.js';
import type { JukeboxState } from '../jukebox.js';
import type { RaceView } from '../race.js';
import type { WbElement, WbPointer } from '../whiteboard.js';

export type DecorClientMsg =
  /** Hang a picture on a wall. */
  | { t: 'decor.add'; decor: DecorPlacement }
  /** Move, resize, re-frame or swap the image of a picture. */
  | { t: 'decor.update'; id: string; decor: Partial<DecorPlacement> }
  | { t: 'decor.remove'; id: string };

export type JukeboxClientMsg =
  /**
   * Put a tune on the jukebox (a JUKEBOX_TUNES id), or a pasted link: a stream, an audio file or a YouTube
   * video, with `name` to call it something of your own; with neither, turn it back on.
   */
  | { t: 'jukebox.play'; track?: string; url?: string; name?: string }
  /** On to the next tune. */
  | { t: 'jukebox.skip' }
  | { t: 'jukebox.stop' };

export type CabinetClientMsg =
  /**
   * Step up to the arcade cabinet on your floor to play `title` (Blockfall when it doesn't say): to
   * carry on with `game` (one the office started for you), or to start a new game, even while you're
   * at it. The office answers `cabinet`, naming who got the cabinet and their game, and `cabinet.game`
   * to you. With `away` you're playing it on the boss's monitor instead: the office follows your game
   * for the high scores just the same, but you don't take the cabinet and nobody watches.
   */
  | { t: 'cabinet.play'; game?: string; title?: GameTitle; away?: boolean }
  /** You put your game down, wherever you were playing it. */
  | { t: 'cabinet.leave' }
  /**
   * Your game as it looks now. It's how your score gets on the high-score table: the office follows
   * the game frame by frame. At the cabinet it's also for everyone else on the floor to watch over
   * your shoulder.
   */
  | { t: 'cabinet.frame'; frame: GameFrame };

export type WhiteboardClientMsg =
  /** You opened the whiteboard (or closed it): everyone on the floor sees who's drawing. */
  | { t: 'wb.open' }
  | { t: 'wb.close' }
  /** Elements you added or changed on the whiteboard; pictures go first, by POST /api/whiteboard/file. */
  | { t: 'wb.update'; elements: WbElement[] }
  /** Where your mouse is on the whiteboard, and what you have selected there. */
  | ({ t: 'wb.pointer'; selected?: string[] } & WbPointer);

export type BallClientMsg =
  /** Pick up the floor's basketball (or catch it): yours if nobody else has it. */
  | { t: 'ball.take' }
  /** Throw the basketball in your hands from (x, y, z) at (vx, vy, vz) m/s, or drop it; everyone on the floor sees it fly. */
  | { t: 'ball.throw'; x: number; y: number; z: number; vx: number; vy: number; vz: number };

export type CarClientMsg =
  /** Get into a seat of one of the floor's cars (by its place in CARS): yours if nobody's in it. */
  | { t: 'car.enter'; car: number; seat: CarSeat }
  /** Get out of the car you're in; driving, it stays parked where you left it. */
  | { t: 'car.leave' }
  /** Where the car you're driving (or a bot of yours is) has got to, and how it's going; everyone else on the floor sees it there. */
  | { t: 'car.drive'; car: number; x: number; z: number; rotY: number; speed: number; steer: number; slip?: number; spin?: number }
  /** A car nobody's in, knocked rolling by yours: where it's got to (your page rolls it till it stops). */
  | { t: 'car.push'; car: number; x: number; z: number; rotY: number; speed: number; steer: number; slip?: number; spin?: number }
  /** Your car (`by`) ran into car `car`, which somebody else drives: the knock it gets, for their page (see shared/car-crash.ts). */
  | { t: 'car.hit'; car: number; by: number; dvx: number; dvz: number; dspin: number }
  /** Honk the horn of the car you're in. */
  | { t: 'car.honk' }
  /** Start a race round the circuit (shared/race.ts) from the wheel of your car: `laps` of it, with `bots` in cars nobody's in. */
  | { t: 'race.start'; laps?: number; bots?: number }
  /** Join the race that's lining up, from the wheel of your car. */
  | { t: 'race.join' };

export type DogClientMsg =
  /** Give the dog on your floor a pat; it has to be within reach. */
  | { t: 'dog.pet' }
  /** Name the dog on your floor ('' gives it back its first name). */
  | { t: 'dog.name'; name: string };

export type ToysServerMsg =
  | { t: 'decor'; items: Decoration[] }
  /** What the dog on your floor is up to now: sent at the start of each leg of its day. */
  | { t: 'dog'; dog: DogState }
  /** The basketball on your floor was picked up, thrown, or put back under the hoop. */
  | { t: 'ball'; ball: BallState }
  /** Someone got into one of your floor's cars, or out of one; `answer` to each car.enter and car.leave of yours, whether you got in or not. */
  | { t: 'cars'; cars: CarState[]; answer?: boolean }
  /** A car on your floor is being driven, or rolling from a knock (see car.drive and car.push). */
  | { t: 'car.move'; car: number; x: number; z: number; rotY: number; speed: number; steer: number; slip?: number; spin?: number }
  /** Someone's car ran into the one you drive (or a bot of yours): the knock it gets. */
  | { t: 'car.hit'; car: number; by: number; dvx: number; dvz: number; dspin: number }
  /** Someone in a car on your floor honked its horn. */
  | { t: 'car.honk'; car: number }
  /** The race on your floor, as it stands now (null: none, or over and cleared away). */
  | { t: 'race'; race: RaceView | null }
  | { t: 'jukebox'; state: JukeboxState }
  /** Who's at the arcade cabinet on your floor now, and the building's high scores. */
  | { t: 'cabinet'; state: CabinetState }
  /**
   * The office's name for the game of yours it's following now (its answer to cabinet.play), or ''
   * when a frame of yours came and it's following none: ask again.
   */
  | { t: 'cabinet.game'; game: string; title: GameTitle }
  /** The game on your floor's cabinet, as its player sees it (sent to everyone else on the floor). */
  | { t: 'cabinet.frame'; frame: GameFrame }
  /** Someone changed these elements on the floor's whiteboard (sent to everyone else on the floor). */
  | { t: 'wb.update'; elements: WbElement[] }
  /** Who has the floor's whiteboard open now. */
  | { t: 'wb.people'; people: string[] }
  /** Someone's mouse on the whiteboard; only people who have it open get these. */
  | ({ t: 'wb.pointer'; id: string; selected?: string[] } & WbPointer);
