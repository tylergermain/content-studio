import * as THREE from 'three';
import { DESKS, DESK_SIZE, STREET_Y } from '../../shared/layout';
import type { Theme } from '../../shared/protocol';
import { mulberry32 } from '../../shared/rng';
import { glowTexture } from './costumes';
import { plantLeaves } from './office';
import type { Collider, Office } from './types';
import { mergeByMaterial, mesh, toon, toonUnique } from './toon';

/*
 * The building dressed up for a holiday (the costumes are in world/costumes.ts). Christmas turns the
 * potted plants into little decorated trees with presents under them, puts a present on every desk,
 * a big lit tree out front and snowmen in the snow (the sky makes it snow, see Sky.setTheme).
 * Everything's built once and shown for its holiday. What's down on the street goes further down the
 * higher your floor is, as the street does (Office.setLevel).
 */

const G = STREET_Y;

/** Somewhere to put something: its foot at (x, y, z), `r` its size, turned so its front (+z) faces `rotY`. */
type Spot = [x: number, y: number, z: number, r: number, rotY: number];

/** A point `lx` along and `lz` out from a desk's middle, in its own frame (see DeskDef.rotY). */
function onDesk(d: { x: number; z: number; rotY: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return [d.x + lx * c + lz * s, d.z - lx * s + lz * c];
}

/** On every desk, in the back corner its own knick-knack leaves free (see buildDesk), facing whoever sits there. */
const DESK_SPOTS: Spot[] = DESKS.map((d, i) => {
  const [x, z] = onDesk(d, i % 3 === 1 ? 0.78 : -0.78, -0.28);
  return [x, DESK_SIZE.height, z, 0.12, d.rotY];
});

/** Where the snowmen stand, out front and round the side. */
const SNOWMEN: [x: number, z: number, rotY: number][] = [
  [-14, 18.6, 0.2],
  [13, 19.2, -0.3],
  [25.5, 6, -Math.PI / 2 + 0.3],
  [-23.5, 2, Math.PI / 2],
];

/** The big tree out front, on the lot by the sidewalk. */
const BIG_TREE = { x: -24, z: 17, height: 7.5 } as const;

/** Soft glows at `at`, one set of points per size. */
function halos(at: { p: THREE.Vector3; size: number; color: string }[]): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] {
  const map = glowTexture();
  const bySize = new Map<number, { pos: number[]; col: number[] }>();
  for (const h of at) {
    const size = Math.round(h.size * 10) / 10;
    let set = bySize.get(size);
    if (!set) bySize.set(size, (set = { pos: [], col: [] }));
    set.pos.push(h.p.x, h.p.y, h.p.z);
    const c = new THREE.Color(h.color);
    set.col.push(c.r, c.g, c.b);
  }
  return [...bySize].map(([size, { pos, col }]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  });
}

/**
 * A decorated Christmas tree `h` tall standing at 0,0,0: tiers of branches, baubles, lights and a
 * star. `lit` collects where each light is, for their glow at night.
 */
function christmasTree(h: number, lights: THREE.MeshToonMaterial[], lit?: THREE.Vector3[], trunk = false): THREE.Group {
  const g = new THREE.Group();
  const greens = [toon('#1f7a3a'), toon('#2a9d4b'), toon('#23884a')];
  const tiers = 4;
  const base = trunk ? h * 0.1 : 0;
  if (trunk) g.add(mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.045, base + 0.1, 10), toon('#6b4226'), 0, (base + 0.1) / 2, 0));
  const tierH = ((h - base) * 0.92) / (tiers * 0.72);
  const baubles = ['#e63946', '#ffd166', '#4cc9f0', '#f1faee', '#c77dff'].map((c) => toon(c));
  // Seeded, so the trees look the same every time.
  const rand = mulberry32(Math.round(h * 1000));
  for (let i = 0; i < tiers; i++) {
    const r = (h * 0.34 * (tiers - i)) / tiers + h * 0.05;
    const y0 = base + i * tierH * 0.72;
    g.add(mesh(new THREE.ConeGeometry(r, tierH, 14), greens[i % 3], 0, y0 + tierH / 2, 0));
    // Baubles and lights round the tier's lower edge, where the branches stick out.
    const n = 5 + (tiers - i) * 2;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + i;
      const up = 0.08 + rand() * 0.35;
      const rr = r * (1 - up) + h * 0.006;
      const y = y0 + tierH * up;
      if (j % 2) {
        g.add(mesh(new THREE.SphereGeometry(h * 0.024, 10, 8), baubles[(i + j) % baubles.length], Math.cos(a) * rr, y, Math.sin(a) * rr, false));
      } else {
        const at = new THREE.Vector3(Math.cos(a) * (rr + h * 0.004), y + tierH * 0.05, Math.sin(a) * (rr + h * 0.004));
        g.add(mesh(new THREE.SphereGeometry(h * 0.013, 8, 6), lights[(i + j / 2) % lights.length], at.x, at.y, at.z, false));
        lit?.push(at);
      }
    }
  }
  // A gold star on top.
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = (i % 2 ? 0.45 : 1) * h * 0.07;
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const gold = toonUnique('#ffd166');
  gold.emissive.set('#ffb000');
  gold.emissiveIntensity = 0.6;
  const s = mesh(new THREE.ExtrudeGeometry(star, { depth: h * 0.02, bevelEnabled: false }).translate(0, 0, -h * 0.01), gold, 0, base + tierH * 0.72 * (tiers - 1) + tierH + h * 0.04, 0, false);
  g.add(s);
  const s2 = s.clone();
  s2.rotation.y = Math.PI / 2;
  g.add(s2);
  return g;
}

