import { PARK, PLOTS, PLOT_IDS, PUTT, PUTT_CELLS, type PlotId } from '../../../shared/mainstreet';
import { ROAD } from '../../../shared/layout';
import type { BusinessCard } from '../../../shared/protocol';
import { FONT, GREEN, INK, inkOn } from './kit';

// The map of Main Street on the board in Friday Park (see park.ts): the street across the middle,
// Friday Tower and the plots either side of it, the park and Putt Street, and who has each plot that
// isn't for lease, as store.street has it. It's drawn as you see it standing at the board, looking
// over it into the park: the park side up, west on the right. Only a 2D canvas: nothing of three.js.

/** How the map's drawn: the street frame's x and z onto the board's px, the park side up. */
interface Plan {
  x(x: number): number;
  y(z: number): number;
  /** Meters to px. */
  k: number;
}

/** The map's part of the street: every plot, and a little round them. */
const SPAN = { minX: -84, maxX: 84, minZ: -29, maxZ: 83 } as const;

/** Paints the map onto `g`, `W` by `H` px, with `cards` on their plots. */
export function paintStreetMap(g: CanvasRenderingContext2D, W: number, H: number, cards: readonly BusinessCard[]) {
  const head = H * 0.13;
  g.fillStyle = '#fffaf3';
  g.fillRect(0, 0, W, H);
  // The title bar.
  g.fillStyle = INK;
  g.fillRect(0, 0, W, head);
  g.fillStyle = '#fffaf3';
  g.font = `800 ${head * 0.52}px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('MAIN STREET', W * 0.03, head / 2);
  g.textAlign = 'right';
  g.fillStyle = GREEN;
  g.font = `700 ${head * 0.32}px ${FONT}`;
  g.fillText("who's where · E to see more", W * 0.97, head / 2);

  const pad = W * 0.03;
  const k = Math.min((W - 2 * pad) / (SPAN.maxX - SPAN.minX), (H - head - 2 * pad) / (SPAN.maxZ - SPAN.minZ));
  const ox = (W - k * (SPAN.maxX - SPAN.minX)) / 2;
  const oy = head + (H - head - k * (SPAN.maxZ - SPAN.minZ)) / 2;
  // Looking south from the board: +z (the park) up the map, and -x (west) on the right.
  const p: Plan = { x: (x) => ox + (SPAN.maxX - x) * k, y: (z) => oy + (SPAN.maxZ - z) * k, k };
  const rect = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => [p.x(b.maxX), p.y(b.maxZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k] as const;

  // Grass, the street and its sidewalks.
  g.fillStyle = '#cfe8bf';
  g.fillRect(...rect(SPAN));
  g.fillStyle = '#e3ddd0';
  g.fillRect(...rect({ minX: SPAN.minX, maxX: SPAN.maxX, minZ: ROAD.minZ - 2, maxZ: ROAD.maxZ + 2 }));
  g.fillStyle = '#5b606c';
  g.fillRect(...rect({ minX: SPAN.minX, maxX: SPAN.maxX, minZ: ROAD.minZ, maxZ: ROAD.maxZ }));
  g.fillStyle = '#ffd166';
  for (let x = SPAN.minX; x < SPAN.maxX; x += 8) g.fillRect(p.x(x + 4), p.y((ROAD.minZ + ROAD.maxZ) / 2) - k * 0.15, k * 4, k * 0.3);

  const byPlot = new Map(cards.map((c) => [c.plot as PlotId, c]));
  /** `lines` in the middle of `b`, the first big; on a pill of `back` when it's given. */
  const label = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, lines: string[], color: string, back?: string) => {
    const cx = p.x((b.minX + b.maxX) / 2);
    const cy = p.y((b.minZ + b.maxZ) / 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = k * 5.2;
    if (back) {
      g.fillStyle = back;
      const h = size * (1.15 * lines.length + 0.5);
      g.beginPath();
      g.roundRect(cx - (b.maxX - b.minX) * k * 0.46, cy - h / 2, (b.maxX - b.minX) * k * 0.92, h, h * 0.3);
      g.fill();
    }
    g.fillStyle = color;
    lines.forEach((line, i) => {
      g.font = `${i ? 600 : 800} ${i ? size * 0.62 : size}px ${FONT}`;
      const w = g.measureText(line).width;
      const fit = Math.min(1, ((b.maxX - b.minX) * k * 0.9) / w);
      g.save();
      g.translate(cx, cy + (i - (lines.length - 1) / 2) * size * 1.15);
      g.scale(fit, 1);
      g.fillText(line, 0, 0);
      g.restore();
    });
  };

  for (const id of PLOT_IDS) {
    const plot = PLOTS[id];
    const b = plot.box;
    if (id === 'P1') {
      g.fillStyle = '#23252f';
      g.fillRect(...rect(b));
      g.fillStyle = GREEN;
      g.fillRect(p.x(b.maxX), p.y(b.maxZ), (b.maxX - b.minX) * k, k * 3);
      label(b, ['FRIDAY TOWER', 'Friday Labs'], '#fffaf3');
      continue;
    }
    if (id === 'P5') {
      g.fillStyle = '#a7d98b';
      g.fillRect(...rect(b));
      // Golf's green, and Friday One's pad.
      g.fillStyle = '#9be07a';
      g.beginPath();
      g.arc(p.x(-5), p.y(58), 6 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c9c6bf';
      g.beginPath();
      g.arc(p.x(PARK.pad.x), p.y(PARK.pad.z), PARK.pad.r * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK;
      g.font = `800 ${k * 6}px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('H', p.x(PARK.pad.x), p.y(PARK.pad.z) + k * 0.3);
      // Up the park from the board, clear of YOU ARE HERE.
      label({ ...b, minZ: b.minZ + 12, maxZ: b.minZ + 26 }, ['FRIDAY PARK', 'golf · Friday One'], INK);
      continue;
    }
    if (id === 'P6') {
      g.fillStyle = PUTT.gravel;
      g.fillRect(...rect(b));
      g.fillStyle = PUTT.felt;
      for (const c of PUTT_CELLS) g.fillRect(p.x(c.x + 4.4), p.y(c.z + 4.4), 8.8 * k, 8.8 * k);
      label({ ...b, minZ: b.minZ + 12, maxZ: b.minZ + 32 }, ['PUTT STREET', '9 holes · mini golf'], INK, 'rgba(255, 250, 243, 0.88)');
      continue;
    }
    const card = byPlot.get(id);
    if (!card) {
      // For lease: a dashed outline round the lot.
      g.setLineDash([k * 2.4, k * 1.6]);
      g.strokeStyle = INK;
      g.lineWidth = Math.max(2, k * 0.6);
      g.strokeRect(...rect({ minX: b.minX + 1, maxX: b.maxX - 1, minZ: b.minZ + 1, maxZ: b.maxZ - 1 }));
      g.setLineDash([]);
      label(b, [plot.name.toUpperCase(), 'For lease'], INK);
      continue;
    }
    g.fillStyle = card.accent;
    g.fillRect(...rect({ minX: b.minX + 3, maxX: b.maxX - 3, minZ: b.minZ + 3, maxZ: b.maxZ - 3 }));
    const n = card.storeys.length;
    label(b, [card.name, card.stage === 'site' ? 'Coming soon' : `${n} ${n === 1 ? 'storey' : 'storeys'} · opening soon`], inkOn(card.accent));
  }

  // You are here: at the board.
  const hx = p.x(PARK.board.x);
  const hy = p.y(PARK.board.z);
  g.fillStyle = '#ef476f';
  g.beginPath();
  g.arc(hx, hy, k * 2.2, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(2, k * 0.5);
  g.strokeStyle = '#fffaf3';
  g.stroke();
  g.fillStyle = INK;
  g.font = `800 ${k * 3}px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('YOU ARE HERE', hx, hy - k * 4.2);
}
