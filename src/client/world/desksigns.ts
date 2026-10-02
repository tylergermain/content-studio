import * as THREE from 'three';
import { DESKS, DESK_BY_ID, DESK_SIZE, WALL_HEIGHT, WING_DESKS, type DeskDef } from '../../shared/layout';
import { signInk, type DeskLabel, type RoomOptions } from '../../shared/floorplan';
import { onDeck } from '../../shared/mezzanine';
import type { Fixture } from './office/fixture';
import { mergeByMaterial, mesh, roundedBox, toon } from './toon';

// Big signs hung from the ceiling over the desks, naming what each one is for ("Operations", "Code
// cleanup"), so you can tell from across the room where to look (see shared/floorplan.ts). Each
// hangs over the far edge of its desk, facing the chair: stand behind whoever sits there and it's
// over their laptop. Desks come in back-to-back pairs, so a pair's two signs hang back to back too,
// and from either side you read the one for the desk on that side; while the other desk has none,
// the sign says the same on its back.

/** How big a sign is, how high its middle hangs, and how far apart its two cords are. */
export const SIGN = { width: 1.9, height: 0.62, depth: 0.04, y: 3.35, cords: 1.3 } as const;

const PX = 1024;

/**
 * Whether the sign over `desk` would come through the room's upstairs. A sign hangs from the ceiling
 * to just above head height, which is where a deck's floor is: so not over a desk that stands under
 * the deck (the big mezzanine's, or the corner loft's), nor where the sign's own board, off the desk's
 * far edge, would be over it.
 */
export function signThroughDeck(room: RoomOptions, desk: Pick<DeskDef, 'x' | 'z' | 'rotY'>): boolean {
  if (onDeck(room, desk.x, desk.z)) return true;
  const sin = Math.sin(desk.rotY);
  const cos = Math.cos(desk.rotY);
  const z = -DESK_SIZE.depth / 2;
  return [-SIGN.width / 2, 0, SIGN.width / 2].some((x) => onDeck(room, desk.x + x * cos + z * sin, desk.z - x * sin + z * cos));
}

