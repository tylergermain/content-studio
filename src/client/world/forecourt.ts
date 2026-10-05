import * as THREE from 'three';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import { BUILDING, FACADE, storeys, storeysKey } from './facade';
import type { Fixture, StreetSite } from './office/fixture';
import { bulb } from './outside';
import { canvasTexture } from './texture';
import { mergeByMaterial, mesh, toon } from './toon';

// The way in from the street: a marquee over the garage's mouth, east of the bottom floor's balcony,
// with the building's name lit on it; a green lane painted across the garage floor to the lift; a
// lit frame round the lift's doors down there; and a directory beside it of what's up the building.
// None of it is in anyone's way: the marquee hangs from the slab on no posts, and the rest is paint
// and things flat on the walls, so the cars drive in and out as they always have.

const G = STREET_Y;
/** The garage's ceiling, which is the bottom floor's slab. */
const CEILING = -SLAB;
/** The building's south face, walls included: the garage's open mouth. */
const FRONT = FLOOR.maxZ + WALL_T;
/** The inside of the garage's back wall. */
const BACK = FLOOR.minZ;

/**
 * The marquee: over the mouth of the garage from x 4 (well clear of the posts under the balcony, and
 * of where the parachutes come down) to x 17, 4 m out over the lot; its fascia from `bottom` to
 * `top` over the street, all round its three open sides.
 */
const MARQUEE = { minX: 4, maxX: 17, minZ: FRONT, maxZ: FRONT + 4, bottom: G + 2.55, top: G + 3.45 } as const;
/** How thick the fascia is, and the deck inside it (under the slab, up to the garage's ceiling). */
const FASCIA_T = 0.12;
const DECK = 0.25;
/** The two downlights under it: over the lane, and as far the other side of the middle. */
const DOWNLIGHTS = [8.3, 12.7];

/**
 * The lane, from the garage's mouth to the hatched box in front of the lift's doors (painted on the
 * garage's floor in outside.ts), which is the last of it. It's west of the lift's middle to keep
 * clear of the column at x 9.6, and east of the Giallo Ferrari's bay.
 */
const LANE = { minX: 7.3, maxX: 9.3, minZ: ELEVATOR_FRONT + 2.2, maxZ: FRONT } as const;
/** The frame round the lift's stop in the garage: a jamb either side of its shaft, and a header. */
const PORTAL = { minX: ELEVATOR.x - ELEVATOR.width / 2 - 0.3, maxX: ELEVATOR.x + ELEVATOR.width / 2 + 0.3, depth: 0.2 } as const;
/** The directory on the back wall, between the Yellow Lambo's bay and the lift. */
const DIRECTORY = { minX: 3.3, maxX: 6.7, bottom: G + 0.8, top: G + 2.8 } as const;

/** The signs' letters: a heavy grotesk, as the mark's own name is set in. */
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** The mark's three bars, in its own 64 units (x, y, width, height), each slanted 16°. */
const BARS = [
  [20, 8, 36, 14],
  [14, 26, 40, 14],
  [24, 44, 32, 14],
] as const;
const SLANT = Math.tan((16 * Math.PI) / 180);

/** Paints the mark `h` tall with the top left of its outline at (x, y), and hands back how wide it is. */
function paintMark(g: CanvasRenderingContext2D, x: number, y: number, h: number): number {
  const k = h / 50;
  // Slanted, the bars run from 2.53 to 53.7 across and 8 to 58 down.
  g.save();
  g.translate(x - 2.53 * k, y - 8 * k);
  g.fillStyle = FACADE.accent;
  for (const [bx, by, bw, bh] of BARS) {
    g.beginPath();
    const corners = [
      [bx, by],
      [bx + bw, by],
      [bx + bw, by + bh],
      [bx, by + bh],
    ];
    corners.forEach(([px, py], i) => (i ? g.lineTo : g.moveTo).call(g, (px - py * SLANT) * k, py * k));
    g.closePath();
    g.fill();
  }
  g.restore();
  return 51.2 * k;
}

/**
 * A name as the logo sets it (the building's, unless told otherwise): the first of it in warm paper
 * and its last word in the signal green, in `size` px letters with the left of them at `x` and their
 * baseline at `y`. Squeezed across to `fit` px if it's wider. Hands back how wide it came out.
 */
