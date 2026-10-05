import * as THREE from 'three';
import { PLATE, SHELL, frameOf, headingToStreet, isClaimable } from '../../../shared/mainstreet';
import type { BusinessCard, BusinessSkin } from '../../../shared/protocol';
import { FACADE, TOWER } from '../facade';
import { canvasTexture } from '../texture';
import { mergeByMaterial, mesh, toon } from '../toon';
import { FONT, flatPaint, inkOn, seeded, type StreetKit } from './kit';
import { LOBBY } from './layout';

// A shell: the tower a business has claimed a plot for, standing before it has any floors. Its plate
// is the standard one, its garage level at the bottom with the lobby's glass doors (marked "Opening
// soon", its name on the canopy over them) and the garage door, then a storey per planned floor,
// each a band in that storey's color under two rows of glass, with a spandrel between them and a
// mullion every few meters, in Friday Tower's rhythm (TOWER); the frame paint is the business's skin.
// A parapet round the roof with planters along it, and the name in big letters across the top
// storey's street face. Built in the building's own frame (its street side +z) and turned onto its
// plot, so Plot 7's faces Main Street across the road.

/** The skins a business picks from: its frame paint, its spandrels, its garage level and its parapet's cap. */
export const SKINS: Record<BusinessSkin, { frame: string; spandrel: string; plinth: string; cap: string }> = {
  glass: { frame: '#d9dee5', spandrel: '#7f93a8', plinth: '#b8bfc9', cap: '#eef1f4' },
  brick: { frame: '#a4553f', spandrel: '#8c4532', plinth: '#7a3d2e', cap: '#e3d5c2' },
  graphite: { frame: '#2e3140', spandrel: '#23252f', plinth: '#1d1f28', cap: '#5a5f73' },
  timber: { frame: '#b07a4c', spandrel: '#8a5a35', plinth: '#6e4a2e', cap: '#ead7b5' },
};

/**
 * The frame's face stands this far off the plate's edge, and the glass is set this far back behind
 * it (into the plate, as Friday Tower's bars have theirs), so a shell stands on its plate and no
 * further out than that, as what Friday One and golf keep clear of says (businessBoxes).
 */
const OFF = 0.01;
const DEPTH = 0.12;
const MULLION = 0.1;

type Side = 'south' | 'north' | 'east' | 'west';
const SIDES: Side[] = ['south', 'east', 'north', 'west'];

/** One face of the plate: where along it things are (u, corner to corner), and where on it a point is, `out` in front of it. */
function faceOf(side: Side) {
  const { halfX: hx, halfZ: hz } = PLATE;
  const ns = side === 'south' || side === 'north';
  const len = ns ? 2 * hx : 2 * hz;
  const at = (u: number, y: number, out = 0): [number, number, number] => {
    if (side === 'south') return [u, y, hz + out];
    if (side === 'north') return [-u, y, -hz - out];
    if (side === 'east') return [hx + out, y, -u];
    return [-hx - out, y, u];
  };
  const rotY = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }[side];
  return { len, at, rotY };
}

/**
 * Which of `n` bays in a row are lit at night, and in which glow (-1 for none): runs of a few, with
 * gaps between, as a whole office is (see litRuns in world/tower-bars.ts).
 */
function runs(n: number, random: () => number): number[] {
  const out = new Array<number>(n).fill(-1);
  for (let i = Math.floor(random() * 5); i < n; ) {
    const len = 2 + Math.floor(random() * 5);
    const pick = random();
    const glow = pick < 0.4 ? 0 : pick < 0.75 ? 1 : 2;
    for (let j = i; j < Math.min(n, i + len); j++) out[j] = glow;
    i += len + 3 + Math.floor(random() * 8);
  }
  return out;
}

/**
 * A name in big letters on nothing, outlined in night ink, for across a facade: `h` m tall, or
 * smaller to be at most `maxW` wide. Hands back the picture and how big it came out (m).
 */
