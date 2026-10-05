/**
 * A <select>'s options in VR: the browser's own list can't open in a headset, so a press on a select
 * shows this one beside it, a canvas of the options (the chosen one ticked) that the ray points at,
 * the trigger picks from and the stick scrolls. Picking one sets the select and tells the page, with
 * input and change, as a real pick would.
 */
import * as THREE from 'three';
import { noOutline } from '../../../core/outline';
import type { Hand } from '../types';
import type { Pose } from './layout';

const W = 640;
const ROW = 56;
const MAX_ROWS = 9;
const PAD = 12;
/** Meters per canvas px. */
const MPP = 0.00055;

interface Row { label: string; index: number; disabled: boolean; group: boolean }

export class OptionList {
  readonly id = 'options';
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private select: HTMLSelectElement | null = null;
  private rows: Row[] = [];
  private top = 0;
  private hover = -1;
  private pressed = -1;

  constructor(order: number) {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.userData.vrHot = false;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.name = 'vr-panel-options';
    this.mesh.renderOrder = order;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    noOutline(this.mesh);
  }

  get open(): boolean {
    return !!this.select;
  }

  visible(): boolean {
    return !!this.select?.isConnected;
  }

  /** Opens the list for `sel`, at `pose` (beside it on its panel, a little nearer you). */
  show(sel: HTMLSelectElement, pose: Pose): void {
    this.select = sel;
    this.rows = [];
    for (const el of sel.children) {
      if (el instanceof HTMLOptGroupElement) {
        this.rows.push({ label: el.label, index: -1, disabled: true, group: true });
        for (const o of el.children) if (o instanceof HTMLOptionElement && !o.hidden) this.rows.push({ label: o.label, index: o.index, disabled: o.disabled || el.disabled, group: false });
      } else if (el instanceof HTMLOptionElement && !el.hidden) this.rows.push({ label: el.label, index: el.index, disabled: el.disabled, group: false });
    }
    const shown = Math.min(MAX_ROWS, Math.max(1, this.rows.length));
    this.canvas.width = W;
    this.canvas.height = shown * ROW + PAD * 2;
    // A new size is a new texture on the GPU.
    this.texture.dispose();
    const chosen = this.rows.findIndex((r) => r.index === sel.selectedIndex);
    this.top = Math.max(0, Math.min(this.rows.length - shown, chosen - Math.floor(shown / 2)));
    this.hover = -1;
    this.pressed = -1;
    this.mesh.scale.set(W * MPP, this.canvas.height * MPP, 1);
    this.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.mesh.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    this.mesh.updateMatrixWorld(true);
    this.mesh.visible = true;
    this.draw();
  }

  close(): void {
    this.select = null;
    this.mesh.visible = false;
  }

  private rowAt(uv: THREE.Vector2): number {
    const y = (1 - uv.y) * this.canvas.height - PAD;
    if (y < 0 || uv.x < 0 || uv.x > 1) return -1;
    const i = this.top + Math.floor(y / ROW);
    return i < this.rows.length && i - this.top < MAX_ROWS ? i : -1;
  }

  point(kind: 'move' | 'down' | 'up' | 'leave', uv: THREE.Vector2, _hand: Hand): void {
    const i = kind === 'leave' ? -1 : this.rowAt(uv);
    if (kind === 'down') this.pressed = i;
    if (kind === 'up') {
      const was = this.pressed;
      this.pressed = -1;
      if (i >= 0 && i === was) return this.pick(i);
    }
    if (i !== this.hover || kind !== 'move') {
      this.hover = i;
      this.draw();
    }
  }

  scroll(dy: number): void {
    const shown = Math.min(MAX_ROWS, this.rows.length);
    const top = Math.max(0, Math.min(this.rows.length - shown, this.top + dy / ROW));
    if (Math.floor(top) === Math.floor(this.top)) {
      this.top = top;
      return;
    }
    this.top = top;
    this.draw();
  }

  private pick(i: number): void {
    const row = this.rows[i];
    const sel = this.select;
    if (!row || row.disabled || row.group || !sel) return;
    if (sel.selectedIndex !== row.index) {
      sel.selectedIndex = row.index;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.close();
  }

  private draw(): void {
    const g = this.g;
    const { width, height } = this.canvas;
    g.clearRect(0, 0, width, height);
    g.fillStyle = 'rgba(246, 246, 248, .97)';
    g.beginPath();
    g.roundRect(0, 0, width, height, 22);
    g.fill();
    g.strokeStyle = 'rgba(60, 60, 67, .2)';
    g.lineWidth = 2;
    g.stroke();
    const first = Math.floor(this.top);
    for (let i = first; i < Math.min(this.rows.length, first + MAX_ROWS); i++) {
      const row = this.rows[i];
      const y = PAD + (i - first) * ROW;
      if ((i === this.hover || i === this.pressed) && !row.disabled) {
        g.fillStyle = i === this.pressed ? '#0071e3' : 'rgba(0, 113, 227, .13)';
        g.beginPath();
        g.roundRect(PAD, y + 2, width - PAD * 2, ROW - 4, 12);
        g.fill();
      }
      const on = row.index >= 0 && row.index === this.select?.selectedIndex;
      g.fillStyle = i === this.pressed ? '#fff' : row.group ? '#636366' : row.disabled ? 'rgba(60,60,67,.35)' : '#1d1d1f';
      g.font = `${row.group ? 600 : on ? 600 : 500} ${row.group ? 22 : 26}px -apple-system, system-ui, sans-serif`;
      g.textBaseline = 'middle';
      g.fillText(on ? '✓' : '', PAD + 14, y + ROW / 2);
      g.fillText(row.label, PAD + (row.group ? 14 : 50), y + ROW / 2, width - PAD * 2 - 64);
    }
    if (this.rows.length > MAX_ROWS) {
      const h = (MAX_ROWS / this.rows.length) * (height - PAD * 2);
      const y = PAD + (this.top / this.rows.length) * (height - PAD * 2);
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.beginPath();
      g.roundRect(width - 10, y, 5, h, 3);
      g.fill();
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.close();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