/** The current partner across a back-to-back pair, after a layout edit. */
function partner(id: string): string | undefined {
  const desks = [...DESKS, ...WING_DESKS];
  const d = desks.find(d => d.id === id);
  if (!d) return;
  return desks.find(e => e !== d && Math.hypot(e.x - d.x + Math.sin(d.rotY) * DESK_SIZE.depth, e.z - d.z + Math.cos(d.rotY) * DESK_SIZE.depth) < 0.02 && Math.abs(Math.cos(e.rotY - d.rotY) + 1) < 0.01)?.id;
}
const FONT = (size: number) => `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;

/** The text, as large as fits on one line, else on two. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxH: number): { lines: string[]; size: number } {
  const words = text.split(' ');
  for (let size = 200; size >= 64; size -= 6) {
    ctx.font = FONT(size);
    if (size * 1.05 <= maxH && ctx.measureText(text).width <= maxW) return { lines: [text], size };
    if (words.length < 2 || size * 2.1 > maxH) continue;
    // Split at the space that leaves the longer line shortest.
    let best: string[] | null = null;
    let bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (w < bestW) {
        bestW = w;
        best = lines;
      }
    }
    if (best && bestW <= maxW) return { lines: best, size };
  }
  return { lines: [text], size: 64 };
}

/** The sign's face: its paint, a line round the edge, and the text in the middle. */
function paintFace(canvas: HTMLCanvasElement, label: DeskLabel) {
  const w = PX;
  const h = Math.round((PX * SIGN.height) / SIGN.width);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ink = signInk(label.color);
  ctx.fillStyle = label.color;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.roundRect(22, 22, w - 44, h - 44, 34);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const { lines, size } = fit(ctx, label.text, w - 120, h - 70);
  ctx.font = FONT(size);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = size * 1.02;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh + size * 0.04));
}

interface Hung {
  root: THREE.Group;
  key: string;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  label: DeskLabel;
}

export interface DeskSigns {
  group: THREE.Group;
  /** Hangs a sign for each of `labels`, over the desks `built` says are there (the back office's may not be yet). */
  set(labels: Record<string, DeskLabel>, built: (desk: DeskDef) => boolean): void;
  /** The sign over a desk, if it has one. */
  get(deskId: string): THREE.Object3D | undefined;
  /** Shows the signs that hang clear where their desks stand now, and hides the rest (see `hidden`). */
  show(): void;
}

/** `hidden` says which desks go without their sign for now, whatever their label: where it has nowhere to hang. */
export function buildDeskSigns(hidden: (desk: DeskDef) => boolean = () => false): DeskSigns {
  const group = new THREE.Group();
  const hung = new Map<string, Hung>();
  /** Which desks are there, as the last `set` had it. */
  let there: (desk: DeskDef) => boolean = () => true;
  const cordMat = toon('#2b2d42');

  const make = (desk: DeskDef, label: DeskLabel, back: boolean): Hung => {
    const root = new THREE.Group();
    root.position.set(desk.x, 0, desk.z);
    root.rotation.y = desk.rotY;
    // Just off the far edge of the desk, so a back-to-back pair's signs don't touch.
    const z = -DESK_SIZE.depth / 2 + SIGN.depth / 2 + 0.012;
    const parts = new THREE.Group();
    const board = mesh(roundedBox(SIGN.width, SIGN.depth, SIGN.height, 0.08), toon(label.color), 0, SIGN.y, z, false);
    board.rotation.x = Math.PI / 2;
    parts.add(board);
    const top = SIGN.y + SIGN.height / 2;
    for (const sx of [-1, 1]) {
      const x = (sx * SIGN.cords) / 2;
      parts.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, WALL_HEIGHT - top, 5), cordMat, x, (WALL_HEIGHT + top) / 2, z, false));
      parts.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), cordMat, x, WALL_HEIGHT - 0.015, z, false));
      parts.add(mesh(new THREE.SphereGeometry(0.028, 8, 6), cordMat, x, top + 0.01, z, false));
    }
    root.add(mergeByMaterial(parts));
    const canvas = document.createElement('canvas');
    paintFace(canvas, label);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.width - 0.06, SIGN.height - 0.06), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, SIGN.y, z + SIGN.depth / 2 + 0.003);
    root.add(face);
    if (back) {
      const rear = new THREE.Mesh(face.geometry.clone(), face.material);
      rear.position.set(0, SIGN.y, z - SIGN.depth / 2 - 0.003);
      rear.rotation.y = Math.PI;
      root.add(rear);
    }
    group.add(root);
    return { root, key: keyOf(label, back), canvas, tex, label };
  };

  const keyOf = (label: DeskLabel, back: boolean) => `${label.text}|${label.color}|${back}`;
  const drop = (h: Hung) => {
    h.root.removeFromParent();
    h.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      if (m.material instanceof THREE.MeshBasicMaterial) m.material.dispose();
    });
    h.tex.dispose();
  };
  /** Whether the sign over `id` says it on its back too: its partner across the pair has no sign of its own there. */
  const twoSided = (id: string, labels: Record<string, DeskLabel>, built: (desk: DeskDef) => boolean) => {
    const other = partner(id);
    const desk = other ? DESK_BY_ID.get(other) : undefined;
    return !!desk && built(desk) && !labels[desk.id];
  };

  // The office's font may still be on its way the first time a sign is painted.
  void document.fonts?.ready.then(() => {
    for (const h of hung.values()) {
      paintFace(h.canvas, h.label);
      h.tex.needsUpdate = true;
    }
  });

  const show = () => {
    for (const [id, h] of hung) {
      const desk = DESK_BY_ID.get(id);
      h.root.visible = !!desk && there(desk) && !hidden(desk);
    }
  };

  return {
    group,
    get: (deskId) => hung.get(deskId)?.root,
    show,
    set(labels, built) {
      there = built;
      for (const [id, h] of hung) {
        const l = labels[id];
        if (l && keyOf(l, twoSided(id, labels, built)) === h.key) continue;
        drop(h);
        hung.delete(id);
      }
      for (const [id, label] of Object.entries(labels)) {
        const desk = DESK_BY_ID.get(id);
        if (!desk) continue;
        if (!hung.has(id)) hung.set(id, make(desk, label, twoSided(id, labels, built)));
      }
      show();
    },
  };
}

declare module './types' {
  interface OfficeHandles {
    /** The signs hung over the desks (see shared/floorplan.ts). */
    signs: DeskSigns;
  }
}

/**
 * The signs over the desks. One whose desk stands under the floor's upstairs is put away (see
 * signThroughDeck): looked at every frame, since the room can change and the office builder moves a
 * desk, sign and all, without a word to the signs.
 */
export const signs: Fixture<'signs'> = (site) => {
  const room = site.get('room');
  const built = buildDeskSigns((desk) => signThroughDeck(room.get(), desk));
  return { group: built.group, handle: { signs: built }, update: () => built.show() };
};
