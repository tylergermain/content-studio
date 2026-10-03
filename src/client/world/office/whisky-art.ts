import type * as THREE from 'three';
import { GOLD, canvasTexture, house, insetLabel, labelFace, stroke } from './whisky-label';

// The Macallan Litha's box, as it stands at the end of the whisky cabinet (see furniture-whisky.ts):
// our own painting in the spirit of its artwork, round its left side, its front and its right side
// (one canvas, mapped round the three as the model's whisky_box_art is). Two worlds meeting in a tree:
// Spain warm on the left, in rose and apricot under an orange sun, with a white horse whose red mane
// streams out behind it and berries hanging in the branches; Scotland cool on the right, indigo and
// violet under a crescent moon and stars, with a peacock trailing its tail, blue feathers falling and
// the distillery's house lit up in the hills. The label sits on the front, as the bottle's does. The
// bottle wears the same painting all the way round it (bottleWrap, below).

type C = CanvasRenderingContext2D;

/** The canvas, and where the box's three sides are on it (the model's u: 0.11, 0.13 and 0.11 of 0.35). */
const W = 1024;
const H = 1000;
const FRONT = { x0: (0.11 / 0.35) * W, x1: (0.24 / 0.35) * W };
/** Where the warm half gives way to the cool one, at the top and at the foot: down the trunk, a little right of the front's middle. */
const SPLIT = { top: 590, foot: 560 };