function bigName(name: string, color: string, h: number, maxW: number): { tex: THREE.CanvasTexture; w: number; h: number } {
  const H = 160;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `800 ${H * 0.78}px ${FONT}`;
  const W = Math.ceil(Math.max(1, probe.measureText(name).width) + H * 0.4);
  const w = Math.min(maxW, (W / H) * h);
  const tex = canvasTexture(W, H, (g) => {
    g.font = `800 ${H * 0.78}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = H * 0.08;
    g.strokeStyle = FACADE.ink;
    g.strokeText(name, W / 2, H * 0.53);
    g.fillStyle = color;
    g.fillText(name, W / 2, H * 0.53);
  });
  return { tex, w, h: (w * H) / W };
}

/** A sign of `name` on nothing (see bigName), facing +z at (x, y, z) in `group`; its picture and material go on the lists to throw away. */
function nameSign(group: THREE.Group, gone: { textures: THREE.Texture[]; materials: THREE.Material[] }, name: string, color: string, h: number, maxW: number, x: number, y: number, z: number) {
  const { tex, w, h: hh } = bigName(name, color, h, maxW);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1 });
  gone.textures.push(tex);
  gone.materials.push(mat);
  group.add(mesh(new THREE.PlaneGeometry(w, hh), mat, x, y, z, false));
}

export interface ShellView {
  /** In the street frame, y 0 the street. */
  group: THREE.Group;
  dispose(): void;
}

/** `card`'s shell (a card whose stage is 'shell'), on its plot. */
export function buildShell(card: BusinessCard, kit: StreetKit): ShellView {
  if (!isClaimable(card.plot)) throw new Error(`${card.plot} isn't a plot a business can have`);
  const skin = SKINS[card.skin] ?? SKINS.glass;
  // In its own frame, put where its plot's frame says (frameOf), turned to face the street.
  const place = frameOf(card.plot, 0);
  const group = new THREE.Group();
  group.position.set(place.x, 0, place.z);
  group.rotation.y = headingToStreet(place, 0);
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  const paint = (color: string) => {
    const m = flatPaint(color);
    materials.push(m);
    return m;
  };
  const frame = paint(skin.frame);
  const spandrel = paint(skin.spandrel);
  const plinth = paint(skin.plinth);
  const bands = new Map<string, THREE.Material>();
  const bandOf = (color: string) => bands.get(color) ?? bands.set(color, paint(color)).get(color)!;
  const random = seeded(`${card.id}|${card.plot}`);
  const { halfX: hx, halfZ: hz } = PLATE;
  const storeys = Math.max(1, Math.min(SHELL.maxStoreys, card.storeys.length));
  const parts = new THREE.Group();

  /** A box `d` deep on `side`, `w` along it round `u` and `h` up round `y`, its front `out` in front of the plate's edge. */
  const slab = (side: Side, u: number, y: number, w: number, h: number, d: number, mat: THREE.Material, out = OFF) => {
    const f = faceOf(side);
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat, 0, 0, 0, false);
    m.position.set(...f.at(u, y, out - d / 2));
    m.rotation.y = f.rotY;
    parts.add(m);
  };
  /** A pane facing out of `side`, `out` in front of the plate's edge (behind it, if less than 0). */
  const pane = (side: Side, u: number, y: number, w: number, h: number, mat: THREE.Material, out: number) => {
    const f = faceOf(side);
    const m = mesh(new THREE.PlaneGeometry(w, h), mat, 0, 0, 0, false);
    m.position.set(...f.at(u, y, out));
    m.rotation.y = f.rotY;
    parts.add(m);
  };

  // The garage level: a plinth all round, the lobby's glass front and doors, the garage door.
  parts.add(mesh(new THREE.BoxGeometry(2 * hx, SHELL.garage, 2 * hz), plinth, 0, SHELL.garage / 2, 0));
  const [g0, g1] = LOBBY.glass;
  pane('south', (g0 + g1) / 2, 1.6, g1 - g0, 3.1, kit.lobby, 0.015);
  for (const u of [g0, LOBBY.x - LOBBY.width / 2, LOBBY.x, LOBBY.x + LOBBY.width / 2, g1]) slab('south', u, 1.6, 0.12, 3.2, 0.1, frame, 0.11);
  slab('south', (g0 + g1) / 2, 3.2, g1 - g0 + 0.12, 0.12, 0.1, frame, 0.11);
  slab('south', LOBBY.x, LOBBY.height, LOBBY.width, 0.1, 0.12, frame, 0.13);
  // The garage door, a roller shutter.
  const shutter = toon('#9aa1ab');
  for (let y = 0.15; y < 3; y += 0.3) slab('south', -11, y, 6, 0.24, 0.06, shutter, 0.07);
  slab('south', -11, 3.05, 6.4, 0.2, 0.14, frame, 0.15);
  // The canopy over the lobby, in the business's color, its name on the front.
  const { out: reach, y: cy, depth } = LOBBY.canopy;
  const canopy = paint(card.accent);
  parts.add(mesh(new THREE.BoxGeometry(g1 - g0 + 0.6, depth, reach), canopy, (g0 + g1) / 2, cy + depth / 2, hz + reach / 2));
  parts.add(mesh(new THREE.BoxGeometry(g1 - g0 + 0.4, 0.04, reach - 0.1), kit.lobby, (g0 + g1) / 2, cy - 0.01, hz + reach / 2, false));

  // Each storey: its band in its color, then glass, a spandrel and glass again, with mullions.
  const rows: [number, number][] = [
    [0.3, 0.3 + TOWER.glass],
    [0.3 + TOWER.glass + TOWER.spandrel, SHELL.storey],
  ];
  for (let k = 0; k < storeys; k++) {
    const y0 = SHELL.garage + k * SHELL.storey;
    const band = bandOf(card.storeys[k]?.accent ?? card.accent);
    for (const side of SIDES) {
      const f = faceOf(side);
      const n = Math.max(1, Math.round(f.len / TOWER.mullion));
      const bay = f.len / n;
      // Meeting the next side's at the corner.
      slab(side, 0, y0 + 0.15, f.len + 2 * OFF, 0.3, 0.16, band);
      slab(side, 0, y0 + 0.3 + TOWER.glass + TOWER.spandrel / 2, f.len + 2 * OFF, TOWER.spandrel, DEPTH, spandrel);
      for (const [a, b] of rows) {
        const lights = runs(n, random);
        for (let i = 0; i < n; i++) {
          const tone = Math.floor(random() * 3) % 3;
          const mat = lights[i] < 0 ? kit.glass.dark[tone] : kit.glass.lit[tone][lights[i]];
          pane(side, -f.len / 2 + (i + 0.5) * bay, y0 + (a + b) / 2, bay, b - a, mat, OFF - DEPTH);
        }
      }
      for (let i = 0; i <= n; i++) {
        const u = Math.min(f.len / 2 - MULLION / 2, Math.max(-f.len / 2 + MULLION / 2, -f.len / 2 + i * bay));
        slab(side, u, y0 + 0.3 + (SHELL.storey - 0.3) / 2, MULLION, SHELL.storey - 0.3, DEPTH, frame);
      }
    }
  }

  // Its corners, the frame's, from the garage level's top to the roof.
  const roof = SHELL.garage + storeys * SHELL.storey;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(0.2, roof - SHELL.garage, 0.2), frame, sx * (hx + OFF - 0.1), (roof + SHELL.garage) / 2, sz * (hz + OFF - 0.1), false));

  // The roof: its slab, the parapet round it with a cap, planters along its inside, and the plant.
  parts.add(mesh(new THREE.PlaneGeometry(2 * hx, 2 * hz).rotateX(-Math.PI / 2), paint('#c9ced6'), 0, roof - 0.02, 0, false));
  const cap = toon(skin.cap);
  const P = SHELL.parapet;
  // Flush with the frame round the storeys under it.
  const t = 0.45;
  for (const [w, d, x, z] of [
    [2 * (hx + OFF), t, 0, hz + OFF - t / 2],
    [2 * (hx + OFF), t, 0, -hz - OFF + t / 2],
    [t, 2 * (hz + OFF - t), hx + OFF - t / 2, 0],
    [t, 2 * (hz + OFF - t), -hx - OFF + t / 2, 0],
  ]) {
    parts.add(mesh(new THREE.BoxGeometry(w, P - 0.08, d), frame, x, roof + (P - 0.08) / 2, z));
    parts.add(mesh(new THREE.BoxGeometry(w + 0.08, 0.08, d + 0.08), cap, x, roof + P - 0.04, z));
  }
  const planter = toon('#a47148');
  const greens = [toon('#5fb760'), toon('#3f8f45'), toon('#6fcf6a')];
  for (let i = 0; i < 7; i++) {
    const x = -hx + 3 + i * ((2 * hx - 6) / 6);
    for (const z of [hz - 1.1, -hz + 1.1]) {
      parts.add(mesh(new THREE.BoxGeometry(1.8, 0.55, 0.7), planter, x, roof + 0.28, z));
      for (let b = 0; b < 3; b++) parts.add(mesh(new THREE.SphereGeometry(0.34, 10, 8), greens[(i + b) % 3], x - 0.55 + b * 0.55, roof + 0.78, z, false));
    }
  }
  for (const [x, z] of [
    [-9, -4],
    [-5.5, -4],
    [9, 2],
  ])
    parts.add(mesh(new THREE.BoxGeometry(2.6, 1, 1.8), toon('#c9ccd4'), x, roof + 0.5, z));
  group.add(mergeByMaterial(parts));

  // The name: on the canopy's front, and in big letters across the top storey, both on the street
  // side; and "Opening soon" across the lobby's doors.
  const gone = { textures, materials };
  nameSign(group, gone, card.name, inkOn(card.accent), depth * 0.85, g1 - g0, (g0 + g1) / 2, cy + depth / 2, hz + reach + 0.012);
  const top = SHELL.garage + (storeys - 1) * SHELL.storey;
  nameSign(group, gone, card.name.toUpperCase(), '#fffaf3', 2.3, 2 * hx - 6, 0, top + 0.3 + TOWER.glass + TOWER.spandrel + TOWER.glass / 2, hz + OFF + 0.04);
  nameSign(group, gone, 'Opening soon', '#fffaf3', 0.5, LOBBY.width - 0.2, LOBBY.x, 1.6, hz + 0.13);

  return {
    group,
    dispose() {
      for (const t of textures) t.dispose();
      for (const m of materials) m.dispose();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
