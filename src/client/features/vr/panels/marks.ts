/**
 * Where each ray is on the panels, and the hint's key chips. A ray meets a panel's plane from the
 * front (onPlane, the panels' own hit test); a dot sits where it does, and a tinted box over what it's
 * on would take a click (the browser's own :hover can't show for a ray), since a synthetic pointer
 * gets no hover styles. The hint's chips say the controllers' way what each key is (E is Trigger),
 * keeping the key they were in data-vr-chip so a tap still presses it, and say it again after VR.
 */
import * as THREE from 'three';
import type { Hand } from '../types';
import { vrLabel } from '../keys-table';
import type { Point } from './bridge';
import type { DomPanel } from './panel';

const tmpQ = new THREE.Quaternion();
const tmpN = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const inv = new THREE.Matrix4();

/** Where a ray meets a panel's plane, from the front: its uv (0,0 bottom-left), the point and the distance; `free` lets the uv run past the edges (a drag that's captured). */
export function onPlane(mesh: THREE.Object3D, ray: THREE.Ray, free = false): { uv: THREE.Vector2; point: THREE.Vector3; distance: number } | null {
  mesh.getWorldQuaternion(tmpQ);
  tmpN.set(0, 0, 1).applyQuaternion(tmpQ);
  const denom = tmpN.dot(ray.direction);
  if (denom > -1e-4) return null;
  mesh.getWorldPosition(tmpP);
  const t = tmpN.dot(tmpP.sub(ray.origin)) / denom;
  if (t < 0) return null;
  const point = ray.at(t, new THREE.Vector3());
  const local = point.clone().applyMatrix4(inv.copy(mesh.matrixWorld).invert());
  const uv = new THREE.Vector2(local.x + 0.5, local.y + 0.5);
  if (!free && (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1)) return null;
  return { uv, point, distance: t };
}

/** The hover box and the dot, one of each per hand. */
export class Marks {
  private readonly box = new THREE.MeshBasicMaterial({ color: '#0071e3', transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  private readonly dot = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly disc = new THREE.CircleGeometry(0.0055, 20);
  private readonly boxes: Record<Hand, THREE.Mesh>;
  private readonly dots: Record<Hand, THREE.Mesh>;

  constructor(group: THREE.Group, order: number) {
    for (const m of [this.box, this.dot]) m.userData.outlineParameters = { visible: false };
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.visible = false;
      m.frustumCulled = false;
      group.add(m);
      return m;
    };
    this.boxes = { left: make(this.plane, this.box), right: make(this.plane, this.box) };
    this.dots = { left: make(this.disc, this.dot), right: make(this.disc, this.dot) };
  }

  /** A hand's dot at `at` (facing `eye`), or none. */
  dotAt(hand: Hand, at: THREE.Vector3 | null, eye: THREE.Vector3): void {
    const d = this.dots[hand];
    d.visible = !!at;
    if (!at) return;
    d.position.copy(at);
    d.lookAt(eye);
  }

  /** A hand's hover box over `el` on panel `p`, or none. */
  boxOn(hand: Hand, p: DomPanel | null, el: Element | null): void {
    const box = this.boxes[hand];
    const seg = p && el ? p.segments.find((s) => s.el.contains(el)) : null;
    if (!p || !el || !seg) {
      box.visible = false;
      return;
    }
    const b = el.getBoundingClientRect();
    const l = p.local(seg, { x: b.left, y: b.top, w: b.width, h: b.height });
    if (box.parent !== p.mesh) p.mesh.add(box);
    box.position.set(l.x, l.y, 0);
    box.scale.set(l.w, l.h, 1);
    box.visible = true;
  }

  dispose(): void {
    for (const m of [...Object.values(this.boxes), ...Object.values(this.dots)]) m.removeFromParent();
    this.box.dispose();
    this.dot.dispose();
    this.plane.dispose();
    this.disc.dispose();
  }
}

/** The hint's chips, said the controllers' way; each keeps the key it was in data-vr-chip. */
export function relabelChips(root: ParentNode = document): void {
  for (const chip of root.querySelectorAll<HTMLElement>('#hint .key:not([data-vr-chip])')) {
    const was = chip.textContent ?? '';
    chip.dataset.vrChip = was;
    const label = vrLabel(was);
    if (label) chip.textContent = label;
  }
}

/** Every chip as it was. */
export function restoreChips(root: ParentNode = document): void {
  for (const chip of root.querySelectorAll<HTMLElement>('[data-vr-chip]')) {
    if (chip.textContent !== chip.dataset.vrChip) chip.textContent = chip.dataset.vrChip ?? '';
    delete chip.dataset.vrChip;
  }
}

/** The key chip at a client point (a little slack round each), and the key it is. */
export function chipAt(root: Element, p: Point): HTMLElement | null {
  for (const chip of root.querySelectorAll<HTMLElement>('.key')) {
    const r = chip.getBoundingClientRect();
    if (p.x >= r.left - 4 && p.x <= r.right + 4 && p.y >= r.top - 4 && p.y <= r.bottom + 4) return chip;
  }
  return null;
}