function sky(c: C) {
  const warm = c.createLinearGradient(0, 0, 0, H);
  warm.addColorStop(0, '#b4576b');
  warm.addColorStop(0.45, '#df7b67');
  warm.addColorStop(0.8, '#f2a865');
  c.fillStyle = warm;
  c.fillRect(0, 0, W, H);
  const cool = c.createLinearGradient(0, 0, 0, H);
  cool.addColorStop(0, '#1f2160');
  cool.addColorStop(0.5, '#33317f');
  cool.addColorStop(1, '#202a63');
  c.fillStyle = cool;
  c.beginPath();
  c.moveTo(SPLIT.top, 0);
  c.bezierCurveTo(SPLIT.top - 60, H * 0.35, SPLIT.foot + 70, H * 0.65, SPLIT.foot, H);
  c.lineTo(W, H);
  c.lineTo(W, 0);
  c.closePath();
  c.fill();
  // Stars over Scotland.
  c.fillStyle = '#fff6e0';
  for (let i = 0; i < 70; i++) {
    const x = SPLIT.top + 10 + ((i * 137.5) % (W - SPLIT.top - 20));
    const y = (i * 61.8 * 7) % (H * 0.62);
    const r = i % 7 === 0 ? 2.6 : 1.3;
    c.globalAlpha = 0.5 + ((i * 13) % 10) / 20;
    c.beginPath();
    c.arc(x, y + 10, r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

function sun(c: C, x: number, y: number, r: number) {
  const glow = c.createRadialGradient(x, y, r * 0.6, x, y, r * 2.2);
  glow.addColorStop(0, 'rgba(255,190,120,0.55)');
  glow.addColorStop(1, 'rgba(255,190,120,0)');
  c.fillStyle = glow;
  c.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
  c.fillStyle = '#f6a04d';
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function moon(c: C, x: number, y: number, r: number) {
  c.fillStyle = '#ef7fbf';
  c.beginPath();
  c.arc(x, y, r, Math.PI * 0.35, Math.PI * 1.65);
  c.arc(x - r * 0.42, y - r * 0.08, r * 0.8, Math.PI * 1.55, Math.PI * 0.45, true);
  c.closePath();
  c.fill();
}

/** The tree the two halves meet in: a trunk up the front, its branches out over both sides. */
function tree(c: C) {
  c.fillStyle = '#7d2a3c';
  stroke(c, [[548, 1000], [532, 820], [560, 640], [540, 470], [556, 330]], 86, 0.15);
  c.fillStyle = '#9c3a50';
  stroke(c, [[530, 990], [516, 820], [540, 650], [526, 480]], 26, 0.4);
  c.fillStyle = '#7d2a3c';
  const branches: [number, number][][] = [
    [[548, 360], [440, 250], [300, 210], [150, 120]],
    [[540, 420], [420, 380], [260, 330], [90, 300]],
    [[552, 330], [520, 200], [470, 90], [430, 10]],
    [[556, 350], [650, 250], [780, 200], [940, 110]],
    [[558, 400], [700, 370], [860, 380], [1010, 330]],
  ];
  for (const b of branches) stroke(c, b, 30, 0.6);
}

/** A bunch of berries hanging from a branch: dark and bright reds, each with a glint. */
function berries(c: C, x: number, y: number, n = 7) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.4;
    const bx = x + Math.cos(a) * (4 + i * 3.2);
    const by = y + i * 6 + Math.sin(a) * 6;
    c.fillStyle = i % 3 === 0 ? '#c43a4a' : i % 3 === 1 ? '#8f1d32' : '#e05a63';
    c.beginPath();
    c.arc(bx, by, 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,230,220,0.65)';
    c.beginPath();
    c.arc(bx - 3.5, by - 3.5, 3, 0, Math.PI * 2);
    c.fill();
  }
}

/** A blue feather, drifting: a leaf-shaped vane with its quill down the middle, turned `turn`. */
function feather(c: C, x: number, y: number, len: number, turn: number, color: string) {
  c.save();
  c.translate(x, y);
  c.rotate(turn);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, -len / 2);
  c.quadraticCurveTo(len * 0.22, -len * 0.05, 0, len / 2);
  c.quadraticCurveTo(-len * 0.22, -len * 0.05, 0, -len / 2);
  c.fill();
  c.strokeStyle = 'rgba(220,230,255,0.8)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, -len / 2);
  c.lineTo(0, len / 2 + 6);
  c.stroke();
  c.restore();
}

/** The white horse, its head toward the peacock and its red mane streaming out behind it. */
function horse(c: C) {
  // The mane first, from the crest of its neck back over the warm side, and a forelock between its ears.
  const mane: [string, [number, number][], number][] = [
    ['#b02a3a', [[530, 574], [470, 548], [410, 560], [330, 530]], 30],
    ['#c8323f', [[508, 600], [440, 596], [370, 624], [290, 604]], 34],
    ['#e2574c', [[486, 640], [420, 650], [350, 690], [262, 670]], 34],
    ['#f28a4b', [[466, 690], [400, 712], [330, 752], [250, 744]], 30],
    ['#d84455', [[452, 740], [400, 770], [340, 800], [280, 800]], 24],
  ];
  for (const [color, pts, w] of mane) {
    c.fillStyle = color;
    stroke(c, pts, w, 0.7);
  }
  // The head and neck in profile, cream-white, outlined in the trunk's red.
  c.fillStyle = '#fcece6';
  c.strokeStyle = '#8a2e40';
  c.lineWidth = 3;
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(434, 860);
  c.bezierCurveTo(440, 750, 482, 630, 528, 576);
  c.lineTo(520, 540);
  c.lineTo(541, 562);
  c.lineTo(552, 530);
  c.lineTo(558, 568);
  c.bezierCurveTo(584, 592, 612, 630, 628, 664);
  c.bezierCurveTo(636, 682, 622, 696, 604, 692);
  c.bezierCurveTo(588, 690, 572, 676, 556, 666);
  c.bezierCurveTo(540, 660, 530, 652, 524, 660);
  c.bezierCurveTo(516, 720, 510, 790, 512, 860);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = '#c8323f';
  stroke(c, [[544, 566], [560, 590], [566, 612]], 12, 0.6);
  // A blush down the cheek, the eye, the nostril and the line of the mouth.
  c.fillStyle = 'rgba(232,140,150,0.45)';
  c.beginPath();
  c.ellipse(560, 640, 24, 13, 0.7, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#3a1a22';
  c.beginPath();
  c.ellipse(566, 606, 5, 3.5, 0.6, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(618, 676, 3.5, 2.5, 0.5, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#8a2e40';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(604, 690);
  c.quadraticCurveTo(596, 684, 588, 686);
  c.stroke();
}

/** One of the peacock's tail feathers: a long stroke out to an eye of teal, gold and deep blue. */
function eyeFeather(c: C, from: [number, number], to: [number, number], bend: number) {
  const mid: [number, number] = [(from[0] + to[0]) / 2 + bend, (from[1] + to[1]) / 2 - bend * 0.3];
  c.fillStyle = '#1f7a8c';
  stroke(c, [from, mid, to], 22, 0.2);
  const [x, y] = to;
  for (const [r, color] of [
    [17, '#2bb3a3'],
    [12, '#f2c14e'],
    [8, '#1d3f8f'],
    [4, '#0b1638'],
  ] as const) {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, r * 1.25, r, 0.4, 0, Math.PI * 2);
    c.fill();
  }
}

/** The peacock, facing the horse, its tail trailing down and round onto the right side. */
function peacock(c: C) {
  const tail: [[number, number], number][] = [
    [[730, 930], 30],
    [[790, 880], 20],
    [[850, 830], 10],
    [[900, 900], -20],
    [[960, 820], -10],
    [[700, 980], 40],
    [[840, 960], -30],
  ];
  for (const [to, bend] of tail) eyeFeather(c, [640, 800], to, bend);
  // Body and neck, in deep blues and teal.
  const body = c.createLinearGradient(600, 640, 690, 860);
  body.addColorStop(0, '#2f6fd0');
  body.addColorStop(1, '#1b3c8f');
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(616, 610);
  c.bezierCurveTo(630, 640, 600, 690, 612, 740);
  c.bezierCurveTo(624, 800, 690, 840, 700, 800);
  c.bezierCurveTo(712, 750, 660, 700, 650, 650);
  c.bezierCurveTo(644, 620, 640, 600, 628, 592);
  c.closePath();
  c.fill();
  // The head: a beak toward the horse, an eye with its white stripe, and the little crown of three.
  c.fillStyle = '#2a5fc4';
  c.beginPath();
  c.ellipse(622, 596, 14, 11, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#e8b04a';
  c.beginPath();
  c.moveTo(610, 592);
  c.lineTo(592, 600);
  c.lineTo(610, 602);
  c.closePath();
  c.fill();
  c.fillStyle = '#ffffff';
  c.fillRect(612, 592, 12, 3);
  c.strokeStyle = '#2a5fc4';
  c.lineWidth = 2;
  c.fillStyle = '#5fd0c0';
  for (const dx of [-8, 0, 8]) {
    c.beginPath();
    c.moveTo(624, 586);
    c.lineTo(624 + dx, 562);
    c.stroke();
    c.beginPath();
    c.arc(624 + dx, 560, 4, 0, Math.PI * 2);
    c.fill();
  }
}

/** Waves along the foot, both halves' colours flowing into each other. */
function waves(c: C) {
  const rows: [string, number, number, number][] = [
    ['#e8853c', 880, 16, 0],
    ['#f3c35a', 912, 14, 1.4],
    ['#2a9d8f', 944, 12, 2.6],
    ['#d8566b', 972, 10, 0.8],
  ];
  for (const [color, y, amp, phase] of rows) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) c.lineTo(x, y + Math.sin(x / 46 + phase) * amp);
    c.lineTo(W, H);
    c.closePath();
    c.fill();
  }
}

/** The painting itself: sky, sun and moon, the tree with its berries and feathers, the horse and the peacock. */
function scene(c: C) {
  sky(c);
  sun(c, 170, 470, 58);
  moon(c, 862, 300, 54);
  tree(c);
  for (const [x, y] of [[150, 120], [250, 205], [90, 300], [330, 260], [430, 40], [205, 330], [370, 160]] as const) berries(c, x, y);
  ([
    [780, 470, 62, 0.5, '#5b74e6'],
    [700, 560, 50, -0.4, '#8ea2ff'],
    [900, 520, 70, 0.9, '#4059c9'],
    [960, 640, 54, -0.2, '#6f86ff'],
    [820, 620, 44, 1.3, '#8ea2ff'],
    [990, 220, 58, 0.3, '#5b74e6'],
    [750, 250, 46, -0.6, '#6f86ff'],
  ] as const).forEach(([x, y, len, turn, color]) => feather(c, x, y, len, turn, color));
  // The house, lit up in the hills on the Scottish side.
  c.fillStyle = '#18204a';
  c.beginPath();
  c.ellipse(860, 800, 190, 60, 0, Math.PI, 0);
  c.fill();
  house(c, 870, 772, 120, '#f6d58a');
  horse(c);
  peacock(c);
  waves(c);
}

/** The whole wrap: the painting, and the label on its front as on the bottle, with a soft shadow under it. */
function paint(c: C) {
  scene(c);
  const lw = (FRONT.x1 - FRONT.x0) * 0.84;
  const lh = lw * (626 / 640);
  const lx = (FRONT.x0 + FRONT.x1) / 2 - lw / 2;
  c.save();
  c.shadowColor = 'rgba(40,20,30,0.45)';
  c.shadowBlur = 18;
  c.shadowOffsetY = 6;
  c.fillStyle = '#f7f2e8';
  c.fillRect(lx, 70, lw, lh);
  c.restore();
  labelFace(c, lx, 70, lw, lh, { corners: false });
}

// ---- The bottle's wrap -----------------------------------------------------------------------------
//
// The same painting all the way round the bottle, as a panorama: the tree's trunk up the front with its
// branches out over both sides, Spain on the left (the sun, the berries, the white horse looking in)
// and Scotland on the right (the moon and stars, the feathers, the peacock looking back at it), the
// house in the hills round the back, and the waves along the foot. The cream label is a smaller panel
// inset at the front, over the trunk, so whichever way you look at the bottle you see the art.

/**
 * The wrap's canvas: round the bottle (u, from the back, round the left, the front at the middle and
 * the right) and up it (0.194 tall on a bottle 0.1096 across: about as many pixels to the centimetre
 * either way), and the label panel inset at the front.
 */
export const WRAP = { w: 1280, h: 720 } as const;
export const PANEL = { w: 200, y0: 66, y1: 432 } as const;
const MID = WRAP.w / 2;

/** Draws `draw` (made for the box's canvas) scaled by `s`, with its point `from` landing at `to` on the wrap. */
function placed(c: C, from: [number, number], to: [number, number], s: number, draw: (c: C) => void) {
  c.save();
  c.translate(to[0], to[1]);
  c.scale(s, s);
  c.translate(-from[0], -from[1]);
  draw(c);
  c.restore();
}

/** Warm on the left, the night on the right, meeting behind the label, and dusk round the back where the wrap's two ends meet. */
function wrapSky(c: C) {
  const { w, h } = WRAP;
  const warm = c.createLinearGradient(0, 0, 0, h);
  warm.addColorStop(0, '#b4576b');
  warm.addColorStop(0.5, '#df7b67');
  warm.addColorStop(0.85, '#f2a865');
  c.fillStyle = warm;
  c.fillRect(0, 0, w, h);
  const cool = c.createLinearGradient(0, 0, 0, h);
  cool.addColorStop(0, '#1f2160');
  cool.addColorStop(0.55, '#33317f');
  cool.addColorStop(1, '#202a63');
  c.fillStyle = cool;
  c.beginPath();
  c.moveTo(MID + 30, 0);
  c.bezierCurveTo(MID - 20, h * 0.35, MID + 40, h * 0.65, MID, h);
  c.lineTo(w, h);
  c.lineTo(w, 0);
  c.closePath();
  c.fill();
  // Dusk round the back, the same at both ends, so the seam doesn't show: thin slices fading in.
  const dusk = c.createLinearGradient(0, 0, 0, h);
  dusk.addColorStop(0, '#4a2c6a');
  dusk.addColorStop(0.6, '#7a4a7e');
  dusk.addColorStop(1, '#8a5470');
  c.fillStyle = dusk;
  const fade = 170;
  for (let i = 0; i < fade; i += 5) {
    c.globalAlpha = (1 - i / fade) ** 1.5;
    c.fillRect(i, 0, 5, h);
    c.fillRect(w - i - 5, 0, 5, h);
  }
  c.globalAlpha = 1;
  // Stars over Scotland, and a few round the back.
  c.fillStyle = '#fff6e0';
  for (let i = 0; i < 60; i++) {
    const x = MID + 40 + ((i * 137.5) % (w - MID - 30));
    const y = 12 + ((i * 61.8 * 7) % (h * 0.5));
    c.globalAlpha = 0.5 + ((i * 13) % 10) / 20;
    c.beginPath();
    c.arc(x % w, y, i % 7 === 0 ? 2.4 : 1.2, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

/** The tree: its trunk up the front, under the label, and its branches out round both sides. */
function wrapTree(c: C) {
  c.fillStyle = '#7d2a3c';
  stroke(c, [[MID + 4, WRAP.h], [MID - 10, 560], [MID + 12, 300], [MID - 4, 120], [MID + 6, 30]], 70, 0.12);
  const branches: [number, number][][] = [
    [[MID, 70], [560, 40], [440, 52], [300, 16], [190, 30]],
    [[MID, 120], [540, 140], [420, 190], [280, 176], [150, 220]],
    [[MID, 60], [730, 34], [850, 54], [990, 14], [1100, 30]],
    [[MID, 112], [750, 136], [870, 188], [1010, 172], [1140, 214]],
  ];
  for (const b of branches) stroke(c, b, 18, 0.6);
}

/** The bottle's wrap: the painting all the way round, and the label inset at the front. */
function bottleWrap(c: C) {
  wrapSky(c);
  sun(c, 420, 230, 44);
  moon(c, 868, 226, 40);
  // The house lit up in the hills, round the back on the Scottish side.
  c.fillStyle = '#18204a';
  c.beginPath();
  c.ellipse(1110, 610, 150, 46, 0, Math.PI, 0);
  c.fill();
  house(c, 1112, 588, 92, '#f6d58a');
  wrapTree(c);
  for (const [x, y] of [[560, 66], [470, 70], [380, 44], [300, 40], [520, 160], [410, 206], [300, 196], [200, 232], [120, 54]] as const) placed(c, [0, 0], [x, y], 0.62, (c) => berries(c, 0, 0));
  ([
    [770, 340, 44, 0.5, '#5b74e6'],
    [1000, 300, 50, 0.9, '#4059c9'],
    [1080, 420, 40, -0.2, '#6f86ff'],
    [940, 100, 42, 0.3, '#5b74e6'],
    [1190, 120, 46, -0.6, '#6f86ff'],
    [1230, 330, 38, 1.2, '#8ea2ff'],
  ] as const).forEach(([x, y, len, turn, color]) => feather(c, x, y, len, turn, color));
  // The horse on the left of the label, looking in toward it, its mane streaming out behind; the
  // peacock on the right, looking back, its tail trailing round toward the back.
  // (The horse's neck runs down into the waves, and the peacock's tail trails over them.)
  placed(c, [636, 530], [MID - PANEL.w / 2 - 10, 332], 0.85, horse);
  wrapWaves(c);
  placed(c, [592, 560], [MID + PANEL.w / 2 + 12, 270], 0.8, peacock);
  // The label, inset at the front over the trunk: a gold edge, a soft shadow and the label itself.
  const x = MID - PANEL.w / 2;
  const lh = PANEL.y1 - PANEL.y0;
  c.save();
  c.shadowColor = 'rgba(30,14,24,0.5)';
  c.shadowBlur = 14;
  c.shadowOffsetY = 4;
  c.fillStyle = GOLD;
  c.fillRect(x - 4, PANEL.y0 - 4, PANEL.w + 8, lh + 8);
  c.restore();
  insetLabel(c, x, PANEL.y0, PANEL.w, lh);
}

/** Waves along the foot of the wrap, all the way round: a whole number of them, so they meet at the back. */
function wrapWaves(c: C) {
  const { w, h } = WRAP;
  const rows: [string, number, number, number][] = [
    ['#e8853c', 588, 13, 0],
    ['#f3c35a', 620, 11, 1.4],
    ['#2a9d8f', 652, 10, 2.6],
    ['#d8566b', 684, 8, 0.8],
  ];
  const k = (Math.PI * 2 * 9) / w;
  for (const [color, y, amp, phase] of rows) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x * k + phase) * amp);
    c.lineTo(w, h);
    c.closePath();
    c.fill();
  }
}

let artTex: THREE.CanvasTexture | null = null;
let wrapTex: THREE.CanvasTexture | null = null;

/** The bottle's wrap, the art all round it and the label inset at the front, drawn once for every cabinet. */
export function wrapTexture(): THREE.CanvasTexture {
  return (wrapTex ??= canvasTexture(WRAP.w, WRAP.h, bottleWrap));
}

/** The box's artwork, drawn once for every cabinet. */
export function boxArtTexture(): THREE.CanvasTexture {
  return (artTex ??= canvasTexture(W, H, paint));
}
