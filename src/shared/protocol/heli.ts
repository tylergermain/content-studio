// Friday One, the helicopter on its pad in Friday Park (shared/mainstreet.ts PARK.pad). There's one,
// for the whole building: street admins fly it, up to three others ride along, and everyone on every
// floor (and up on the roof) sees and hears it. The pilot's page flies it (shared/heli.ts) and says
// where it is; the office checks each pose, tells everyone else, keeps where it was left in its data
// folder's heli.json, and flies it home by itself if the pilot goes mid-flight.

/** Where it is, in the street frame (x and z as on Friday's bottom floor, h the skids' height above the street), and how it's turned and leaning. */
export interface HeliPose {
  x: number;
  h: number;
  z: number;
  /** Which way its nose points (rotation round y, 0 down +z). */
  yaw: number;
  /** Nose down into speed (radians); looks only. */
  pitch: number;
  /** Banked into a turn (radians); looks only. */
  roll: number;
  /** How fast the rotor's turning, 0 (still) to 1 (flying speed). */
  spin: number;
}

export type HeliSeat = 'pilot' | 'passenger';

/** Someone aboard. */
export interface HeliCrew {
  /** Their PeerInfo id. */
  id: string;
  name: string;
  color: string;
  seat: HeliSeat;
  /** Which of the four seats (HELI.seats): 0 is the pilot's, 1..3 the passengers'. */
  place: number;
  /** The floor they boarded from: who's on it sees them as themselves; everyone else as a figure in the seat. */
  floor: string | null;
}

/**
 * Parked: down, nobody at the controls. Landed: down with a pilot aboard (the rotor may be turning).
 * Flying: in the air with a pilot. Home: flying itself home to its pad, the pilot gone.
 */
export type HeliStage = 'parked' | 'landed' | 'flying' | 'home';

export interface HeliState {
  pose: HeliPose;
  /** On the ground (or a pad). */
  landed: boolean;
  stage: HeliStage;
  /** The pad it's on: its home in Friday Park; null on open ground, or in the air. */
  pad: 'park' | null;
  crew: HeliCrew[];
}

export type HeliClientMsg =
  /**
   * Get in: at the controls (street admins only, one pilot at a time) or a passenger's seat (anyone, up
   * to three). Only while it's down, from within reach of a door.
   */
  | { t: 'heli.board'; seat: HeliSeat }
  /** Get out: only while it's down. The pilot getting out leaves it parked where it is. */
  | { t: 'heli.leave' }
  /**
   * The pilot's page, every 66 ms or so while flying (and on touching down or lifting off): where it is
   * now. `landed` asks to set down there, which the office refuses over anyone, or where it may not land.
   */
  | { t: 'heli.fly'; pose: HeliPose; landed: boolean };

export type HeliServerMsg =
  /** Someone got in or out, it touched down or took off, or it's flying itself home: to everyone. */
  | { t: 'heli'; heli: HeliState }
  /** Where it is now (`at`: when, ms since 1970 on the office's clock): to everyone but the pilot, often, and droppable. */
  | { t: 'heli.move'; pose: HeliPose; at: number }
  /**
   * To the pilot: a pose (or a landing) the office won't take, and why. `pose` is the last one it took,
   * to go back to; refused a landing, it holds a hover there instead.
   */
  | { t: 'heli.snap'; pose: HeliPose; landed: boolean; why: string };
