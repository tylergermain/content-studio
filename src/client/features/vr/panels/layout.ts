/**
 * Where VR's panels go and how a point on one maps to the page: pure numbers, no DOM and no scene, so
 * tests/vr-panels.test.ts can pin them. A window floats about a meter ahead of you at a little under
 * eye height and stays put in the world until you look well away from it for a moment, walk off, or
 * another window comes on top; a window as big as the screen (the builder) is a sheet, wider and
 * further off; the hint strip hangs low ahead of you and follows your gaze lazily; the keyboard lies
 * tilted under the window. yaw and pitch are camYaw/lookPitch's: you look along (-sin yaw, -cos yaw),
 * pitch up is positive.
 */

export interface V3 { x: number; y: number; z: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pose { position: V3; yaw: number; pitch: number }
export interface HeadPose { position: V3; yaw: number; pitch: number }

/** Meters a CSS pixel is on a window a meter away (1 px ≈ 1.1 mm); further panels scale with their distance. */
export const MM_PER_PX = 0.0011;
/** A window: this far ahead, this far under your eyes. */
export const WINDOW = { dist: 1.0, drop: 0.08 } as const;
/** A window covering more than this much of the screen is a sheet: this wide, this far off. */
export const SHEET = { cover: 0.8, width: 1.8, dist: 1.4, drop: 0.12 } as const;
/** The hint strip: this far ahead, this many degrees under where you look; it eases after your gaze at `rate`/s. */
export const HINT = { dist: 1.4, below: 24, rate: 5, dead: 6 } as const;
/**
 * When a world-locked panel comes back in front of you: looked this far away (deg) for this long (s),
 * or this far off (m), or nearer than `near` (m) without your putting it there (a seat moves you onto
 * the window it opens).
 */
export const FOLLOW = { angle: 55, after: 0.6, far: 2.2, near: 0.45, ease: 0.35 } as const;
/** The keyboard: tilted back this much (deg), this far under the window, or this far ahead and under your eyes on its own. */
export const KEYBOARD = { tilt: 35, gap: 0.05, closer: 0.18, dist: 0.6, drop: 0.38, width: 0.62 } as const;
/** How near and far a grabbed panel may be pushed or pulled (m), and how fast the stick does it (m/s). */
export const GRAB = { near: 0.35, far: 4, speed: 1.5 } as const;

const DEG = Math.PI / 180;

/** Where you look, as a unit vector. */
export function forward(yaw: number, pitch = 0): V3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** A panel `dist` ahead of the head along its yaw, `drop` under the eyes, facing back at you (a plane's front is +z: rotation.y = yaw). */
export function placeAhead(head: HeadPose, dist: number, drop: number): Pose {
  const f = forward(head.yaw);
  return { position: { x: head.position.x + f.x * dist, y: head.position.y - drop, z: head.position.z + f.z * dist }, yaw: head.yaw, pitch: 0 };
}

/** Whether a window this big (CSS px) on a screen this big is a sheet (the builder, a full-screen workspace). */
export function isSheet(w: number, h: number, vw: number, vh: number): boolean {
  return vw > 0 && vh > 0 && (w * h) / (vw * vh) > SHEET.cover;
}

/** Meters per CSS px for each kind of panel: a sheet is SHEET.width wide whatever the screen. */
export function metresPerPx(kind: 'window' | 'sheet' | 'hint', vw: number): number {
  if (kind === 'sheet') return SHEET.width / Math.max(1, vw);
  if (kind === 'hint') return MM_PER_PX * HINT.dist;
  return MM_PER_PX * WINDOW.dist;
}

/** Texture pixels per CSS px: `scale`, less when the panel would pass `max` pixels on a side. */
export function textureScale(w: number, h: number, scale: number, max = 2048): number {
  const side = Math.max(w, h, 1);
  return Math.max(0.25, Math.min(scale, max / side));
}

/** The client point under a panel's uv (0,0 bottom-left), over the rect the panel shows. */
export function uvToClient(u: number, v: number, r: Rect): { x: number; y: number } {
  return { x: r.x + u * r.w, y: r.y + (1 - v) * r.h };
}

/** The uv of a client point on a panel showing `r` (outside 0..1 when it's off the panel). */
export function clientToUv(x: number, y: number, r: Rect): { u: number; v: number } {
  return { u: r.w ? (x - r.x) / r.w : 0, v: r.h ? 1 - (y - r.y) / r.h : 0 };
}

/** The smallest signed difference between two angles (radians), in -π..π. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** How far (degrees) a panel at `at` is from where the head looks, sideways and up/down together. */
export function offGaze(head: HeadPose, at: V3): number {
  const dx = at.x - head.position.x;
  const dy = at.y - head.position.y;
  const dz = at.z - head.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const f = forward(head.yaw, head.pitch);
  const dot = (dx * f.x + dy * f.y + dz * f.z) / len;
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

/** What a world-locked panel keeps of the last frames: how long you've been looking away from it. */
export interface FollowState { away: number }

/**
 * Whether a world-locked panel comes back in front of you this frame: you've looked more than
 * FOLLOW.angle away from it for FOLLOW.after seconds (unless you put it there yourself: `pinned`), or
 * it's more than FOLLOW.far from your head (the elevator, a seat), or (not pinned) under FOLLOW.near.
 * `st` keeps the time looked away.
 */
export function shouldRecenter(st: FollowState, head: HeadPose, at: V3, dt: number, pinned = false): boolean {
  const dist = Math.hypot(at.x - head.position.x, at.y - head.position.y, at.z - head.position.z);
  if (dist > FOLLOW.far) {
    st.away = 0;
    return true;
  }
  if (pinned) {
    st.away = 0;
    return false;
  }
  if (dist < FOLLOW.near) {
    st.away = 0;
    return true;
  }
  st.away = offGaze(head, at) > FOLLOW.angle ? st.away + dt : 0;
  if (st.away < FOLLOW.after) return false;
  st.away = 0;
  return true;
}

/** Eases a pose from `a` to `b`, t in 0..1 (smoothstep), the yaw the short way round. */
export function easePose(a: Pose, b: Pose, t: number): Pose {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return {
    position: { x: lerp(a.position.x, b.position.x), y: lerp(a.position.y, b.position.y), z: lerp(a.position.z, b.position.z) },
    yaw: a.yaw + angleDiff(b.yaw, a.yaw) * k,
    pitch: lerp(a.pitch, b.pitch),
  };
}

/** The hint strip's lazy aim: where it was (yaw, pitch) eased toward HINT.below under the gaze, standing still inside HINT.dead degrees. */
export function lazyAim(cur: { yaw: number; pitch: number }, head: HeadPose, dt: number): { yaw: number; pitch: number } {
  const ty = head.yaw;
  const tp = head.pitch - HINT.below * DEG;
  const dy = angleDiff(ty, cur.yaw);
  const dp = tp - cur.pitch;
  if (Math.hypot(dy, dp) < HINT.dead * DEG) return cur;
  const k = 1 - Math.exp(-HINT.rate * dt);
  return { yaw: cur.yaw + dy * k, pitch: cur.pitch + dp * k };
}

/** The hint strip's pose for an aim: HINT.dist along it, facing you, tilted to face your eyes. */
export function hintPose(head: HeadPose, aim: { yaw: number; pitch: number }): Pose {
  const f = forward(aim.yaw, aim.pitch);
  const p = head.position;
  return { position: { x: p.x + f.x * HINT.dist, y: p.y + f.y * HINT.dist, z: p.z + f.z * HINT.dist }, yaw: aim.yaw, pitch: aim.pitch };
}

/**
 * The keyboard's pose: under a window (`under`, its pose and height in meters), a little nearer you
 * and tilted back; on its own, ahead of you and under your eyes.
 */
export function keyboardPose(head: HeadPose, under: { pose: Pose; height: number } | null, kbHeight: number): Pose {
  const tilt = -KEYBOARD.tilt * DEG;
  if (!under) {
    const p = placeAhead(head, KEYBOARD.dist, KEYBOARD.drop);
    return { ...p, pitch: tilt };
  }
  const { pose, height } = under;
  const toward = forward(pose.yaw);
  // Down the window's bottom edge, then half the keyboard's slope further.
  const down = height / 2 + KEYBOARD.gap + (kbHeight / 2) * Math.cos(-tilt);
  const back = KEYBOARD.closer + (kbHeight / 2) * Math.sin(-tilt);
  return {
    position: { x: pose.position.x - toward.x * back, y: pose.position.y - down, z: pose.position.z - toward.z * back },
    yaw: pose.yaw,
    pitch: tilt,
  };
}

/** A grabbed panel's new distance along the ray: pushed or pulled by the stick (`push` -1..1, + pushes away). */
export function pushPull(dist: number, push: number, dt: number): number {
  return Math.max(GRAB.near, Math.min(GRAB.far, dist + push * GRAB.speed * dt));
}

/** Stacks boxes (the newest toasts, then the hint) top to bottom, centered: each one's offset, and the whole size. */
export function stack(sizes: readonly { w: number; h: number }[], gap = 8): { at: { x: number; y: number }[]; w: number; h: number } {
  const w = Math.max(0, ...sizes.map((s) => s.w));
  const at: { x: number; y: number }[] = [];
  let y = 0;
  for (const s of sizes) {
    at.push({ x: Math.round((w - s.w) / 2), y });
    y += s.h + gap;
  }
  return { at, w, h: Math.max(0, y - (sizes.length ? gap : 0)) };
}

/** What B / Y does, in order: the option list, then a window (Escape, which the window decides on), the keyboard, the HUD sheet, else Escape for the office. */
export type BackAction = 'options' | 'escape' | 'keyboard' | 'sheet';
export function backAction(up: { options: boolean; window: boolean; keyboard: boolean; sheet: boolean }): BackAction {
  if (up.options) return 'options';
  if (up.window) return 'escape';
  if (up.keyboard) return 'keyboard';
  if (up.sheet) return 'sheet';
  return 'escape';
}

/** Whether two rects overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Their overlap, or null. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
}

/** The smallest rect holding both. */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
