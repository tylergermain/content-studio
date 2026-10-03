/**
 * A game of PIG, in the room: a ring of light on the floor where the follower has to match the
 * leader's shot from, and each player's letters over their head.
 */
import * as THREE from 'three';
import { MATCH_R, PIG_WORD, type PigState } from '../../../shared/pig';

const GREEN = '#09CA59';
const RED = '#FF4D5E';
/** How high over someone's feet their letters float: over their name tag. */
const TAG_Y = 2.48;

function glow(mat: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  mat.userData.outlineParameters = { visible: false };
  return mat;
}

/** Fading from `color` at the bottom to nothing at the top, for the column of light over the ring. */
function fadeUp(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A player's letters, as a tag: P I G, the ones they have lit red, and a green edge while it's their shot. */
function tagTexture(letters: number, up: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 84;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10, 11, 18, 0.88)';
  g.strokeStyle = up ? GREEN : '#2b2d42';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(4, 4, 248, 76, 36);
  g.fill();
  g.stroke();
  g.font = '700 50px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let k = 0; k < PIG_WORD.length; k++) {
    const lit = k < letters;
    g.fillStyle = lit ? RED : '#3A4152';
    g.shadowColor = RED;
    g.shadowBlur = lit ? 12 : 0;
    g.fillText(PIG_WORD[k], 68 + k * 60, 45);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PigMarks {
  readonly group = new THREE.Group();
  private ring = new THREE.Group();
  private tags = new Map<string, { sprite: THREE.Sprite; key: string }>();
  private tmp = new THREE.Vector3();

  constructor() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(MATCH_R - 0.07, MATCH_R, 56), glow(new THREE.MeshBasicMaterial({ color: GREEN })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(MATCH_R - 0.07, 48), glow(new THREE.MeshBasicMaterial({ color: GREEN, opacity: 0.16 })));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.02;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(MATCH_R, MATCH_R, 1.4, 40, 1, true), glow(new THREE.MeshBasicMaterial({ map: fadeUp(GREEN), side: THREE.DoubleSide, opacity: 0.55 })));
    column.position.y = 0.7;
    this.ring.add(ring, disc, column);
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  /**
   * Each frame: the ring where the follower matches from (while there's a shot to match), and the
   * letters over each player's head (`feetOf` says where they stand, or null when they're out of view).
   */
  update(pig: PigState | null, t: number, feetOf: (id: string, out: THREE.Vector3) => THREE.Vector3 | null) {
    const spot = pig && pig.winner === null ? pig.spot : null;
    this.ring.visible = !!spot;
    if (spot) {
      this.ring.position.set(spot.x, 0, spot.z);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      this.ring.scale.setScalar(1 + pulse * 0.05);
      for (const m of this.ring.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]) m.material.opacity = (m.userData.base ??= m.material.opacity) * (0.65 + 0.35 * pulse);
    }
    const on = new Set<string>();
    pig?.players.forEach((p, i) => {
      const at = feetOf(p.id, this.tmp);
      if (!at) return;
      on.add(p.id);
      const up = pig.winner === null && pig.turn === i;
      const key = `${p.letters}|${up}`;
      let tag = this.tags.get(p.id);
      if (!tag || tag.key !== key) {
        if (tag) this.drop(p.id);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture(p.letters, up), depthWrite: false, transparent: true }));
        sprite.scale.set(0.62, 0.2, 1);
        sprite.renderOrder = 10;
        this.group.add(sprite);
        this.tags.set(p.id, (tag = { sprite, key }));
      }
      tag.sprite.position.set(at.x, at.y + TAG_Y + (up ? Math.sin(t * 5) * 0.03 : 0), at.z);
    });
    for (const id of [...this.tags.keys()]) if (!on.has(id)) this.drop(id);
  }

  private drop(id: string) {
    const tag = this.tags.get(id);
    if (!tag) return;
    this.group.remove(tag.sprite);
    tag.sprite.material.map?.dispose();
    tag.sprite.material.dispose();
    this.tags.delete(id);
  }
}