/** A wrapped present `w` across, sitting on y = 0. */
function present(w: number, paper: string, ribbon: string): THREE.Group {
  const g = new THREE.Group();
  const h = w * 0.8;
  g.add(mesh(new THREE.BoxGeometry(w, h, w), toon(paper), 0, h / 2, 0));
  const rib = toon(ribbon);
  g.add(mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, w * 0.18), rib, 0, h / 2, 0, false));
  g.add(mesh(new THREE.BoxGeometry(w * 0.18, h * 1.02, w * 1.02), rib, 0, h / 2, 0, false));
  for (const sx of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(w * 0.15, w * 0.05, 6, 12), rib, sx * w * 0.13, h + w * 0.1, 0, false);
    loop.rotation.y = Math.PI / 2;
    loop.rotation.x = sx * 0.4;
    g.add(loop);
  }
  return g;
}

const PAPERS: [string, string][] = [
  ['#e63946', '#ffd166'],
  ['#2a9d4b', '#e63946'],
  ['#4cc9f0', '#fffaf3'],
  ['#ffd166', '#c1121f'],
  ['#c77dff', '#ffd166'],
];

/** A snowman with a scarf, a carrot nose, coal eyes and buttons, twig arms and a top hat, facing +z. */
function snowman(): THREE.Group {
  const g = new THREE.Group();
  const snow = toon('#f4f8ff');
  const coal = toon('#23232b');
  const twig = toon('#6b4226');
  const balls: [number, number][] = [
    [0.55, 0.5],
    [0.4, 1.28],
    [0.28, 1.86],
  ];
  for (const [r, y] of balls) g.add(mesh(new THREE.SphereGeometry(r, 18, 14), snow, 0, y, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), coal, sx * 0.1, 1.94, 0.24, false));
  const nose = mesh(new THREE.ConeGeometry(0.05, 0.3, 10).rotateX(Math.PI / 2), toon('#ff8c1a'), 0, 1.86, 0.4, false);
  g.add(nose);
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), coal, 0, 1.12 + i * 0.16, 0.39 - Math.abs(i - 1) * 0.02, false));
  const scarf = mesh(new THREE.TorusGeometry(0.29, 0.07, 8, 20), toon('#d62828'), 0, 1.6, 0);
  scarf.rotation.x = Math.PI / 2;
  g.add(scarf);
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.4, 0.05), toon('#d62828'), 0.18, 1.42, 0.24).rotateZ(0.2));
  for (const sx of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6), twig, sx * 0.72, 1.45, 0, false);
    arm.rotation.z = sx * 1.05;
    g.add(arm);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), coal, 0, 2.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 20), coal, 0, 2.3, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 20), toon('#d62828'), 0, 2.16, 0, false));
  return g;
}

// -----------------------------------------------------------------------------------------------

export class Holiday {
  readonly group = new THREE.Group();
  theme: Theme | null = null;
  private christmas = new THREE.Group();
  private treeGlow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private lights: THREE.MeshToonMaterial[];
  private colliders: Record<Theme, Collider[]> = { christmas: [] };
  /**
   * Each holiday's things down on the street, how far down the street is from the floor you're on,
   * and where their colliders are from the bottom floor.
   */
  private street: Record<Theme, THREE.Group> = { christmas: new THREE.Group() };
  private drop = 0;
  private base = new Map<Collider, { top: number; bottom: number }>();
  /** The plants' leaves, and the tree each becomes at Christmas. */
  private plants: { leaves: THREE.Object3D[]; tree: THREE.Object3D }[] = [];

