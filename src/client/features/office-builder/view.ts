/**
 * The builder's view of the floor: a camera up over the room that you pan, turn and zoom, with the
 * ceiling (and, cut away, the tops of the walls) out of its way, a grid on the floor, and the outline
 * under whatever you've picked up. It looks at one level at a time: the office floor, or upstairs
 * (see levels.ts), where the floor it works on is the deck's.
 */
import * as THREE from 'three';
import { FLOOR, WALL_HEIGHT } from '../../../shared/layout';
import type { Box } from '../../../shared/furniture';
import type { Area } from '../../../shared/mezzanine';

/** How high the room's drawn up to: all of it but the ceiling, or cut away at head height (over the level's own floor) to see in over the walls. */
const CUT = { walls: 2.7, ceiling: WALL_HEIGHT - 0.02 } as const;
const PITCH = { min: 0.4, max: 1.5 } as const;
const DIST = { min: 7, max: 75 } as const;
/** How far past the room's walls the camera's eye may look. */
const MARGIN = 4;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The camera over the floor: where on it it looks, from which way round, how steeply and from how far. */
export class BuilderCamera {
  x = 0;
  z = 0;
  yaw = 0;
  pitch = 0.95;
  dist = 42;
  /** How high the floor it looks at is: the office's, or a deck's. */
  private y = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Puts the office's camera where this one is. */
  place() {
    this.x = clamp(this.x, FLOOR.minX - MARGIN, FLOOR.maxX + MARGIN);
    this.z = clamp(this.z, FLOOR.minZ - MARGIN, FLOOR.maxZ + MARGIN);
    this.pitch = clamp(this.pitch, PITCH.min, PITCH.max);
    this.dist = clamp(this.dist, DIST.min, DIST.max);
    const flat = Math.cos(this.pitch) * this.dist;
    this.camera.position.set(this.x + Math.sin(this.yaw) * flat, this.y + Math.sin(this.pitch) * this.dist, this.z + Math.cos(this.yaw) * flat);
    this.camera.lookAt(this.x, this.y, this.z);
    this.camera.updateMatrixWorld();
  }

  /** Looks at the floor `y` up from now on: what's dragged is dragged over that one. */
  setLevel(y: number) {
    this.y = y;
    this.floor.constant = -y;
  }

  /** Slides it over the floor: `right` and `ahead` in meters, the way the screen has them. */
  pan(right: number, ahead: number) {
    this.x += Math.cos(this.yaw) * right - Math.sin(this.yaw) * ahead;
    this.z += -Math.sin(this.yaw) * right - Math.cos(this.yaw) * ahead;
  }

  /** The ray into the room through a point on the screen (`el`'s own box). */
  rayAt(e: { clientX: number; clientY: number }, el: HTMLElement): THREE.Raycaster {
    const r = el.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.ray;
  }

  /** Where on the floor it looks at a point on the screen is, or null where it's the sky. */
  floorAt(e: { clientX: number; clientY: number }, el: HTMLElement): { x: number; z: number } | null {
    const at = this.rayAt(e, el).ray.intersectPlane(this.floor, this.hit);
    return at ? { x: at.x, z: at.z } : null;
  }
}

const COLORS = { fine: '#2f9bff', bad: '#ff4d5e', hover: '#ffffff' } as const;

/** A flat outline on the floor, round or square, to put under something. */
class Outline {
  readonly group = new THREE.Group();
  private readonly fill: THREE.MeshBasicMaterial;
  private readonly edge: THREE.LineBasicMaterial;
  private readonly square: THREE.Group;
  private readonly circle: THREE.Group;

