import * as THREE from 'three';
import { HOARDING, PLATE, PLOTS, craneAt, isClaimable } from '../../../shared/mainstreet';
import type { BusinessCard } from '../../../shared/protocol';
import { canvasTexture } from '../texture';
import { mergeByMaterial, mesh, textPlane, toon } from '../toon';
import { buildCrane, type CraneView } from './crane';
import { FONT, INK, flatPaint, inkOn, type StreetKit } from './kit';
import { GATE, conesOf, hoardingWalls } from './layout';

// A building site, on a plot a business has claimed but not yet built on: a hoarding round the plate,
// printed along the street with the business's name and "Coming soon to Main Street" in its color,
// with a gate in the middle; behind it a slab with its first columns poking up, the site offices
// stacked two high, pallets and steel; cones out front; and the tower crane at the back of the plot.

/** One side of the hoarding's street face, the gate between the two: its picture, `w` by `h` m. */
function print(card: BusinessCard, w: number, h: number, left: boolean): THREE.CanvasTexture {
  const px = 110;
  const W = Math.round(w * px);
  const H = Math.round(h * px);
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#fffaf3';
    g.fillRect(0, 0, W, H);
    g.fillStyle = card.accent;
    g.fillRect(0, 0, W, H * 0.12);
    g.fillRect(0, H * 0.9, W, H * 0.1);
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const fit = (text: string, size: number, weight: number) => {
      g.font = `${weight} ${size}px ${FONT}`;
      const k = Math.min(1, (W * 0.9) / g.measureText(text).width);
      g.font = `${weight} ${size * k}px ${FONT}`;
    };
    if (left) {
      g.fillStyle = card.accent;
      fit(card.name.toUpperCase(), H * 0.46, 800);
      g.fillText(card.name.toUpperCase(), W / 2, H * 0.47);
      g.fillStyle = INK;
      fit(`${PLOTS[card.plot].name} · Main Street`, H * 0.13, 700);
      g.fillText(`${PLOTS[card.plot].name} · Main Street`, W / 2, H * 0.77);
    } else {
      g.fillStyle = INK;
      fit('Coming soon to Main Street', H * 0.26, 800);
      g.fillText('Coming soon to Main Street', W / 2, H * 0.4);
      const n = card.storeys.length;
      g.fillStyle = card.accent;
      fit(`${card.name} · ${n} ${n === 1 ? 'storey' : 'storeys'}`, H * 0.15, 700);
      g.fillText(`${card.name} · ${n} ${n === 1 ? 'storey' : 'storeys'}`, W / 2, H * 0.7);
    }
  });
}

/** A portable cabin, `w` long, its foot at the group's origin, its windows and door on its +z side. */
function cabin(parts: THREE.Group, x: number, y: number, z: number, w: number, accent: THREE.Material, glass: THREE.Material) {
  const white = toon('#f5f6f2');
  parts.add(mesh(new THREE.BoxGeometry(w, 2.55, 2.4), white, x, y + 1.275, z));
  parts.add(mesh(new THREE.BoxGeometry(w + 0.02, 0.35, 2.42), accent, x, y + 0.18, z));
  for (const dx of [-w * 0.32, w * 0.05, w * 0.3]) parts.add(mesh(new THREE.BoxGeometry(1.1, 0.8, 0.04), glass, x + dx, y + 1.55, z + 1.21, false));
  parts.add(mesh(new THREE.BoxGeometry(0.9, 2, 0.04), toon('#8d99ae'), x - w * 0.12, y + 1.05, z + 1.21, false));
}

export interface SiteView {
  /** In the street frame, y 0 the street. */
  group: THREE.Group;
  crane: CraneView;
  dispose(): void;
}

