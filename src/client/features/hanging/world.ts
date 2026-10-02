import * as THREE from 'three';
import { FRAME_BORDER, WALLS, frameRect, wallFloor, wallPose, wallTop, type Decoration, type WallId, type WallRect } from '../../../shared/decor';
import type { RoomOptions } from '../../../shared/floorplan';
import { FLOOR } from '../../../shared/layout';
import { DECK_Y, deckOf } from '../../../shared/mezzanine';
import type { Interactable } from '../../world/types';
import { brokenTexture, buildFrame, disposeFrame, flat, loadPicture, prunePictures, showTexture, type PictureMesh } from '../../world/frames';

// The pictures on the walls, and the one you're about to hang. The images themselves and the frames
// they're in are the world's (world/frames.ts); what the rest of the feature takes of those, it takes from here.
export { brokenTexture, holdPicture, imageUrl, loadPicture, type Picture } from '../../world/frames';

function placeOnWall(group: THREE.Object3D, wall: WallId, u: number, y: number, out = 0.005) {
  const p = wallPose(wall, u, y, out);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.rotY;
}

interface FrameView {
  d: Decoration;
  /** What the frame was built for; a change means building it again. */
  key: string;
  group: THREE.Group;
  picture: PictureMesh;
  it: Interactable;
}

/** The pictures on the walls. Put `group` in the office so looking at a picture targets it. */
export class Gallery {
  readonly group = new THREE.Group();
  /** For walking up to a picture in third person. */
  readonly interactables: Interactable[] = [];
  private frames = new Map<string, FrameView>();
  private hidden: string | null = null;

  /** Shows the pictures the floor has, on a floor with this room: one hung over an upstairs is looked at from up there. */
  sync(items: Decoration[], room: RoomOptions = {}) {
    const seen = new Set<string>();
    for (const d of items) {
      seen.add(d.id);
      const key = `${d.url}|${d.w}|${d.h}|${d.frame}`;
      let v = this.frames.get(d.id);
      if (v && v.key !== key) {
        this.drop(v);
        v = undefined;
      }
      if (!v) {
        v = this.build(d, key);
        this.frames.set(d.id, v);
      }
      v.d = d;
      placeOnWall(v.group, d.wall, d.u, d.y);
      const front = wallPose(d.wall, d.u, 0, 1.4);
      v.it.x = front.x;
      v.it.z = front.z;
      v.it.y = wallFloor(d.wall, d.u, d.y, room);
    }
    for (const [id, v] of this.frames) {
      if (seen.has(id)) continue;
      this.drop(v);
      this.frames.delete(id);
    }
    this.refresh();
    prunePictures(new Set(items.map((d) => d.url)));
  }

  /** Hides a picture while it's being moved; null puts it back. */
  hide(id: string | null) {
    this.hidden = id;
    this.refresh();
  }

  /** The frames' outlines, except the one with id `except`. */
  rects(except?: string): WallRect[] {
    const out: WallRect[] = [];
    for (const v of this.frames.values()) if (v.d.id !== except) out.push(frameRect(v.d));
    return out;
  }

  private refresh() {
    this.interactables.length = 0;
    for (const v of this.frames.values()) {
      v.group.visible = v.d.id !== this.hidden;
      if (v.group.visible) this.interactables.push(v.it);
    }
  }

  private build(d: Decoration, key: string): FrameView {
    const { group, picture } = buildFrame(d.w, d.h, d.frame);
    const it: Interactable = { kind: 'decor', decorId: d.id, x: 0, z: 0, radius: Math.max(1.6, d.w / 2 + 0.8) };
    group.userData.interact = it;
    this.group.add(group);
    const current = () => this.frames.get(d.id)?.picture === picture;
    loadPicture(d.url).then(
      (pic) => current() && showTexture(picture, pic.texture, pic.aspect),
      () => current() && showTexture(picture, brokenTexture(), 4 / 3),
    );
    return { d, key, group, picture, it };
  }

