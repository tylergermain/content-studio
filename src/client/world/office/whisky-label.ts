import * as THREE from 'three';

// The Macallan Litha's label, drawn by hand on a canvas for the whisky cabinet's bottle (see
// furniture-whisky.ts): a cream label in a fine gold rule, the distillery's house drawn in sepia line
// over "EST. 1824", "The" in italic, MACALLAN in wide serif capitals, the Highland line under it,
// LITHA in black brushstrokes, and the casks it was matured in. And the crest on the bottle's shoulder:
// 1824 in gold on a navy triangle in a cream chevron. The box's front has the same label on it, and
// the bottle's has the Litha's artwork round the glass either side of it (both in whisky-art.ts). Our
// own rendition, so anyone who knows the bottle knows it, drawn rather than copied.

/** The label's serif: the distillery's capitals are a high-contrast one, which Bodoni and Didot are. */
export const SERIF = "'Bodoni 72', Didot, 'Bodoni MT', Georgia, 'Times New Roman', serif";
const INK = '#221b16';
const SEPIA = '#5b4634';
const GREY = '#6e6157';
export const GOLD = '#b8975a';
const CREAM = '#f7f2e8';

type C = CanvasRenderingContext2D;

/** Text centred on x, shrunk to fit `most` pixels across if it's wider. */
function centred(c: C, text: string, x: number, y: number, font: string, color: string, spacing = 0, most = Infinity) {
  c.font = font;
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  (c as C & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  const w = c.measureText(text).width;
  c.save();
  c.translate(x, y);
  if (w > most) c.scale(most / w, 1);
  // Letter spacing adds a space after the last letter too: half of it back keeps the text centred.
  c.fillText(text, spacing / 2, 0);
  c.restore();
  (c as C & { letterSpacing: string }).letterSpacing = '0px';
}

/**
 * One brushstroke along the curve through `pts`, `w` wide:
 * it lands heavy, swells a little and lifts off to a point, the way an inked brush does.
 */
export function stroke(c: CanvasRenderingContext2D, pts: [number, number][], w: number, lift = 0.35) {
  // A smooth curve through every point (Catmull-Rom), sampled finely.
  const smooth: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(pts.length - 1, i + 2)]];
    for (let k = i ? 1 : 0; k <= 16; k++) {
      const t = k / 16;
      const at = (j: 0 | 1) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t * t * t);
      smooth.push([at(0), at(1)]);
    }
  }
  const n = smooth.length;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [px, py] = smooth[i];
    const [qx, qy] = smooth[Math.min(n - 1, i + 1)];
    const [ox, oy] = smooth[Math.max(0, i - 1)];
    let dx = qx - ox;
    let dy = qy - oy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Heavy where it lands, a little fuller through the middle, tapering off as the brush lifts.
    const press = t < 0.12 ? 0.75 + 0.25 * (t / 0.12) : t > 1 - lift ? Math.max(0.08, (1 - t) / lift) : 1 + 0.08 * Math.sin(t * Math.PI);
    const half = (w / 2) * press;
    left.push([px - dy * half, py + dx * half]);
    right.push([px + dy * half, py - dx * half]);
  }
  c.beginPath();
  c.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) c.lineTo(x, y);
  for (const [x, y] of right.reverse()) c.lineTo(x, y);
  c.closePath();
  c.fill();
  // The brush's first touch: a rounded blot where it lands.
  c.beginPath();
  c.ellipse(smooth[0][0], smooth[0][1], w * 0.42, w * 0.36, 0.5, 0, Math.PI * 2);
  c.fill();
}

