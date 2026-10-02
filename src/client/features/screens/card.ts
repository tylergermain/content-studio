/**
 * What a video screen shows while it has nothing to play: a card saying where the floor's videos go,
 * or which of them wouldn't play here. Drawn once and shared by every screen on the floor.
 */
import * as THREE from 'three';
import { wrapPath } from './playlist';

const W = 1280;
const H = 720;
const SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

interface Card {
  title: string;
  /** What's said under the title, over the boxed lines. */
  lead: string;
  /** The lines in the box (a folder's path, files' names), in a typewriter face. */
  boxed: string[];
  foot: string;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function draw(card: Card): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#14161d');
  grad.addColorStop(1, '#26304a');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // A soft light behind the play button, as a screen that's on has.
  const glow = g.createRadialGradient(W / 2, 150, 10, W / 2, 150, 460);
  glow.addColorStop(0, 'rgba(10, 132, 255, .38)');
  glow.addColorStop(1, 'rgba(10, 132, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // The play button.
  g.fillStyle = 'rgba(255, 255, 255, .14)';
  roundRect(g, W / 2 - 58, 74, 116, 116, 30);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(W / 2 - 18, 106);
  g.lineTo(W / 2 + 30, 132);
  g.lineTo(W / 2 - 18, 158);
  g.closePath();
  g.fill();

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `700 62px ${SANS}`;
  g.fillText(card.title, W / 2, 262, W - 160);
  g.fillStyle = 'rgba(235, 235, 245, .72)';
  g.font = `500 34px ${SANS}`;
  g.fillText(card.lead, W / 2, 334, W - 160);

  // The boxed lines: as big as fits the box's width and height.
  const lines = card.boxed.slice(0, 6);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const size = Math.max(18, Math.min(34, Math.floor((W - 240) / (longest * 0.61)), Math.floor(200 / (lines.length * 1.35))));
  const pitch = size * 1.35;
  const boxH = lines.length * pitch + 40;
  const boxY = 384;
  g.fillStyle = 'rgba(255, 255, 255, .09)';
  roundRect(g, 90, boxY, W - 180, boxH, 22);
  g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, .16)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `600 ${size}px ${MONO}`;
  lines.forEach((line, i) => g.fillText(line, W / 2, boxY + 20 + pitch * (i + 0.5), W - 220));

  g.fillStyle = 'rgba(235, 235, 245, .55)';
  g.font = `500 28px ${SANS}`;
  g.fillText(card.foot, W / 2, H - 52, W - 160);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Nothing in the floor's media folder yet: where to put videos. */
export function idleCard(folder: string): THREE.CanvasTexture {
  return draw({ title: 'Nothing to play yet', lead: 'Drop videos in', boxed: wrapPath(folder, 54), foot: 'MP4 or WebM · they loop here, a different one on each screen' });
}

/** There are files, but none of them plays in this browser. */
export function troubleCard(names: readonly string[], folder: string): THREE.CanvasTexture {
  const shown = names.slice(0, 4);
  if (names.length > shown.length) shown.push(`and ${names.length - shown.length} more`);
  return draw({ title: 'These won’t play here', lead: 'This browser can’t play', boxed: shown, foot: `Save them as MP4 (H.264) in ${folder.split(/[\\/]/).slice(-3).join('/')}` });
}
