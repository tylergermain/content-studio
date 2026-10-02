import * as THREE from 'three';
import { unseen, type BoardSetup, type Post, type StudioBoard, type StudioState } from '../../../shared/studio';
import { NOTE_COLORS, PINS, wrap } from '../boards/world';

// A floor's own bulletin board (see shared/studio.ts), drawn the way the Issues board is: notes pinned
// to cork, the newest first, with a count of what's gone up since anyone last looked.

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const COLS = 4;
const ROWS = 2;

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export class BulletinTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;

  constructor(private board: StudioBoard) {
    this.canvas.width = 1200;
    this.canvas.height = 600;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  render(studio: StudioState, why?: string) {
    const setup = studio.setup.boards[this.board];
    if (!setup) return;
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#d8a86a';
    g.fillRect(0, 0, W, H);
    // cork speckles
    let seed = this.board === 'issues' ? 11 : 23;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(120,70,30,.18)' : 'rgba(255,240,210,.18)';
      g.fillRect(rnd() * W, rnd() * H, 3, 3);
    }
    const posts = studio.posts.filter((p) => p.board === this.board);
    if (!posts.length) this.empty(setup, why);
    else posts.slice(0, COLS * ROWS).forEach((p, i) => this.note(p, i, rnd, p.at > (studio.seen[this.board] ?? 0) && setup.feed?.kind !== 'metricool'));
    const fresh = setup.feed?.kind === 'metricool' ? 0 : unseen(studio, this.board);
    if (fresh) this.badge(fresh);
    this.texture.needsUpdate = true;
  }

  private empty(setup: BoardSetup, why?: string) {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const text = why ?? (setup.feed?.kind === 'slack' ? 'Nothing in the channels yet' : setup.feed?.kind === 'metricool' ? 'Waiting for the numbers…' : `Nothing posted yet. ${setup.about}`);
    g.font = `800 38px ${FONT}`;
    const lines = wrap(g, text, 760, 4);
    const boxH = 60 + lines.length * 50;
    g.fillStyle = '#fffaf3';
    g.fillRect(W / 2 - 420, H / 2 - boxH / 2, 840, boxH);
    g.fillStyle = '#2b2d42';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => g.fillText(line, W / 2, H / 2 - ((lines.length - 1) * 50) / 2 + i * 50));
  }

  private note(p: Post, i: number, rnd: () => number, fresh: boolean) {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const w = 262;
    const h = 250;
    const x = 34 + (i % COLS) * ((W - 68 - w) / (COLS - 1)) + w / 2;
    const y = 36 + Math.floor(i / COLS) * (H - 72 - h) + h / 2;
    g.save();
    g.translate(x, y);
    g.rotate((rnd() - 0.5) * 0.07);
    g.fillStyle = 'rgba(60,35,10,.28)';
    g.fillRect(-w / 2 + 5, -h / 2 + 7, w, h);
    g.fillStyle = NOTE_COLORS[i % NOTE_COLORS.length];
    g.fillRect(-w / 2, -h / 2, w, h);
    if (fresh) {
      g.strokeStyle = '#ef476f';
      g.lineWidth = 6;
      g.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
    }
    g.fillStyle = PINS[i % PINS.length];
    g.beginPath();
    g.arc(0, -h / 2 + 14, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2d42';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `800 23px ${FONT}`;
    const title = wrap(g, p.title, w - 30, p.body ? 4 : 6);
    title.forEach((line, n) => g.fillText(line, -w / 2 + 15, -h / 2 + 32 + n * 28));
    if (p.body) {
      g.font = `600 17px ${FONT}`;
      g.fillStyle = '#4a4e69';
      wrap(g, p.body, w - 30, 2).forEach((line, n) => g.fillText(line, -w / 2 + 15, -h / 2 + 40 + title.length * 28 + n * 22));
    }
    g.font = `700 16px ${FONT}`;
    g.fillStyle = '#6b5b45';
    g.textBaseline = 'bottom';
    const foot = [p.source, ago(p.at)].filter(Boolean).join(' · ');
    g.fillText(wrap(g, foot, w - 30, 1)[0] ?? '', -w / 2 + 15, h / 2 - 12);
    g.restore();
  }

  /** How many are new, top right: what the wall shows when there's something to come and look at. */
  private badge(n: number) {
    const g = this.g;
    const text = `🔔 ${n} new`;
    g.font = `900 34px ${FONT}`;
    const w = g.measureText(text).width + 44;
    const x = this.canvas.width - w - 18;
    g.fillStyle = '#ef476f';
    g.beginPath();
    g.roundRect(x, 14, w, 56, 28);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + w / 2, 44);
  }
}
