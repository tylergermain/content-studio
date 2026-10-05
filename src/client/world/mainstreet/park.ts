import * as THREE from 'three';
import { PARK } from '../../../shared/mainstreet';
import type { BusinessCard } from '../../../shared/protocol';
import { canvasTexture } from '../texture';
import { mergeByMaterial, mesh, textPlane, toon } from '../toon';
import { buildHeliport } from './heliport';
import { GREEN, INK, flatPaint, type StreetKit } from './kit';
import { BENCH, PATH } from './layout';
import { paintStreetMap } from './mapboard';

// Friday Park (P5) as Main Street adds to it: golf's hole 1 is the green fixture's, as it always was
// (features/golf/world.ts). Round it, Friday One's heliport with its floodlight and windsock (see
// heliport.ts), the gravel path in to the pad from the sidewalk, two benches looking over the green,
// a sign at the path's end, and the map of Main Street by the sidewalk, facing the street.

/** The map board's face, in px. */
const MAP_W = 1200;
const MAP_H = 800;

export interface Park {
  group: THREE.Group;
  /** The map board, for what E is about when you look at it. */
  board: THREE.Object3D;
  /** Paints the map with `cards` on their plots. */
  repaint(cards: readonly BusinessCard[]): void;
  /** The windsock, `t` in seconds. */
  update(t: number): void;
}

/**
 * Friday Park's heliport, path, benches, sign and map board, in the street frame (y 0 the street).
 * With `lamps`, the floodlight and the map board's light are lamps at night (`base` is the street's y
 * where the night's lamps are kept); the roof bar's copy has none.
 */
export function buildPark(kit: StreetKit, lamps: { base: number } | null): Park {
  const group = new THREE.Group();
  const heliport = buildHeliport(kit, lamps);
  group.add(heliport.group);

  // The path, gravel, under the edge of the pad at its far end.
  const gravel = flatPaint('#ddd2bd');
  Object.assign(gravel, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  group.add(mesh(new THREE.PlaneGeometry(PATH.maxX - PATH.minX, PATH.maxZ - PATH.minZ).rotateX(-Math.PI / 2), gravel, (PATH.minX + PATH.maxX) / 2, 0.004, (PATH.minZ + PATH.maxZ) / 2, false));

  const parts = new THREE.Group();
  // The benches, facing west over the path to the green: slats on two iron frames.
  const wood = toon('#c98b5a');
  const iron = toon('#3d405b');
  for (const { x, z } of PARK.benches) {
    const b = new THREE.Group();
    for (let i = 0; i < 3; i++) b.add(mesh(new THREE.BoxGeometry(0.15, 0.05, BENCH.length), wood, -0.2 + i * 0.17, BENCH.seat, 0));
    for (let i = 0; i < 2; i++) b.add(mesh(new THREE.BoxGeometry(0.04, 0.12, BENCH.length), wood, 0.3, BENCH.seat + 0.2 + i * 0.18, 0));
    for (const dz of [-0.7, 0.7]) {
      b.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), iron, 0, BENCH.seat - 0.04, dz));
      for (const dx of [-0.2, 0.22]) b.add(mesh(new THREE.BoxGeometry(0.05, BENCH.seat, 0.05), iron, dx, BENCH.seat / 2, dz));
      b.add(mesh(new THREE.BoxGeometry(0.05, BENCH.back - BENCH.seat + 0.05, 0.05), iron, 0.3, (BENCH.seat + BENCH.back) / 2, dz));
    }
    b.position.set(x, 0, z);
    parts.add(b);
  }

  // A sign where the path leaves the sidewalk.
  const sx = PATH.minX - 1.1;
  const sz = PATH.minZ + 0.8;
  parts.add(mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), iron, sx, 0.8, sz));
  group.add(mergeByMaterial(parts));
  const pointer = textPlane('🚁 Heliport · Friday One', { bg: INK, color: '#fffaf3', size: 48, border: GREEN });
  pointer.scale.setScalar(0.55);
  pointer.position.set(sx, 1.45, sz - 0.07);
  pointer.rotation.y = Math.PI;
  group.add(pointer);

  // The map board: a frame on two legs, a hood over it with its lamps, the map facing the street.
  const { x, z, rotY, width, height } = PARK.board;
  const board = new THREE.Group();
  board.position.set(x, 0, z);
  board.rotation.y = rotY;
  const frame = new THREE.Group();
  const low = 0.8;
  for (const sx2 of [-1, 1]) frame.add(mesh(new THREE.BoxGeometry(0.12, low + height + 0.25, 0.12), iron, sx2 * (width / 2 + 0.06), (low + height + 0.25) / 2, -0.06));
  frame.add(mesh(new THREE.BoxGeometry(width + 0.24, height + 0.16, 0.08), toon(INK), 0, low + height / 2, -0.06));
  frame.add(mesh(new THREE.BoxGeometry(width + 0.4, 0.06, 0.5), iron, 0, low + height + 0.25, 0.1));
  for (const sx2 of [-0.9, 0.9]) frame.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), kit.lens, sx2, low + height + 0.18, 0.28, false));
  board.add(mergeByMaterial(frame));
  const tex = canvasTexture(MAP_W, MAP_H);
  const face = mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex }), 0, low + height / 2, -0.015, false);
  board.add(face);
  group.add(board);
  if (lamps) {
    // Its light, from the hood: in front of it, a little over a head.
    const lx = x + Math.sin(rotY) * 0.7;
    const lz = z + Math.cos(rotY) * 0.7;
    kit.night.lamps.push({ x: lx, y: lamps.base + low + height + 0.1, z: lz, reach: 4.5, color: '#fff1d6', power: 2.6, ground: true });
    kit.night.halos.push({ at: new THREE.Vector3(x + Math.sin(rotY) * 0.28, lamps.base + low + height + 0.18, z + Math.cos(rotY) * 0.28), size: 1.1, color: '#fff1d6', ground: true });
  }

  const repaint = (cards: readonly BusinessCard[]) => {
    paintStreetMap((tex.image as HTMLCanvasElement).getContext('2d')!, MAP_W, MAP_H, cards);
    tex.needsUpdate = true;
  };
  repaint([]);

  return { group, board, repaint, update: (t) => heliport.update(t) };
}