  constructor(private office: Office) {
    this.christmas.visible = false;
    this.group.add(this.christmas);
    this.christmas.add(this.street.christmas);

    this.lights = ['#ffe28a', '#ff5a5a', '#6ec3ff', '#7dff8a'].map((c) => {
      const m = toonUnique(c);
      m.emissive.set(c);
      m.emissiveIntensity = 0.6;
      m.userData.outlineParameters = { visible: false };
      return m;
    });
    // The potted plants become little trees standing in their pots, with presents round them: the
    // leaves are hidden and the tree shown instead.
    office.plants.forEach((p, i) => {
      const leaves = plantLeaves(p);
      const tree = new THREE.Group();
      const t = christmasTree(1.25, this.lights);
      t.position.y = 0.45;
      tree.add(t);
      const gifts = new THREE.Group();
      for (const [x, z, w, rot] of [
        [0.45, 0.2, 0.26, 0.3],
        [-0.3, 0.42, 0.2, -0.5],
        [0.12, -0.46, 0.22, 0.9],
      ]) {
        const [paper, ribbon] = PAPERS[(i + Math.round(w * 10)) % PAPERS.length];
        const g = present(w, paper, ribbon);
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        gifts.add(g);
      }
      tree.add(gifts);
      const merged = mergeByMaterial(tree);
      merged.visible = false;
      p.add(merged);
      this.plants.push({ leaves, tree: merged });
    });
    // A present on every desk.
    const deskGifts = new THREE.Group();
    DESK_SPOTS.forEach(([x, y, z, , rotY], i) => {
      const [paper, ribbon] = PAPERS[i % PAPERS.length];
      const g = present(0.17, paper, ribbon);
      g.position.set(x, y, z);
      g.rotation.y = rotY + 0.3;
      deskGifts.add(g);
    });
    this.christmas.add(mergeByMaterial(deskGifts));
    // The big tree out front, lit up, with a heap of presents.
    const out = new THREE.Group();
    const lit: THREE.Vector3[] = [];
    const big = christmasTree(BIG_TREE.height, this.lights, lit, true);
    out.add(big);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + 0.4;
      const w = 0.45 + (i % 3) * 0.15;
      const [paper, ribbon] = PAPERS[i % PAPERS.length];
      const g = present(w, paper, ribbon);
      g.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9);
      g.rotation.y = a;
      out.add(g);
    }
    // Merging keeps only what's inside the group, so it's placed after.
    const tree = mergeByMaterial(out);
    tree.position.set(BIG_TREE.x, G, BIG_TREE.z);
    this.street.christmas.add(tree);
    this.colliders.christmas.push({ minX: BIG_TREE.x - 1.5, maxX: BIG_TREE.x + 1.5, minZ: BIG_TREE.z - 1.5, maxZ: BIG_TREE.z + 1.5, bottom: G, top: G + BIG_TREE.height });
    this.treeGlow = halos(lit.map((p, i) => ({ p: p.clone().add(new THREE.Vector3(BIG_TREE.x, G, BIG_TREE.z)), size: 0.9, color: ['#ffe28a', '#ff5a5a', '#6ec3ff', '#7dff8a'][i % 4] })));
    this.street.christmas.add(...this.treeGlow);
    const men = new THREE.Group();
    for (const [x, z, rotY] of SNOWMEN) {
      const s = snowman();
      s.position.set(x, G, z);
      s.rotation.y = rotY;
      men.add(s);
      this.colliders.christmas.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, bottom: G, top: G + 2.5 });
    }
    this.street.christmas.add(mergeByMaterial(men));
    // Every collider here is down on the street.
    for (const c of this.colliders.christmas) this.base.set(c, { top: c.top, bottom: c.bottom ?? 0 });
  }

  /** Puts up the holiday's decorations, or takes them down (null). */
  set(theme: Theme | null) {
    if (theme === this.theme) return;
    const colliders = this.office.colliders;
    if (this.theme) for (const c of this.colliders[this.theme]) colliders.splice(colliders.indexOf(c), 1);
    this.theme = theme;
    if (theme) colliders.push(...this.colliders[theme]);
    this.christmas.visible = theme === 'christmas';
    for (const p of this.plants) {
      p.tree.visible = theme === 'christmas';
      for (const l of p.leaves) l.visible = theme !== 'christmas';
    }
  }

  /** `lampsOn` is how far the lamps are on (see Sky), 0 by day and 1 at night: the tree lights glow brighter. */
  update(t: number, lampsOn: number) {
    const drop = STREET_Y - this.office.night.street;
    if (drop !== this.drop) {
      this.drop = drop;
      for (const g of Object.values(this.street)) g.position.y = -drop;
      for (const [c, b] of this.base) {
        c.top = b.top - drop;
        c.bottom = b.bottom - drop;
      }
    }
    if (this.theme === 'christmas') {
      const base = 0.35 + 0.9 * lampsOn;
      this.lights.forEach((m, i) => (m.emissiveIntensity = base * (0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7))));
      for (const h of this.treeGlow) {
        h.material.opacity = lampsOn * 0.8;
        h.visible = h.material.opacity > 0.01;
      }
    }
  }
}
