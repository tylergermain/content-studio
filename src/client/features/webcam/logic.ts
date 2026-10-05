// The webcam face's numbers and rules, with nothing of the browser in them (tests/webcam.test.ts).

/** The size the camera is asked for, in px: a small square, all a face on a character's head needs. */
export const CAM_SIZE = 240;
/** Frames a second the camera is asked for (and the most that's sent, see CAM_ENCODING in voice-camera.ts). */
export const CAM_FPS = 15;

/**
 * How near someone has to be (m) for their webcam to be shown on their face, and how far they go before
 * it's paused again: a little apart, so someone at the edge doesn't flicker between the two.
 */
export const SHOW = { near: 25, far: 27 } as const;
/**
 * And for yours to be sent to them: from a metre further out, so it's arriving by the time they're near
 * enough, until a metre past where they stop showing it, so a face that's showing never freezes for want
 * of it and hardly anything is sent that isn't shown.
 */
export const SEND = { near: 26, far: 28 } as const;

/**
 * The most people your webcam goes to at once, and the most faces that play theirs: the nearest, so a
 * crowded floor costs no more to send or to play than a few people near you.
 */
export const MOST = 8;

/**
 * Whether it's on now, given whether it was and how far away they are (m): it comes on inside `near`,
 * goes off past `far`, and between the two stays as it was. Null is nowhere you could see them (another
 * floor, the 2D view): off.
 */
export function within(range: { near: number; far: number }, was: boolean, d: number | null): boolean {
  if (d === null || !Number.isFinite(d)) return false;
  return d < (was ? range.far : range.near);
}

/**
 * Who it's on for, among everyone it could be (`within` a range): the `most` nearest. Kept from one
 * pass to the next (`begin`, `add` for each, `end`), which `within` needs, and someone it's on for keeps
 * their place against someone new until the newcomer is nearer by more than the range's own margin, so
 * two at about the same distance don't take turns. Nothing is made anew on a pass but what's new.
 */
export class Nearest {
  /** Who it's on for, as of the last pass. */
  readonly on = new Set<string>();
  private readonly ids: string[] = [];
  /** How far each is, for sorting by: less the margin for someone it's on for already. */
  private readonly key = new Map<string, number>();
  private readonly byKey = (a: string, b: string) => this.key.get(a)! - this.key.get(b)!;

  constructor(
    private readonly range: { near: number; far: number },
    private readonly most: number,
  ) {}

  begin() {
    this.ids.length = 0;
    this.key.clear();
  }

  /** Someone `d` m away (null: nowhere you could see them). */
  add(id: string, d: number | null) {
    const was = this.on.has(id);
    if (!within(this.range, was, d)) return;
    this.ids.push(id);
    this.key.set(id, d! - (was ? this.range.far - this.range.near : 0));
  }

  /** Who it's on for now: the nearest `most` of those added that are within range. */
  end(): ReadonlySet<string> {
    this.ids.sort(this.byKey);
    this.on.clear();
    for (let i = 0; i < this.ids.length && i < this.most; i++) this.on.add(this.ids[i]);
    return this.on;
  }
}

/** What someone's face shows: the drawn one (no webcam), a card saying it's coming (no picture yet), or their webcam. */
export type FaceShows = 'drawn' | 'waiting' | 'video';

/**
 * `on`: their webcam is on (PeerInfo.webcam). `frames`: their picture has reached this browser and is
 * playing (or was, before they walked out of range: its last frame stays up).
 */
export function faceShows(on: boolean, frames: boolean): FaceShows {
  return !on ? 'drawn' : frames ? 'video' : 'waiting';
}

/** What getUserMedia is asked for: the small square at 15 frames a second, from `deviceId` if one's picked. */
export function cameraConstraints(deviceId?: string | null): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: CAM_SIZE },
    height: { ideal: CAM_SIZE },
    aspectRatio: { ideal: 1 },
    frameRate: { ideal: CAM_FPS, max: CAM_FPS },
    // Chrome crops and scales any camera to that; others may hand over what the camera has (see camScale).
    resizeMode: 'crop-and-scale',
  } as MediaTrackConstraints;
}

/** How far a picture `width`×`height` is shrunk before it's sent, so its short side is about CAM_SIZE. */
export function camScale(width: number | undefined, height: number | undefined): number {
  const short = Math.min(width || CAM_SIZE, height || CAM_SIZE);
  return Math.max(1, Math.round((short / CAM_SIZE) * 100) / 100);
}

/**
 * How much of the picture's middle square a face shows, across and down. A webcam frames a head with
 * room round it, and all of that on a round face reads as someone seen through a porthole: closer in,
 * it's their face.
 */
export const FACE_ZOOM = 0.75;

/**
 * The middle of a `width`×`height` picture, as a texture's repeat and offset: a square, so a camera
 * that isn't square isn't squashed onto a round face, and of that the middle FACE_ZOOM. `mirror` flips
 * it left to right: your own face, seen by you, is a mirror's, as a selfie is.
 */
export function squareCrop(width: number, height: number, mirror: boolean): { repeat: [number, number]; offset: [number, number] } {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const rx = (w > h ? h / w : 1) * FACE_ZOOM;
  const ry = (h > w ? w / h : 1) * FACE_ZOOM;
  const ox = (1 - rx) / 2;
  const oy = (1 - ry) / 2;
  return mirror ? { repeat: [-rx, ry], offset: [1 - ox, oy] } : { repeat: [rx, ry], offset: [ox, oy] };
}

/**
 * Where a point on the face (x right and y up, in the head's own meters, as you look at them) is in
 * the picture: the picture's square laid flat across a circle `radius` wide, its middle at the
 * circle's. What's on their right shows on your left, as it would face to face.
 */
export function faceUv(x: number, y: number, radius: number): [u: number, v: number] {
  return [0.5 + x / (2 * radius), 0.5 + y / (2 * radius)];
}

/** What a camera is called in the list to pick from: its own name once the browser says it, else its place in the list. */
export function cameraName(label: string, i: number): string {
  const name = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return name || `Camera ${i + 1}`;
}
