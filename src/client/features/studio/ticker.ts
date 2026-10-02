import * as THREE from 'three';
import { FLOOR } from '../../../shared/layout';
import type { Quote, TickerState } from '../../../shared/studio';

// The ticker round the walls: a band of lit letters up over the boards, the market's prices sliding
// along it from wall to wall, all the way round the room (see TickerSetup in shared/studio.ts).

/** How high its middle is, how tall it is, how far off the wall it hangs, and how fast it slides (m/s). */
const BAND = { y: 4.75, height: 0.44, off: 0.07, speed: 1.1 } as const;
const PX = 128;
const FONT = (weight: number) => `${weight} 78px 'SF Mono', ui-monospace, Menlo, Consolas, monospace`;
const COLORS = { bg: '#0a0d12', text: '#f4f6f8', up: '#2ee58a', down: '#ff5d6c', dim: '#6f7b8a' } as const;

const price = (n: number) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2));

/** The walls in the order the band goes round them (as you'd read it, left to right): each one's start, the way it runs, and how it's turned to face the room. */
const WALLS = [
  { len: FLOOR.maxX - FLOOR.minX, at: [(FLOOR.minX + FLOOR.maxX) / 2, FLOOR.minZ + BAND.off], rotY: 0 },
  { len: FLOOR.maxZ - FLOOR.minZ, at: [FLOOR.maxX - BAND.off, (FLOOR.minZ + FLOOR.maxZ) / 2], rotY: -Math.PI / 2 },
  { len: FLOOR.maxX - FLOOR.minX, at: [(FLOOR.minX + FLOOR.maxX) / 2, FLOOR.maxZ - BAND.off], rotY: Math.PI },
  { len: FLOOR.maxZ - FLOOR.minZ, at: [FLOOR.minX + BAND.off, (FLOOR.minZ + FLOOR.maxZ) / 2], rotY: Math.PI / 2 },
] as const;

export class TickerBand {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private planes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  /** How many meters of wall one pass of the prices covers. */
  private span = 1;
  private shown = '';

  constructor() {
    this.canvas.width = 2048;
    this.canvas.height = PX;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    // Nothing flat gets the toon outline (see core/outline.ts).
    mat.userData.outlineParameters = { visible: false };
    for (const w of WALLS) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w.len, BAND.height), mat);
      plane.position.set(w.at[0], BAND.y, w.at[1]);
      plane.rotation.y = w.rotY;
      this.planes.push(plane);
      this.group.add(plane);
    }
    this.group.visible = false;
  }

  /** Puts these prices on the band, or takes the band down when the floor has no ticker. */
  set(state: TickerState) {
    this.group.visible = state.quotes.length > 0;
    const key = JSON.stringify(state.quotes);
    if (!state.quotes.length || key === this.shown) return;
    this.shown = key;
    this.paint(state.quotes);
  }

  private paint(quotes: Quote[]) {
    const g = this.canvas.getContext('2d')!;
    const gap = 110;
    const parts = quotes.map((q) => {
      const up = q.change >= 0;
      return { symbol: q.symbol.replace(/^\^/, ''), price: price(q.price), move: `${up ? '▲' : '▼'} ${Math.abs(q.pct).toFixed(2)}%`, color: up ? COLORS.up : COLORS.down };
    });
    const widthOf = (text: string, weight: number) => {
      g.font = FONT(weight);
      return g.measureText(text).width;
    };
    const widths = parts.map((p) => widthOf(p.symbol, 800) + 26 + widthOf(p.price, 500) + 26 + widthOf(p.move, 700) + gap);
    // One pass of every price is what repeats round the room, so the band never has a seam.
    let total = widths.reduce((a, b) => a + b, 0);
    const scale = Math.min(1, 8192 / total);
    total = Math.max(256, Math.round(total * scale));
    this.canvas.width = total;
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, total, PX);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.setTransform(scale, 0, 0, 1, 0, 0);
    let x = gap / 2;
    parts.forEach((p, i) => {
      const y = PX / 2 + 4;
      g.font = FONT(800);
      g.fillStyle = COLORS.text;
      g.fillText(p.symbol, x, y);
      let at = x + g.measureText(p.symbol).width + 26;
      g.font = FONT(500);
      g.fillText(p.price, at, y);
      at += g.measureText(p.price).width + 26;
      g.font = FONT(700);
      g.fillStyle = p.color;
      g.fillText(p.move, at, y);
      g.fillStyle = COLORS.dim;
      g.fillRect(x + widths[i] - gap / 2 - 3, PX / 2 - 22, 6, 44);
      x += widths[i];
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.anisotropy = 8;
    this.span = (total / PX) * BAND.height;
    // Each wall carries on where the last one stopped.
    let start = 0;
    this.planes.forEach((plane, i) => {
      plane.material.map = this.texture;
      plane.material.needsUpdate = true;
      const uv = plane.geometry.attributes.uv;
      const len = WALLS[i].len;
      for (let v = 0; v < uv.count; v++) uv.setX(v, (start + (plane.geometry.attributes.position.getX(v) / len + 0.5) * len) / this.span);
      uv.needsUpdate = true;
      start += len;
    });
  }

  update(dt: number) {
    if (this.group.visible) this.texture.offset.x = (this.texture.offset.x + (dt * BAND.speed) / this.span) % 1;
  }
}
