import * as THREE from 'three';
import { PLOTS, plateBox, type Claimable } from '../../../shared/mainstreet';
import { canvasTexture } from '../texture';
import { mergeByMaterial, mesh, toon } from '../toon';
import { FONT, GREEN, INK, flatPaint } from './kit';
import { KERB, LEASE_BOARD } from './layout';

// A plot a business can claim, as it is whoever has it: mown lawn edged with a kerb. And while it's
// for lease, what says so: survey stakes with orange flags at its plate's corners, a string line
// between them where the walls would go, and a FOR LEASE board by the sidewalk facing the street.

/** Stripes of mown grass, `stripes` of them across the picture. */
function mown(stripes: number): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#93cd73' : '#a2d983';
      g.fillRect(0, (i * 128) / stripes, 128, 128 / stripes + 1);
    }
  });
}

/** Plot `plot`'s lawn and kerb, in the street frame (y 0 the street): the same whoever has it. */
export function buildLot(plot: Claimable): THREE.Group {
  const b = PLOTS[plot].box;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const group = new THREE.Group();
  const lawn = flatPaint('#ffffff');
  lawn.map = mown(2);
  lawn.map.wrapS = lawn.map.wrapT = THREE.RepeatWrapping;
  lawn.map.repeat.set(1, d / 8);
  // A touch over the street's own grass, and drawn over it.
  Object.assign(lawn, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const plane = mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), lawn, (b.minX + b.maxX) / 2, -0.02, (b.minZ + b.maxZ) / 2, false);
  plane.receiveShadow = true;
  group.add(plane);
  const kerb = new THREE.Group();
  const stone = toon('#e3ddd0');
  const { height: h, width: t } = KERB;
  kerb.add(mesh(new THREE.BoxGeometry(w, h, t), stone, (b.minX + b.maxX) / 2, h / 2, b.minZ + t / 2, false));
  kerb.add(mesh(new THREE.BoxGeometry(w, h, t), stone, (b.minX + b.maxX) / 2, h / 2, b.maxZ - t / 2, false));
  kerb.add(mesh(new THREE.BoxGeometry(t, h, d - 2 * t), stone, b.minX + t / 2, h / 2, (b.minZ + b.maxZ) / 2, false));
  kerb.add(mesh(new THREE.BoxGeometry(t, h, d - 2 * t), stone, b.maxX - t / 2, h / 2, (b.minZ + b.maxZ) / 2, false));
  group.add(mergeByMaterial(kerb));
  return group;
}

/** The FOR LEASE board's face: which plot, that it's for lease, and on Main Street. */
function leaseFace(plot: Claimable): THREE.CanvasTexture {
  const W = 1024;
  const H = Math.round((W * (LEASE_BOARD.high - LEASE_BOARD.low)) / LEASE_BOARD.width);
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#fffaf3';
    g.fillRect(0, 0, W, H);
    // A green band across the top: FOR LEASE.
    const band = H * 0.36;
    g.fillStyle = GREEN;
    g.fillRect(0, 0, W, band);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${band * 0.62}px ${FONT}`;
    g.fillText('FOR LEASE', W / 2, band / 2 + band * 0.04);
    // Which plot, and where.
    g.fillStyle = INK;
    g.font = `800 ${H * 0.3}px ${FONT}`;
    g.fillText(PLOTS[plot].name.toUpperCase(), W / 2, band + H * 0.21);
    g.font = `700 ${H * 0.1}px ${FONT}`;
    g.fillStyle = '#55555a';
    g.fillText('MAIN STREET · OFFICES 1 TO 8 STOREYS', W / 2, H * 0.88);
    g.lineWidth = 10;
    g.strokeStyle = INK;
    g.strokeRect(5, 5, W - 10, H - 10);
  });
}

/** What's for lease on a plot that is: in the street frame. `face` is the board's face, for what E is about when you look at it. */
export interface Lease {
  group: THREE.Group;
  face: THREE.Object3D;
  dispose(): void;
}

/** Plot `plot` while it's for lease: stakes at its plate's corners with a string line between, and its FOR LEASE board. */
export function buildLease(plot: Claimable): Lease {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const wood = toon('#c98b5a');
  const orange = toon('#ff7b29');
  const p = plateBox(plot);
  const corners: [number, number][] = [
    [p.minX, p.minZ],
    [p.maxX, p.minZ],
    [p.maxX, p.maxZ],
    [p.minX, p.maxZ],
  ];
  corners.forEach(([x, z], i) => {
    parts.add(mesh(new THREE.BoxGeometry(0.07, 1.1, 0.07), wood, x, 0.55, z));
    parts.add(mesh(new THREE.BoxGeometry(0.075, 0.18, 0.075), orange, x, 1.0, z, false));
    // A flag off the top, and the string to the next stake.
    parts.add(mesh(new THREE.BoxGeometry(0.34, 0.22, 0.012), orange, x + 0.2, 0.95, z, false));
    const [nx, nz] = corners[(i + 1) % 4];
    const len = Math.hypot(nx - x, nz - z);
    const line = mesh(new THREE.BoxGeometry(0.018, 0.018, len), orange, (x + nx) / 2, 0.35, (z + nz) / 2, false);
    line.rotation.y = Math.atan2(nx - x, nz - z);
    parts.add(line);
  });
  // The board, on two posts, its face toward the street.
  const { x, z, rotY } = PLOTS[plot].board!;
  const sign = new THREE.Group();
  const post = toon('#3d405b');
  for (const sx of [-1, 1]) sign.add(mesh(new THREE.BoxGeometry(0.12, LEASE_BOARD.high + 0.1, 0.12), post, sx * LEASE_BOARD.posts, (LEASE_BOARD.high + 0.1) / 2, -0.09));
  const h = LEASE_BOARD.high - LEASE_BOARD.low;
  sign.add(mesh(new THREE.BoxGeometry(LEASE_BOARD.width, h, 0.08), toon('#fffaf3'), 0, LEASE_BOARD.low + h / 2, 0));
  sign.position.set(x, 0, z);
  sign.rotation.y = rotY;
  parts.add(sign);
  group.add(mergeByMaterial(parts));
  const tex = leaseFace(plot);
  const face = mesh(new THREE.PlaneGeometry(LEASE_BOARD.width - 0.04, h - 0.04), new THREE.MeshBasicMaterial({ map: tex }), 0, LEASE_BOARD.low + h / 2, 0.045, false);
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  holder.rotation.y = rotY;
  holder.add(face);
  group.add(holder);
  return {
    group,
    face: holder,
    dispose() {
      tex.dispose();
      (face.material as THREE.Material).dispose();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}
