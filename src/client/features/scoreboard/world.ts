import * as THREE from 'three';
import { FLOOR } from '../../../shared/layout';
import type { Fixture } from '../../world/office/fixture';
import type { Interactable } from '../../world/types';
import { mesh, toon } from '../../world/toon';
import { FACE_H, FACE_W, paintFace, type FaceView } from './paint';

/**
 * The scoreboard on the west wall beside the hoop, between it and the exit door: its face is BOARD.w
 * by BOARD.h meters, its middle BOARD.y up, at BOARD.z along the wall.
 */
export const BOARD = { z: 8.3, y: 3.1, w: 1.8, h: (1.8 * FACE_H) / FACE_W } as const;
/** How far it stands off the wall. */
const DEPTH = 0.1;
/** Where you stand to use it in third person, and how near that you have to be. */
const USE = { out: 2.4, radius: 2.6 } as const;

export interface ScoreboardView {
  /** Paints its face, when what it shows has changed. */
  show(v: FaceView): void;
  /** What you aim at (or stand by) to use it. */
  readonly interactable: Interactable;
  /** Down with the hoop on this floor (the office builder took it off). */
  readonly away: boolean;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The longest-shots board beside the hoop (see features/scoreboard). */
    scoreboard: ScoreboardView;
  }
}

/** The scoreboard: up with the hoop and down with it (it's built after it, and follows it). */
export const scoreboard: Fixture<'scoreboard'> = (site) => {
  const hoop = site.get('hoop');
  const group = new THREE.Group();
  const { z, y, w, h } = BOARD;
  const wall = FLOOR.minX;

  // The housing: a dark box off the wall, with a strip of Friday Labs green along its top and bottom.
  const housing = mesh(new THREE.BoxGeometry(DEPTH, h + 0.16, w + 0.16), toon('#161925'), wall + DEPTH / 2, y, z);
  group.add(housing);
  const green = toon('#09CA59', { emissive: '#09CA59' });
  for (const s of [-1, 1]) group.add(mesh(new THREE.BoxGeometry(0.03, 0.035, w + 0.16), green, wall + DEPTH + 0.006, y + s * (h / 2 + 0.06), z, false));

  // The face: lit, so it reads from across the court.
  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const paint = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  face.rotation.y = Math.PI / 2;
  face.position.set(wall + DEPTH + 0.003, y, z);
  group.add(face);

  const interactable: Interactable = { kind: 'scoreboard', x: wall + USE.out, y: 0, z, radius: USE.radius };
  face.userData.interact = interactable;
  housing.userData.interact = interactable;
  const mark = site.wall('west', z, y, w + 0.4, h + 0.4);

  let shown = '';
  const view: ScoreboardView = {
    show(v) {
      const k = JSON.stringify(v);
      if (k === shown) return;
      shown = k;
      paintFace(paint, v);
      tex.needsUpdate = true;
    },
    interactable,
    get away() {
      return hoop.away;
    },
  };
  return {
    group,
    interactables: [interactable],
    update() {
      const away = hoop.away;
      group.visible = !away;
      interactable.off = away;
      mark.off = away;
    },
    handle: { scoreboard: view },
  };
};