/** LITHA in black brushstrokes, its letters `h` tall from the top-left corner (x, y): about 3.3h across. */
export function litha(c: C, x: number, y: number, h: number, color = INK) {
  const s = h / 100;
  const P = (px: number, py: number): [number, number] => [x + px * s, y + py * s];
  const w = 15 * s;
  c.fillStyle = color;
  // L: a stem dropping into a long sweep along the foot that kicks up at its end.
  stroke(c, [P(22, 6), P(19, 50), P(14, 90)], w, 0.2);
  stroke(c, [P(4, 96), P(40, 88), P(70, 90), P(86, 78)], w * 0.8, 0.5);
  // I.
  stroke(c, [P(104, 10), P(103, 52), P(100, 94)], w * 0.95);
  // T: the bar rising to the right, the stem under it.
  stroke(c, [P(118, 14), P(150, 9), P(184, 4)], w * 0.8, 0.45);
  stroke(c, [P(152, 14), P(151, 56), P(147, 98)], w);
  // H: two stems and a bar that climbs between them.
  stroke(c, [P(198, 8), P(197, 52), P(194, 96)], w);
  stroke(c, [P(244, 6), P(243, 50), P(240, 96)], w);
  stroke(c, [P(196, 56), P(222, 50), P(246, 44)], w * 0.7, 0.5);
  // A: up to a sharp peak and down, its bar a single flick.
  stroke(c, [P(258, 98), P(274, 52), P(292, 6)], w * 0.9, 0.15);
  stroke(c, [P(292, 6), P(306, 52), P(326, 98)], w, 0.35);
  stroke(c, [P(272, 66), P(292, 62), P(310, 58)], w * 0.6, 0.5);
}

/**
 * The distillery's house as a sepia line drawing, `w` across with its middle at (x, y) (its foot): a
 * gabled hall between a round tower with a pointed roof and a lower wing, chimneys and windows.
 */
export function house(c: C, x: number, y: number, w: number, color = SEPIA) {
  const s = w / 100;
  const X = (v: number) => x + (v - 50) * s;
  const Y = (v: number) => y - v * s;
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = Math.max(1, 1.6 * s);
  c.lineJoin = 'round';
  const poly = (pts: [number, number][], close = true) => {
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(X(px), Y(py)) : c.moveTo(X(px), Y(py))));
    if (close) c.closePath();
    c.stroke();
  };
  // The ground it stands on.
  poly([[2, 0], [98, 0]], false);
  // The hall: three storeys under a steep gable, with a chimney at either end.
  poly([[30, 0], [30, 30], [50, 46], [70, 30], [70, 0]]);
  poly([[33, 33], [33, 42], [37, 42], [37, 36]], false);
  poly([[63, 36], [63, 42], [67, 42], [67, 33]], false);
  // The round tower on the left, and its candle-snuffer roof.
  poly([[14, 0], [14, 34], [24, 34], [24, 0]]);
  poly([[12, 34], [19, 50], [26, 34]]);
  // The low wing on the right.
  poly([[70, 0], [70, 20], [92, 20], [92, 0]]);
  poly([[69, 20], [74, 26], [92, 26], [93, 20]], false);
  // Windows: a row on every floor.
  const win = (wx: number, wy: number) => c.fillRect(X(wx) - 1.5 * s, Y(wy) - 2.6 * s, 3 * s, 5.2 * s);
  for (const wy of [7, 17, 27]) for (const wx of [36, 44, 56, 64]) win(wx, wy);
  for (const wy of [9, 21]) win(19, wy);
  for (const wx of [76, 86]) win(wx, 9);
  // The door, under an arch.
  c.beginPath();
  c.arc(X(50), Y(8), 3 * s, Math.PI, 0);
  c.lineTo(X(53), Y(0));
  c.lineTo(X(47), Y(0));
  c.closePath();
  c.fill();
}

/**
 * The label itself, in the box from (x, y) `w` across and `h` down: everything on it scaled to fit
 * (it's laid out on 640 by 626), with the casks' lines and the bottle's size and strength at its foot.
 * `most` is how wide the lettering may run, and `scale` how big it is (1 for a label 640 by 626):
 * round a bottle, what's out at the sides turns away from you, so the words keep to the middle.
 */