  constructor(opacity: number) {
    this.fill = new THREE.MeshBasicMaterial({ color: COLORS.fine, transparent: true, opacity, depthWrite: false, fog: false });
    this.edge = new THREE.LineBasicMaterial({ color: COLORS.fine, fog: false });
    const shape = (geo: THREE.BufferGeometry, ring: THREE.BufferGeometry) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(geo, this.fill);
      m.rotation.x = -Math.PI / 2;
      const line = new THREE.LineLoop(ring, this.edge);
      line.rotation.x = -Math.PI / 2;
      g.add(m, line);
      this.group.add(g);
      return g;
    };
    const corners = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    this.square = shape(new THREE.PlaneGeometry(1, 1), new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(corners, 3)));
    const around = Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2), 0]).flat();
    this.circle = shape(new THREE.CircleGeometry(1, 48), new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(around, 3)));
    this.group.visible = false;
    this.group.renderOrder = 5;
  }

  /** Puts it round `box` (a circle `radius` round its middle, when it's round), in `color`; or away, with no box. */
  show(box: Box | null, radius: number | undefined, color: string, y: number) {
    this.group.visible = !!box;
    if (!box) return;
    this.fill.color.set(color);
    this.edge.color.set(color);
    this.square.visible = radius === undefined;
    this.circle.visible = radius !== undefined;
    this.group.position.set((box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2);
    if (radius === undefined) this.square.scale.set(box.maxX - box.minX + 0.12, 1, box.maxZ - box.minZ + 0.12);
    else this.circle.scale.set(radius + 0.06, 1, radius + 0.06);
  }
}

/** Meter lines over `area`, with its edge. */
function gridOver(area: Area): THREE.BufferGeometry {
  const lines: number[] = [];
  const xs = new Set([area.minX, area.maxX]);
  const zs = new Set([area.minZ, area.maxZ]);
  for (let x = Math.ceil(area.minX); x <= area.maxX; x++) xs.add(x);
  for (let z = Math.ceil(area.minZ); z <= area.maxZ; z++) zs.add(z);
  for (const x of xs) lines.push(x, 0, area.minZ, x, 0, area.maxZ);
  for (const z of zs) lines.push(area.minX, 0, z, area.maxX, 0, z);
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
}

/** What the builder draws on the floor it's working on: a meter grid, and the outlines under what you point at and what you picked. */
export class BuilderGizmo {
  readonly group = new THREE.Group();
  private readonly picked = new Outline(0.3);
  private readonly pointed = new Outline(0.12);
  private readonly cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT.walls);
  private readonly grid: THREE.LineSegments;
  /** How high the floor being worked on is, and whether the walls are cut away over it. */
  private y = 0;
  private walls = true;
  /** The stretch of floor the grid's drawn over, as text: it's only drawn again when that changes. */
  private over = JSON.stringify(FLOOR);

  constructor() {
    this.grid = new THREE.LineSegments(gridOver(FLOOR), new THREE.LineBasicMaterial({ color: '#2b2d42', transparent: true, opacity: 0.13, depthWrite: false, fog: false }));
    this.grid.position.y = 0.045;
    this.group.add(this.grid, this.pointed.group, this.picked.group);
  }

  /** The outline under what's picked: red where it can't stand. */
  pick(box: Box | null, radius?: number, bad = false) {
    this.picked.show(box, radius, bad ? COLORS.bad : COLORS.fine, 0.06);
  }

  /** The outline under what the mouse is over. */
  point(box: Box | null, radius?: number) {
    this.pointed.show(box, radius, COLORS.hover, 0.055);
  }

  /** Works on the floor `y` up: the grid and the outlines lie on it, over `area` (the deck's own floor, upstairs; the whole room, with none). */
  setLevel(y: number, area: Area = FLOOR) {
    this.y = y;
    this.group.position.y = y;
    this.cut.constant = this.cutAt();
    const over = JSON.stringify(area);
    if (over === this.over) return;
    this.over = over;
    this.grid.geometry.dispose();
    this.grid.geometry = gridOver(area);
  }

  private cutAt(): number {
    return this.walls ? Math.min(CUT.ceiling, this.y + CUT.walls) : CUT.ceiling;
  }

  /** How high the room's drawn up to, for the renderer to clip at: the walls cut away over the floor being worked on, or just the ceiling. */
  clip(walls: boolean): THREE.Plane {
    this.walls = walls;
    this.cut.constant = this.cutAt();
    return this.cut;
  }

  /** How high the room's drawn up to now. */
  get height(): number {
    return this.cut.constant;
  }
}