function paintName(g: CanvasRenderingContext2D, x: number, y: number, size: number, fit = Infinity, name: string = BUILDING.name): number {
  const cut = name.lastIndexOf(' ');
  const [first, last] = cut > 0 ? [name.slice(0, cut + 1), name.slice(cut + 1)] : [name, ''];
  g.font = `800 ${size}px ${FONT}`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  const w1 = g.measureText(first).width;
  const w = w1 + g.measureText(last).width;
  const squeeze = Math.min(1, fit / w);
  g.save();
  g.translate(x, y);
  g.scale(squeeze, 1);
  g.fillStyle = FACADE.frame;
  g.fillText(first, 0, 0);
  g.fillStyle = FACADE.accent;
  g.fillText(last, w1, 0);
  g.restore();
  return w * squeeze;
}

/**
 * What the marquee says. Not the company's name: the bottom storey already has it lit just above, so
 * the marquee names the building instead.
 */
const MARQUEE_TEXT = 'FRIDAY TOWER';

/** The marquee's lettering, `w` by `h` m on its fascia: the mark and MARQUEE_TEXT across the middle, on nothing. */
function marqueeSign(w: number, h: number): THREE.CanvasTexture {
  const px = 240;
  const W = Math.round(w * px);
  const H = Math.round(h * px);
  return canvasTexture(W, H, (g) => {
    const size = H * 0.9;
    // Caps are about 0.72 of the letters' size: they and the mark are the same height, in the middle.
    const cap = size * 0.72;
    g.font = `800 ${size}px ${FONT}`;
    const nameW = g.measureText(MARQUEE_TEXT).width;
    const markW = 51.2 * (cap / 50);
    const gap = cap * 0.55;
    const fit = W * 0.98 - markW - gap;
    const total = markW + gap + Math.min(nameW, fit);
    const x0 = (W - total) / 2;
    paintMark(g, x0, (H - cap) / 2, cap);
    paintName(g, x0 + markW + gap, (H + cap) / 2, size, fit, MARQUEE_TEXT);
  });
}

/** Ink or warm paper, whichever reads on `color`. */
function inkOn(color: string): string {
  const c = new THREE.Color(color);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.25 ? FACADE.ink : FACADE.frame;
}

/** A line of the directory: its key (R, a floor's number, G), what's there, and that floor's color. */
interface Listing {
  key: string;
  name: string;
  accent?: string;
  here?: boolean;
}

/**
 * What's up the building, from the top down: the bar on the roof, each floor (its name and color as
 * the outside has them, see storeys in facade.ts, or just its number until they're known) and the
 * garage, which is where the directory is.
 */
export function listings(count: number): Listing[] {
  const known = storeys();
  const floors = known.length ? known : Array.from({ length: Math.max(1, count) }, (_, k) => ({ name: `Floor ${k + 1}`, accent: FACADE.band }));
  return [
    { key: 'R', name: 'Rooftop bar' },
    ...floors.map((s, k) => ({ key: String(k + 1), name: s.name, accent: s.accent })).reverse(),
    { key: 'G', name: 'Garage', here: true },
  ];
}

