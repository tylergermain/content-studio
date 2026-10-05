/**
 * The keyboard in VR: a canvas of keys (keyboard-layout.ts) lying tilted under the window, that the
 * ray points at and the trigger presses. Letters, digits and symbols are typed into whatever has the
 * focus, through the editor (keys.ts typeText), so the field's own listeners and xterm see typing;
 * Enter, ⌫, Tab, Esc and the arrows are key presses (tapKey), which do in a field what a real key
 * would. Ctrl stays on for the next key (Ctrl+C in a terminal). With nothing focused, a key goes to
 * the office as its key press (T to chat, G, N, 1-6). 🎤 is the field's own dictation button, where
 * there is one. It shows by itself when a text field on a panel takes the focus.
 */
import * as THREE from 'three';
import { noOutline } from '../../../core/outline';
import { focusedElement, tapKey, typeText } from '../keys';
import { codeOfChar } from '../keys-table';
import type { Hand } from '../types';
import { boardFor, keyAt, repeats, REPEAT, type Board, type KeyDef, type Layer, type PlacedKey } from './keyboard-layout';
import { KEYBOARD } from './layout';

const W = 1280;

export class Keyboard {
  readonly id = 'keyboard';
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shown = false;
  /** Shown by itself (a field took the focus), so it goes again by itself. */
  auto = false;
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private layer: Layer = 'letters';
  private shift = false;
  private caps = false;
  private shiftAt = 0;
  private ctrl = false;
  private terminal = false;
  private board: Board = boardFor('letters', false, false);
  private readonly hover: Record<Hand, PlacedKey | null> = { left: null, right: null };
  private readonly held: Record<Hand, { key: PlacedKey; next: number } | null> = { left: null, right: null };
  private dirty = true;

  constructor(order: number) {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;
    this.texture.userData.vrHot = false;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.name = 'vr-panel-keyboard';
    this.mesh.renderOrder = order;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    noOutline(this.mesh);
    this.rebuild();
  }

  /** Its height in meters (it's KEYBOARD.width wide). */
  get height(): number {
    return KEYBOARD.width * this.board.aspect;
  }

  visible(): boolean {
    return this.shown;
  }

  show(auto: boolean): void {
    if (this.shown && !auto) this.auto = false;
    if (this.shown) return;
    this.shown = true;
    this.auto = auto;
    this.mesh.visible = true;
    this.dirty = true;
  }

  hide(): void {
    this.shown = false;
    this.auto = false;
    this.mesh.visible = false;
    this.held.left = this.held.right = null;
  }

  private rebuild() {
    this.board = boardFor(this.layer, this.shift || this.caps, this.terminal);
    this.canvas.width = W;
    this.canvas.height = Math.round(W * this.board.aspect);
    this.texture.dispose();
    this.texture.needsUpdate = true;
    this.mesh.scale.set(KEYBOARD.width, this.height, 1);
    this.hover.left = this.hover.right = null;
    this.dirty = true;
  }

  point(kind: 'move' | 'down' | 'up' | 'leave', uv: THREE.Vector2, hand: Hand): void {
    const k = kind === 'leave' ? null : keyAt(this.board, uv.x, uv.y);
    if (k !== this.hover[hand]) {
      this.hover[hand] = k;
      this.dirty = true;
    }
    if (kind === 'down' && k) {
      this.held[hand] = { key: k, next: performance.now() + REPEAT.after };
      this.dirty = true;
      this.press(k.key);
    } else if (kind === 'up' || kind === 'leave' || (this.held[hand] && this.held[hand]!.key !== k)) {
      if (this.held[hand]) this.dirty = true;
      this.held[hand] = null;
    }
  }

  /** Each frame: a held ⌫ or arrow repeats, the terminal row comes and goes with the focus, and it's drawn again if anything changed. */
  update(now: number): void {
    if (!this.shown) return;
    const term = !!focusedElement()?.closest('.xterm');
    if (term !== this.terminal) {
      this.terminal = term;
      this.rebuild();
    }
    for (const hand of ['left', 'right'] as const) {
      const h = this.held[hand];
      if (h && repeats(h.key.key) && now >= h.next) {
        h.next = now + REPEAT.every;
        this.press(h.key.key);
      }
    }
    if (this.dirty) this.draw();
  }

  /** What a key does. */
  private press(k: KeyDef) {
    const ctrl = this.ctrl;
    switch (k.act) {
      case 'char': {
        const text = k.text ?? '';
        const c = codeOfChar(text);
        if (ctrl && c) tapKey(c.code, { ctrl: true, shift: c.shift });
        else if (!typeText(text) && c) tapKey(c.code, { shift: c.shift });
        if (this.shift && !this.caps) {
          this.shift = false;
          this.rebuild();
        }
        break;
      }
      case 'space':
        if (ctrl || !typeText(' ')) tapKey('Space', { ctrl });
        break;
      case 'back':
        tapKey('Backspace', { ctrl });
        break;
      case 'enter':
        tapKey('Enter', { ctrl });
        break;
      case 'key':
        if (k.code) tapKey(k.code, { ctrl, shift: this.shift });
        break;
      case 'shift': {
        const now = performance.now();
        if (this.caps) this.caps = this.shift = false;
        else if (this.shift && now - this.shiftAt < 400) this.caps = true;
        else this.shift = !this.shift;
        this.shiftAt = now;
        this.rebuild();
        return;
      }
      case 'layer':
        this.layer = this.layer === 'letters' ? 'symbols' : 'letters';
        this.shift = this.caps = false;
        this.rebuild();
        return;
      case 'ctrl':
        this.ctrl = !this.ctrl;
        this.dirty = true;
        return;
      case 'mic':
        this.mic();
        break;
      case 'hide':
        this.hide();
        return;
    }
    if (ctrl) {
      this.ctrl = false;
      this.dirty = true;
    }
  }

  /** The focused field's own 🎤 (pressed as from the keyboard: on, or off). */
  private mic() {
    const field = focusedElement();
    for (let e: Element | null = field; e; e = e.parentElement) {
      const b = e.querySelector<HTMLButtonElement>('.dictate-mic');
      if (b) return b.click();
      if (e.classList.contains('backdrop')) break;
    }
  }

  private draw() {
    this.dirty = false;
    const g = this.g;
    const { width, height } = this.canvas;
    g.clearRect(0, 0, width, height);
    g.fillStyle = 'rgba(28, 28, 30, .94)';
    g.beginPath();
    g.roundRect(0, 0, width, height, 36);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.14)';
    g.lineWidth = 2;
    g.stroke();
    const held = new Set([this.held.left?.key, this.held.right?.key]);
    const hover = new Set([this.hover.left, this.hover.right]);
    for (const p of this.board.keys) {
      const k = p.key;
      const x = p.x * width;
      const y = p.y * height;
      const w = p.w * width;
      const h = p.h * height;
      const on = (k.act === 'shift' && (this.shift || this.caps)) || (k.act === 'ctrl' && this.ctrl);
      const special = k.act !== 'char' && k.act !== 'space';
      g.fillStyle = held.has(p) || on ? '#0071e3' : hover.has(p) ? 'rgba(255,255,255,.34)' : special ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.2)';
      g.beginPath();
      g.roundRect(x, y, w, h, 14);
      g.fill();
      g.fillStyle = '#fff';
      const label = k.act === 'shift' && this.caps ? '⇪' : k.label;
      g.font = `${special ? 500 : 400} ${label.length > 2 ? 30 : 42}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x + w / 2, y + h / 2 + 2, w - 12);
    }
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.hide();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