export function labelFace(c: C, x: number, y: number, w: number, h: number, opts: { corners?: boolean; most?: number; scale?: number } = {}) {
  const k = opts.scale ?? Math.min(w / 640, h / 626);
  const most = opts.most ?? w * 0.74;
  const mid = x + w / 2;
  c.fillStyle = CREAM;
  c.fillRect(x, y, w, h);
  // A breath of warmth toward the edges, like paper.
  const g = c.createRadialGradient(mid, y + h * 0.45, w * 0.2, mid, y + h * 0.45, w * 0.8);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(214,196,160,0.35)');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // The fine gold rule round it, and a hairline inside it.
  c.strokeStyle = GOLD;
  c.lineWidth = 3 * k;
  c.strokeRect(x + 14 * k, y + 14 * k, w - 28 * k, h - 28 * k);
  c.lineWidth = 1.2 * k;
  c.strokeRect(x + 21 * k, y + 21 * k, w - 42 * k, h - 42 * k);
  const at = (v: number) => y + v * (h / 626);
  house(c, mid, at(98), 150 * k);
  centred(c, 'EST. 1824', mid, at(120), `${13 * k}px ${SERIF}`, SEPIA, 4 * k);
  centred(c, 'The', mid, at(180), `italic ${58 * k}px ${SERIF}`, INK);
  // MACALLAN as wide as it may go, and the registered mark up by its N.
  c.font = `${82 * k}px ${SERIF}`;
  const wordmark = Math.min(most, c.measureText('MACALLAN').width + 14 * k);
  centred(c, 'MACALLAN', mid, at(258), `${82 * k}px ${SERIF}`, INK, 2 * k, wordmark);
  centred(c, '®', mid + wordmark / 2 + 8 * k, at(206), `${15 * k}px ${SERIF}`, INK);
  centred(c, 'HIGHLAND SINGLE MALT', mid, at(296), `${21 * k}px ${SERIF}`, GREY, 3 * k, most);
  centred(c, 'SCOTCH WHISKY', mid, at(322), `${21 * k}px ${SERIF}`, GREY, 3 * k, most);
  // LITHA is 3.3 times as wide as it's tall.
  const lh = Math.min(100 * k, (most * 0.92) / 3.3);
  litha(c, mid - lh * 1.65, at(352) + (100 * k - lh) / 2, lh);
  const small = `${15 * k}px ${SERIF}`;
  ['MATURED IN FIRST FILL', 'SHERRY SEASONED OAK CASKS', 'FROM JEREZ DE LA FRONTERA, SPAIN', 'NATURAL COLOUR'].forEach((line, i) => centred(c, line, mid, at(498 + i * 21), small, '#4a3f36', 1.5 * k, most));
  if (opts.corners !== false) {
    centred(c, '70cl', x + w * 0.27, at(588), `${15 * k}px ${SERIF}`, GREY, 1 * k);
    centred(c, '40% vol', x + w * 0.73, at(588), `${15 * k}px ${SERIF}`, GREY, 1 * k);
  }
}

/** The crest on the shoulder, on a 512 by 256 canvas that's otherwise clear: 1824 on navy, in a cream chevron. */
function crest(c: C) {
  const tri = (pts: [number, number][]) => {
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.closePath();
  };
  // The chevron's wings, out along the shoulder either side.
  c.fillStyle = CREAM;
  tri([[96, 16], [416, 16], [256, 244]]);
  c.fill();
  c.strokeStyle = GOLD;
  c.lineWidth = 4;
  c.stroke();
  c.fillStyle = '#26377a';
  tri([[140, 36], [372, 36], [256, 204]]);
  c.fill();
  c.lineWidth = 2.5;
  c.stroke();
  centred(c, 'EST.', 256, 66, `600 17px ${SERIF}`, '#e6c97e', 3);
  centred(c, '1824', 256, 112, `600 46px ${SERIF}`, '#e6c97e', 2);
  // A small star of the night sky the box's art has on its other side.
  c.fillStyle = '#e6c97e';
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 4 : 10;
    c[i ? 'lineTo' : 'moveTo'](256 + Math.cos(a) * r, 148 + Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
}

/** A canvas `w` by `h` with `draw` on it, as a texture for a surface of the model. */
export function canvasTexture(w: number, h: number, draw: (c: C) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  // The model's UVs are glTF's, whose v runs down the picture: the canvas goes on as it's drawn.
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let crestTex: THREE.CanvasTexture | null = null;

/** The shoulder's crest, drawn once. */
export function crestTexture(): THREE.CanvasTexture {
  return (crestTex ??= canvasTexture(512, 256, crest));
}