/** Paints the directory's face, `W` by `H` px: the mark and the name over a green rule, then the listings. */
function paintDirectory(g: CanvasRenderingContext2D, W: number, H: number, rows: Listing[]) {
  g.fillStyle = FACADE.ink;
  g.fillRect(0, 0, W, H);
  const pad = W * 0.05;
  const head = H * 0.17;
  const cap = head * 0.42;
  const markW = paintMark(g, pad, (head - cap) / 2 + pad * 0.3, cap);
  paintName(g, pad + markW + cap * 0.5, (head + cap) / 2 + pad * 0.3, cap / 0.72, W - 2 * pad - markW);
  g.fillStyle = FACADE.accent;
  g.fillRect(pad, head + pad * 0.3, W - 2 * pad, Math.max(3, H * 0.008));

  const top = head + pad * 0.8;
  const rowH = Math.min(H * 0.14, (H - top - pad * 0.5) / rows.length);
  const chip = rowH * 0.74;
  rows.forEach((row, i) => {
    const y = top + i * rowH + (rowH - chip) / 2;
    // The key in a chip: filled in the floor's color, outlined for the roof and the garage.
    g.beginPath();
    g.roundRect(pad, y, chip, chip, chip * 0.22);
    if (row.accent) {
      g.fillStyle = row.accent;
      g.fill();
    } else {
      g.lineWidth = Math.max(2, chip * 0.07);
      g.strokeStyle = FACADE.frame;
      g.stroke();
    }
    g.fillStyle = row.accent ? inkOn(row.accent) : FACADE.frame;
    g.font = `800 ${chip * 0.62}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(row.key, pad + chip / 2, y + chip / 2 + chip * 0.03);
    // What's there, squeezed to fit what's left of the line.
    const x = pad + chip * 1.45;
    const here = row.here ? 'YOU ARE HERE' : '';
    g.font = `700 ${chip * 0.3}px ${FONT}`;
    const hereW = here ? g.measureText(here).width + pad * 0.5 : 0;
    g.font = `600 ${chip * 0.6}px ${FONT}`;
    g.textAlign = 'left';
    const room = W - pad - x - hereW;
    const w = g.measureText(row.name).width;
    g.save();
    g.translate(x, y + chip / 2 + chip * 0.03);
    g.scale(Math.min(1, room / w), 1);
    g.fillStyle = FACADE.frame;
    g.fillText(row.name, 0, 0);
    g.restore();
    if (here) {
      g.font = `700 ${chip * 0.3}px ${FONT}`;
      g.textAlign = 'right';
      g.fillStyle = FACADE.accent;
      g.fillText(here, W - pad, y + chip / 2);
    }
  });
}

/**
 * The lane's paint, looking down on it with the street at the bottom: a wash of green between two
 * solid edges, and chevrons pointing in to the lift. They leave the arrow painted down the aisle at
 * z 0 to show (outside.ts). With `glow`, only the edges and the chevrons, on black: what lights up.
 */
function lanePaint(glow: boolean): THREE.CanvasTexture {
  const px = 48;
  const w = LANE.maxX - LANE.minX;
  const d = LANE.maxZ - LANE.minZ;
  const W = Math.round(w * px);
  const H = Math.round(d * px);
  return canvasTexture(W, H, (g) => {
    // The canvas's top is the lift's end, its bottom the street's.
    const Y = (z: number) => (z - LANE.minZ) * px;
    g.fillStyle = glow ? '#000000' : FACADE.accent;
    g.globalAlpha = glow ? 1 : 0.2;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.fillStyle = FACADE.accent;
    const edge = Math.round(0.1 * px);
    g.fillRect(0, 0, edge, H);
    g.fillRect(W - edge, 0, edge, H);
    g.strokeStyle = FACADE.accent;
    g.lineWidth = 0.16 * px;
    g.lineJoin = 'miter';
    for (let z = LANE.minZ + 1.6; z < LANE.maxZ - 0.8; z += 2.4) {
      if (Math.abs(z) < 2.6) continue;
      g.beginPath();
      g.moveTo(W * 0.24, Y(z) + 0.5 * px);
      g.lineTo(W / 2, Y(z));
      g.lineTo(W * 0.76, Y(z) + 0.5 * px);
      g.stroke();
    }
  });
}

/**
 * The marquee over the garage's mouth, the lane in to the lift, the frame round the lift's doors and
 * the directory beside them, down on the street. The directory's repainted from the storeys' names
 * and colors whenever they or the number of floors change (see Office.setLevel).
 */
export const forecourt: Fixture<never, StreetSite> = (site) => {
  const night = site.get('night');
  const parts = new THREE.Group();
  const ink = toon(FACADE.ink);
  const green = bulb(night, FACADE.accent, 0.6);

  // The marquee: a graphite deck flush under the slab, an ink fascia round its three open sides
  // standing a little proud of it, a green line along the fascia's foot, and two downlights under it.
  const m = MARQUEE;
  const mx = (m.minX + m.maxX) / 2;
  const mz = (m.minZ + m.maxZ) / 2;
  const mw = m.maxX - m.minX;
  const md = m.maxZ - m.minZ;
  const fh = m.top - m.bottom;
  const fy = (m.top + m.bottom) / 2;
  parts.add(mesh(box(mw - 2 * FASCIA_T, DECK, md - FASCIA_T), toon(FACADE.skin), mx, CEILING - DECK / 2, mz - FASCIA_T / 2));
  parts.add(mesh(box(mw, fh, FASCIA_T), ink, mx, fy, m.maxZ - FASCIA_T / 2));
  for (const x of [m.minX + FASCIA_T / 2, m.maxX - FASCIA_T / 2]) parts.add(mesh(box(FASCIA_T, fh, md - FASCIA_T), ink, x, fy, mz - FASCIA_T / 2));
  const line = { h: 0.05, y: m.bottom + 0.06, out: 0.02 };
  parts.add(mesh(box(mw + 2 * line.out, line.h, line.out), green, mx, line.y, m.maxZ + line.out / 2, false));
  for (const side of [-1, 1]) parts.add(mesh(box(line.out, line.h, md), green, mx + side * (mw / 2 + line.out / 2), line.y, mz, false));
  const soffit = CEILING - DECK;
  const downlight = bulb(night, '#fff3d6', 0.25);
  // Their light's pushed now, as the sky reads the lamps and lays out the halos once (see sky.ts);
  // they're down by the street, so on a floor further up they're that much further down.
  for (const x of DOWNLIGHTS) {
    parts.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16), downlight, x, soffit - 0.02, mz, false));
    night.halos.push({ at: new THREE.Vector3(x, soffit - 0.08, mz), size: 1.1, color: '#ffe3a3', ground: true });
    night.lamps.push({ x, y: soffit - 0.3, z: mz, reach: 6, color: '#ffe3a3', power: 3, ground: true });
  }
  // The mark and the name, lit, across the middle of the front of it.
  const signW = 9;
  const signH = 0.72;
  const letters = new THREE.MeshBasicMaterial({ map: marqueeSign(signW, signH), transparent: true, alphaTest: 0.05 });
  site.ground.add(mesh(new THREE.PlaneGeometry(signW, signH), letters, mx, (m.top + line.y + line.h / 2) / 2, m.maxZ + 0.006, false));

  // The lane, a little over the garage's floor, its edges and chevrons lit at night.
  const lane = new THREE.MeshToonMaterial({
    map: lanePaint(false),
    emissive: '#ffffff',
    emissiveMap: lanePaint(true),
    emissiveIntensity: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap,
  });
  night.windows.push(lane);
  const laneMesh = mesh(new THREE.PlaneGeometry(LANE.maxX - LANE.minX, LANE.maxZ - LANE.minZ), lane, (LANE.minX + LANE.maxX) / 2, G + 0.012, (LANE.minZ + LANE.maxZ) / 2, false);
  laneMesh.rotation.x = -Math.PI / 2;
  site.ground.add(laneMesh);

  // The frame round the lift: a jamb either side of its shaft, as deep as it and a little in front of
  // its doors, and a header along the ceiling over its sign; lit green round the inside.
  const p = PORTAL;
  const front = ELEVATOR_FRONT + p.depth;
  const jamb = ELEVATOR.x - ELEVATOR.width / 2 - p.minX;
  const gh = CEILING - G;
  for (const side of [-1, 1]) {
    const x = ELEVATOR.x + side * (ELEVATOR.width / 2 + jamb / 2);
    parts.add(mesh(box(jamb, gh, front - BACK), ink, x, G + gh / 2, (front + BACK) / 2));
    parts.add(mesh(box(0.05, gh - 0.1, 0.02), green, x - side * (jamb / 2 - 0.025), G + (gh - 0.1) / 2, front + 0.01, false));
  }
  parts.add(mesh(box(p.maxX - p.minX, 0.1, p.depth), ink, ELEVATOR.x, CEILING - 0.05, ELEVATOR_FRONT + p.depth / 2));
  parts.add(mesh(box(p.maxX - p.minX - 2 * jamb, 0.02, 0.05), green, ELEVATOR.x, CEILING - 0.11, front - 0.025, false));

  // The directory: an ink board on the back wall, its face lit (it paints itself, so it's never in the dark).
  const d = DIRECTORY;
  const dw = d.maxX - d.minX;
  const dh = d.top - d.bottom;
  parts.add(mesh(box(dw + 0.1, dh + 0.1, 0.06), ink, (d.minX + d.maxX) / 2, (d.top + d.bottom) / 2, BACK + 0.03));
  const face = canvasTexture(1024, Math.round((1024 * dh) / dw));
  const canvas = face.image as HTMLCanvasElement;
  site.ground.add(mesh(new THREE.PlaneGeometry(dw, dh), new THREE.MeshBasicMaterial({ map: face }), (d.minX + d.maxX) / 2, (d.top + d.bottom) / 2, BACK + 0.065, false));

  site.ground.add(mergeByMaterial(parts));

  /** What the directory was last painted with. */
  let shown = '';
  return {
    setLevel: (_index, count) => {
      const key = `${count}|${storeysKey()}`;
      if (key === shown) return;
      shown = key;
      paintDirectory(canvas.getContext('2d')!, canvas.width, canvas.height, listings(count));
      face.needsUpdate = true;
    },
  };
};