/** `card`'s building site (a card whose stage is 'site'), on its plot. */
export function buildSite(card: BusinessCard, kit: StreetKit): SiteView {
  if (!isClaimable(card.plot)) throw new Error(`${card.plot} isn't a plot a business can have`);
  const plate = PLOTS[card.plot].plate!;
  const group = new THREE.Group();
  // Built in the plot's building's frame, its street side +z, and turned onto the plot.
  const own = new THREE.Group();
  own.position.set(plate.x, 0, plate.z);
  own.rotation.y = plate.turn ? Math.PI : 0;
  group.add(own);
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];
  const accent = flatPaint(card.accent);
  materials.push(accent);
  const hx = PLATE.halfX + HOARDING.out;
  const hz = GATE.front;

  // The ground: bare earth, and the slab poured over the back two thirds of the plate.
  const dirt = flatPaint('#ffffff');
  dirt.map = kit.dirt.clone();
  dirt.map.needsUpdate = true;
  dirt.map.repeat.set(hx / 3, hz / 3);
  textures.push(dirt.map);
  materials.push(dirt);
  own.add(mesh(new THREE.PlaneGeometry(2 * hx, 2 * hz).rotateX(-Math.PI / 2), dirt, 0, 0.006, 0, false));
  const parts = new THREE.Group();
  const concrete = toon('#cfd3da');
  const slabFront = 3.7;
  parts.add(mesh(new THREE.BoxGeometry(2 * PLATE.halfX, 0.3, slabFront + PLATE.halfZ), concrete, 0, 0.15, (slabFront - PLATE.halfZ) / 2));
  const rust = toon('#8d5b4c');
  let k = 0;
  for (const x of [-14.6, -7.3, 0, 7.3, 14.6]) {
    for (const z of [-9.9, -3.3, 3.1]) {
      const h = 0.9 + ((k++ * 7) % 5) * 0.5;
      parts.add(mesh(new THREE.BoxGeometry(0.5, h, 0.5), concrete, x, 0.3 + h / 2, z));
      for (const [rx, rz] of [
        [-0.15, -0.15],
        [0.15, -0.15],
        [0.15, 0.15],
        [-0.15, 0.15],
      ])
        parts.add(mesh(new THREE.BoxGeometry(0.03, 0.7, 0.03), rust, x + rx, 0.3 + h + 0.35, z + rz, false));
    }
  }
  // The hoarding: white panels with a band of the business's color along the top, the street side
  // printed (below), the gate in the middle of it.
  const white = toon('#f4f1ea');
  const [front, ...rest] = hoardingWalls();
  for (const b of rest) {
    parts.add(mesh(new THREE.BoxGeometry(b.maxX - b.minX, HOARDING.height, b.maxZ - b.minZ), white, (b.minX + b.maxX) / 2, HOARDING.height / 2, (b.minZ + b.maxZ) / 2));
    parts.add(mesh(new THREE.BoxGeometry(b.maxX - b.minX + 0.02, 0.22, b.maxZ - b.minZ + 0.02), accent, (b.minX + b.maxX) / 2, HOARDING.height - 0.11, (b.minZ + b.maxZ) / 2, false));
  }
  const t = front.maxZ - front.minZ;
  const side = hx - GATE.width / 2;
  for (const s of [-1, 1]) {
    const tex = print(card, side, HOARDING.height, s < 0);
    textures.push(tex);
    const face = new THREE.MeshBasicMaterial({ map: tex });
    materials.push(face);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(side, HOARDING.height, t), [white, white, white, white, face, white]);
    panel.position.set(s * (GATE.width / 2 + side / 2), HOARDING.height / 2, hz - t / 2);
    own.add(panel);
  }
  // The gate: two leaves of steel mesh in a frame, the business's color along the top.
  const steel = toon('#8d99ae');
  const gw = GATE.width / 2;
  for (const s of [-1, 1]) {
    const cx = (s * gw) / 2;
    for (const dx of [-gw / 2 + 0.05, gw / 2 - 0.05]) parts.add(mesh(new THREE.BoxGeometry(0.1, 2.3, 0.1), steel, cx + dx, 1.15, hz - 0.08));
    for (const y of [0.1, 2.25]) parts.add(mesh(new THREE.BoxGeometry(gw, 0.1, 0.1), y > 1 ? accent : steel, cx, y, hz - 0.08));
  }
  const mesh2 = new THREE.MeshBasicMaterial({ map: kit.chain.clone(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  mesh2.map!.needsUpdate = true;
  mesh2.map!.repeat.set(GATE.width / 0.3, 2.1 / 0.3);
  textures.push(mesh2.map!);
  materials.push(mesh2);
  own.add(mesh(new THREE.PlaneGeometry(GATE.width - 0.2, 2.1), mesh2, 0, 1.17, hz - 0.08, false));
  const keep = textPlane('SITE ENTRANCE · HARD HATS ON', { bg: '#ffd166', color: INK, size: 44, border: INK });
  keep.scale.setScalar(0.7);
  keep.position.set(0, 1.6, hz - 0.02);
  textures.push(keep.material.map!);
  materials.push(keep.material);
  own.add(keep);

  // The site offices, two cabins stacked by the gate, with a stair up the side; pallets and steel.
  const lit = kit.glass.lit[1][0];
  cabin(parts, 11.5, 0, 9.3, 6.2, accent, lit);
  cabin(parts, 11.5, 2.55, 9.3, 6.2, accent, kit.glass.dark[1]);
  parts.add(mesh(new THREE.BoxGeometry(0.9, 0.08, 2.9), steel, 7.9, 2.5, 9.3, false));
  parts.add(mesh(new THREE.BoxGeometry(0.06, 1, 2.9), steel, 7.5, 3, 9.3, false));
  const sign = textPlane('SITE OFFICE', { color: inkOn('#f5f6f2'), size: 40 });
  sign.scale.setScalar(0.8);
  sign.position.set(11.5, 4.45, 9.3 + 1.23);
  textures.push(sign.material.map!);
  materials.push(sign.material);
  own.add(sign);
  const blocks = toon('#a9adb5');
  const pallet = toon('#c98b5a');
  for (const [x, z] of [
    [-6, 8],
    [-3.8, 8.6],
  ]) {
    parts.add(mesh(new THREE.BoxGeometry(1.2, 0.15, 1), pallet, x, 0.08, z));
    parts.add(mesh(new THREE.BoxGeometry(1.1, 0.8, 0.9), blocks, x, 0.55, z));
  }
  const beam = toon('#a4553f');
  for (let i = 0; i < 3; i++) parts.add(mesh(new THREE.BoxGeometry(6, 0.3, 0.3), beam, -12 + (i % 2) * 0.2, 0.15 + i * 0.3, 8 + i * 0.32));
  own.add(mergeByMaterial(parts));

  // Cones in front of the gate, out on the plot's lawn (where they stand in the street frame).
  const cones = new THREE.Group();
  const orange = toon('#ff7b29');
  const band = toon('#fffaf3');
  for (const { x, z } of conesOf(card.plot)) {
    cones.add(mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), orange, x, 0.025, z));
    cones.add(mesh(new THREE.ConeGeometry(0.17, 0.66, 12), orange, x, 0.38, z));
    cones.add(mesh(new THREE.CylinderGeometry(0.075, 0.105, 0.1, 12), band, x, 0.5, z, false));
  }
  group.add(mergeByMaterial(cones));

  // The tower crane, at the back of the plot (in the street frame: it isn't turned with the plot).
  const crane = buildCrane(kit);
  const at = craneAt(card.plot);
  crane.group.position.set(at.x, 0, at.z);
  group.add(crane.group);

  return {
    group,
    crane,
    dispose() {
      for (const tx of textures) tx.dispose();
      for (const m of materials) m.dispose();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
