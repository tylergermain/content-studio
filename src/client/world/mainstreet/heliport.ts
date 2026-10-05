import * as THREE from 'three';
import { PARK } from '../../../shared/mainstreet';
import { canvasTexture } from '../texture';
import { mergeByMaterial, mesh, toon } from '../toon';
import { FONT, GREEN, flatPaint, type StreetKit } from './kit';
import { FLOOD, floodLamp } from './layout';

// Friday One's heliport in Friday Park (PARK.pad): a round concrete deck a step high that you walk up
// onto, painted with a green ring, a white H and FRIDAY ONE, with eight green lights round its edge
// that glow at night and take no lamp (they're only bright paint: see bulb). Its floodlight stands
// off its edge, leaning over it, and its windsock further out.

/** The deck's top: concrete, a white edge, the green ring, the H, and FRIDAY ONE, reading from the street. */
function deckFace(): THREE.CanvasTexture {
  const S = 1024;
  return canvasTexture(S, S, (g) => {
    const c = S / 2;
    g.fillStyle = '#c9c6bf';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = S * 0.018;
    g.strokeStyle = '#fffaf3';
    g.beginPath();
    g.arc(c, c, c * 0.97, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = S * 0.05;
    g.strokeStyle = GREEN;
    g.beginPath();
    g.arc(c, c, c * 0.84, 0, Math.PI * 2);
    g.stroke();
    // The H: two uprights and the bar across.
    g.fillStyle = '#fffaf3';
    const hw = S * 0.28;
    const hh = S * 0.4;
    const t = S * 0.075;
    g.fillRect(c - hw / 2, c - hh / 2 - S * 0.05, t, hh);
    g.fillRect(c + hw / 2 - t, c - hh / 2 - S * 0.05, t, hh);
    g.fillRect(c - hw / 2, c - t / 2 - S * 0.05, hw, t);
    g.font = `800 ${S * 0.085}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('FRIDAY ONE', c, c + S * 0.25);
  });
}

export interface Heliport {
  group: THREE.Group;
  /** The windsock swinging in the breeze, `t` in seconds. */
  update(t: number): void;
}

/**
 * The heliport, the floodlight and the windsock, in the street frame (y 0 the street). With `lamps`,
 * the floodlight lights the pad at night (its lamp and halo pushed with `base` added to their heights:
 * the street's y in the frame the night's lamps are in); the roof bar's copy has none of its own.
 */
export function buildHeliport(kit: StreetKit, lamps: { base: number } | null): Heliport {
  const group = new THREE.Group();
  const { x, z, r, deck } = PARK.pad;
  const parts = new THREE.Group();
  const concrete = toon('#bdbab3');
  // Its edge (the painted face below is its top).
  parts.add(mesh(new THREE.CylinderGeometry(r, r + 0.06, deck, 48, 1, true), concrete, x, deck / 2, z));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    parts.add(mesh(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), kit.edge, x + Math.cos(a) * (r - 0.25), deck, z + Math.sin(a) * (r - 0.25), false));
  }
  // The floodlight: a pole off the pad's edge, its lamp leaning out over the pad.
  const { flood } = PARK;
  const lamp = floodLamp();
  const ink = toon('#3d405b');
  parts.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 10), ink, flood.x, 0.2, flood.z));
  parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, FLOOD.height, 8), ink, flood.x, FLOOD.height / 2, flood.z));
  const arm = mesh(new THREE.BoxGeometry(0.08, 0.08, FLOOD.lean + 0.2), ink, (flood.x + lamp.x) / 2, FLOOD.height - 0.05, (flood.z + lamp.z) / 2);
  arm.rotation.y = Math.atan2(lamp.x - flood.x, lamp.z - flood.z);
  parts.add(arm);
  const head = new THREE.Group();
  head.add(mesh(new THREE.BoxGeometry(0.6, 0.22, 0.42), ink, 0, 0, 0));
  head.add(mesh(new THREE.BoxGeometry(0.5, 0.04, 0.34), kit.lens, 0, -0.12, 0, false));
  head.position.set(lamp.x, lamp.h + 0.12, lamp.z);
  head.rotation.y = arm.rotation.y;
  head.rotation.x = 0.35;
  parts.add(head);
  group.add(mergeByMaterial(parts));

  const face = deckFace();
  const top = flatPaint('#ffffff');
  top.map = face;
  const disc = mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), top, x, deck, z, false);
  // Turned half round, so FRIDAY ONE reads from the street and the tower.
  disc.rotation.y = Math.PI;
  disc.receiveShadow = true;
  group.add(disc);
  if (lamps) {
    kit.night.lamps.push({ x: lamp.x, y: lamps.base + lamp.h, z: lamp.z, reach: flood.reach, color: '#fff1d0', power: 3.4, ground: true });
    kit.night.halos.push({ at: new THREE.Vector3(lamp.x, lamps.base + lamp.h - 0.05, lamp.z), size: 2.2, color: '#fff1d0', ground: true });
  }

  // The windsock: a striped pole, and the sock off the top of it, swinging round with the breeze.
  const sock = PARK.windsock;
  const pole = new THREE.Group();
  const white = toon('#fffaf3');
  const red = toon('#ef476f');
  for (let k = 0; k < 5; k++) pole.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, sock.pole / 5, 8), k % 2 ? red : white, sock.x, (k + 0.5) * (sock.pole / 5), sock.z));
  group.add(mergeByMaterial(pole));
  const swivel = new THREE.Group();
  swivel.position.set(sock.x, sock.pole - 0.25, sock.z);
  const cone = new THREE.Group();
  const orange = toon('#ff7b29');
  // Stripes from the mouth (wide, at the pole) to the tail, along +x.
  for (let k = 0; k < 5; k++) {
    const r0 = 0.34 - k * 0.045;
    const seg = mesh(new THREE.CylinderGeometry(r0 - 0.045, r0, 0.36, 14, 1, true), k % 2 ? white : orange, 0.2 + k * 0.36 + 0.18, 0, 0, false);
    seg.rotation.z = -Math.PI / 2;
    cone.add(seg);
  }
  cone.add(mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 16).rotateY(Math.PI / 2), ink, 0.2, 0, 0, false));
  const sockMesh = mergeByMaterial(cone);
  swivel.add(sockMesh);
  group.add(swivel);

  return {
    group,
    update(t) {
      // Mostly out of the west, veering a little, and filling out and drooping as the gusts come and go.
      swivel.rotation.y = 0.6 + Math.sin(t * 0.23) * 0.35 + Math.sin(t * 1.7) * 0.05;
      sockMesh.rotation.z = -0.25 - 0.2 * (0.5 + 0.5 * Math.sin(t * 0.61 + 1));
    },
  };
}