  private drop(v: FrameView) {
    this.group.remove(v.group);
    disposeFrame(v.group);
  }
}

// ---- Hanging one ------------------------------------------------------------------------------------

/** The picture you're about to hang, following your aim, with a green (fits) or red (blocked) glow. */
export class Ghost {
  readonly group = new THREE.Group();
  private halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private body: THREE.Group | null = null;
  private key = '';

  constructor() {
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flat({ color: '#06d6a0', transparent: true, opacity: 0.5, depthWrite: false }));
    this.halo.position.z = -0.002;
    this.group.add(this.halo);
    this.group.visible = false;
  }

  show(at: { wall: WallId; u: number; y: number; w: number; h: number; ok: boolean }, frame: number, texture: THREE.Texture, aspect: number) {
    const key = `${at.w}|${at.h}|${frame}|${texture.uuid}|${aspect}`;
    if (key !== this.key) {
      this.clearBody();
      const { group, picture } = buildFrame(at.w, at.h, frame);
      showTexture(picture, texture, aspect);
      this.body = group;
      this.group.add(group);
      this.key = key;
    }
    this.halo.scale.set(at.w + 2 * FRAME_BORDER + 0.16, at.h + 2 * FRAME_BORDER + 0.16, 1);
    this.halo.material.color.set(at.ok ? '#06d6a0' : '#ef476f');
    // Where it can't hang it floats out in front, so a board or the TV doesn't hide it.
    placeOnWall(this.group, at.wall, at.u, at.y, at.ok ? 0.005 : 0.32);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  /** Lets go of the picture it showed. */
  clear() {
    this.hide();
    this.clearBody();
  }

  private clearBody() {
    if (!this.body) return;
    this.group.remove(this.body);
    disposeFrame(this.body);
    this.body = null;
    this.key = '';
  }
}

/**
 * Where a ray from inside the room first meets a wall, within `maxDist` meters (the whole room by
 * default), on a floor with this room: its upstairs is in the way, and says how high each wall goes.
 */
export function aimAtWall(ray: THREE.Ray, maxDist = 60, room: RoomOptions = {}): { wall: WallId; u: number; y: number } | null {
  const o = ray.origin;
  const d = ray.direction;
  // Only from inside: out on the balcony or down on the street, the walls face the other way.
  if (o.x < FLOOR.minX || o.x > FLOOR.maxX || o.z < FLOOR.minZ || o.z > FLOOR.maxZ || o.y < 0) return null;
  // The upstairs floor (the loft's, the big mezzanine's) hides whatever is past it, from above or below.
  const slab = deckOf(room)?.slab;
  if (slab && d.y !== 0) {
    const t = (DECK_Y - 0.12 - o.y) / d.y;
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    if (t > 0 && x > slab.minX && x < slab.maxX && z > slab.minZ && z < slab.maxZ) maxDist = Math.min(maxDist, t);
  }
  const hits: [WallId, number][] = [];
  if (d.z < 0) hits.push(['north', (FLOOR.minZ - o.z) / d.z]);
  if (d.z > 0) hits.push(['south', (FLOOR.maxZ - o.z) / d.z]);
  if (d.x < 0) hits.push(['west', (FLOOR.minX - o.x) / d.x]);
  if (d.x > 0) hits.push(['east', (FLOOR.maxX - o.x) / d.x]);
  let best: { wall: WallId; u: number; y: number } | null = null;
  let bestT = maxDist;
  for (const [wall, t] of hits) {
    if (!(t > 0 && t < bestT)) continue;
    const y = o.y + d.y * t;
    const u = wall === 'north' || wall === 'south' ? o.x + d.x * t : o.z + d.z * t;
    if (y < 0 || u < WALLS[wall].min || u > WALLS[wall].max || y > wallTop(wall, u, room)) continue;
    best = { wall, u, y };
    bestT = t;
  }
  return best;
}
