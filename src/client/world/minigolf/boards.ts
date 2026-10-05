import * as THREE from 'three';
import { HOLES, PAR } from '../../../shared/minigolf/course';
import { PUTT_RULES, type PuttBoard, type PuttRound } from '../../../shared/protocol';
import { clockText, parText, toPar, totalOf } from '../../features/minigolf/play';
import { mesh, toon } from '../toon';

// Putt Street's two boards, painted on canvases from what the office says: the live scorecard on the
// kiosk (every round going on, who's on which hole and how they stand) and the record board facing
// the street (the course record, the best on each hole, the holes in one and the last few rounds).

const INK = '#2b2d42';
const PAPER = '#fffaf3';
const GREEN = '#2fbf71';
const MUTED = '#8d99ae';
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const PARS = HOLES.map((h) => h.par);

/** A board: a canvas on a framed panel `w` by `h` meters, facing +z, its bottom edge at y 0. */
export class PaintedBoard {
  readonly group = new THREE.Group();
  readonly canvas: HTMLCanvasElement;
  private readonly tex: THREE.CanvasTexture;

  constructor(w: number, h: number, px = 1024) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = Math.round((px * h) / w);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    face.position.set(0, h / 2, 0.026);
    this.group.add(face);
    this.group.add(mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.05), toon(INK), 0, h / 2, 0));
  }

  /** Paints it again with `draw`. */
  paint(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const g = this.canvas.getContext('2d')!;
    draw(g, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = INK, weight = 800, align: CanvasTextAlign = 'left') {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** Cut to `max` characters. */
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The board's paper and its green header strip, titled `title`. */
function paper(g: CanvasRenderingContext2D, w: number, h: number, title: string) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.fillStyle = GREEN;
  g.fillRect(0, 0, w, 86);
  text(g, title, w / 2, 45, 50, PAPER, 900, 'center');
}

/**
 * The kiosk's live scorecard: each round going on (at most the three newest), its players with their
 * strokes hole by hole and their total, the hole it's on picked out; or, with none, how to start one.
 */
export function paintRounds(g: CanvasRenderingContext2D, w: number, h: number, rounds: readonly PuttRound[], now: number) {
  paper(g, w, h, '⛳ NOW PLAYING');
  const on = rounds.filter((r) => r.stage !== 'over').slice(-3);
  if (!on.length) {
    text(g, 'Nobody’s out on the course.', w / 2, h / 2 - 30, 44, INK, 800, 'center');
    text(g, `Pick up a putter at the rack below · up to ${PUTT_RULES.players} a group · par ${PAR}`, w / 2, h / 2 + 34, 30, MUTED, 700, 'center');
    return;
  }
  const left = 24;
  const nameW = 250;
  const col = (w - left * 2 - nameW - 90) / 9;
  let y = 120;
  // The holes across the top, with their pars under them.
  for (let i = 0; i < 9; i++) {
    text(g, String(i + 1), left + nameW + col * (i + 0.5), y, 32, INK, 900, 'center');
    text(g, String(PARS[i]), left + nameW + col * (i + 0.5), y + 34, 26, MUTED, 700, 'center');
  }
  text(g, 'Tot', w - left - 45, y, 32, INK, 900, 'center');
  text(g, 'Par', left, y + 34, 26, MUTED, 700);
  y += 66;
  const rows = on.reduce((n, r) => n + r.players.length + 1, 0);
  const lh = Math.min(66, (h - y - 10) / Math.max(1, rows));
  for (const r of on) {
    const head =
      r.stage === 'forming'
        ? `Group forming · tees off in ${clockText(r.until - now)}`
        : r.waiting
          ? `Hole ${r.hole + 1} · waiting for the group ahead`
          : `Hole ${r.hole + 1} · ${cut(r.players[r.turn]?.name ?? '', 16)} to putt`;
    text(g, head, left, y + lh / 2, Math.min(34, lh * 0.56), GREEN, 900);
    y += lh;
    for (const p of r.players) {
      if (r.stage === 'playing') {
        g.fillStyle = 'rgba(47,191,113,.12)';
        g.fillRect(left + nameW + col * r.hole, y + 2, col, lh - 4);
      }
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(left + 10, y + lh / 2, Math.min(9, lh * 0.22), 0, Math.PI * 2);
      g.fill();
      text(g, cut(p.name, 10), left + 28, y + lh / 2, Math.min(38, lh * 0.6), INK, 800);
      p.strokes.forEach((s, i) => {
        if (typeof s === 'number') text(g, String(s), left + nameW + col * (i + 0.5), y + lh / 2, Math.min(38, lh * 0.6), s < PARS[i] ? GREEN : INK, 800, 'center');
      });
      const diff = toPar(p, PARS);
      text(g, `${totalOf(p)} (${parText(diff)})`, w - left - 45, y + lh / 2, Math.min(30, lh * 0.5), INK, 800, 'center');
      y += lh;
    }
  }
}

/** When, as the record board says it: today, yesterday, or the day. */
function dayOf(at: number, now: number): string {
  const d = new Date(at);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The record board: the course record big at the top, the best on each hole in a row under it, then
 * the holes in one and the last few rounds side by side. `fresh` picks out what just changed.
 */
export function paintRecords(g: CanvasRenderingContext2D, w: number, h: number, board: PuttBoard, now: number, fresh?: { what: string; hole?: number } | null) {
  paper(g, w, h, '🏆 PUTT STREET RECORDS');
  const rec = board.record;
  if (fresh?.what === 'record') {
    g.fillStyle = 'rgba(255,209,102,.45)';
    g.fillRect(16, 100, w - 32, 120);
  }
  text(g, 'Course record', w / 2, 128, 28, MUTED, 800, 'center');
  text(g, rec ? `${rec.total} · ${cut(rec.name, 18)} · ${dayOf(rec.at, now)}` : `Nobody’s gone round yet · par ${PAR}`, w / 2, 180, rec ? 54 : 40, INK, 900, 'center');

  // The best on each hole.
  const top = 250;
  const col = (w - 40) / 9;
  text(g, 'Best on each hole', 20, top, 26, MUTED, 800);
  board.best.slice(0, 9).forEach((b, i) => {
    const x = 20 + col * (i + 0.5);
    if (fresh?.what === 'best' && fresh.hole === i) {
      g.fillStyle = 'rgba(255,209,102,.45)';
      g.fillRect(20 + col * i, top + 20, col, 110);
    }
    text(g, String(i + 1), x, top + 42, 24, MUTED, 900, 'center');
    text(g, b ? String(b.strokes) : '–', x, top + 80, 40, b && b.strokes === 1 ? GREEN : INK, 900, 'center');
    if (b) text(g, cut(b.name, 8), x, top + 114, 18, MUTED, 700, 'center');
  });

  // Holes in one on the left, the last rounds on the right.
  const y0 = top + 160;
  text(g, '⭐ Holes in one', 20, y0, 26, MUTED, 800);
  text(g, 'Last rounds', w / 2 + 10, y0, 26, MUTED, 800);
  const lh = 34;
  const room = Math.max(1, Math.floor((h - y0 - 30) / lh));
  const aces = board.aces.slice(-room).reverse();
  if (!aces.length) text(g, 'None yet: be the first.', 20, y0 + lh, 24, INK, 700);
  aces.forEach((a, i) => text(g, cut(`${a.name} · hole ${a.hole + 1} · ${dayOf(a.at, now)}`, 34), 20, y0 + lh * (i + 1), 24, INK, 700));
  const last = board.rounds.slice(0, room);
  if (!last.length) text(g, 'No rounds played yet.', w / 2 + 10, y0 + lh, 24, INK, 700);
  last.forEach((r, i) => {
    const best = r.totals.length ? Math.min(...r.totals) : 0;
    const who = r.names.map((n, j) => `${cut(n, 10)} ${r.totals[j]}`).join(', ');
    text(g, cut(`${dayOf(r.at, now)}: ${who}`, 40), w / 2 + 10, y0 + lh * (i + 1), 24, r.totals.includes(best) ? INK : MUTED, 700);
  });
  g.strokeStyle = 'rgba(43,45,66,.15)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w / 2, y0 - 16);
  g.lineTo(w / 2, h - 16);
  g.stroke();
}
