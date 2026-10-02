import * as THREE from 'three';
import { wallFacing } from '../../../shared/decor';
import { FLOOR, MEETING_LAPTOP, MEETING_SEATS, TV, deskSeat, type DeskDef } from '../../../shared/layout';
import { MEETING_KINDS, meetingPlace, type MeetingKind, type MeetingPlace } from '../../../shared/meeting-place';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, DeskView, Interactable } from '../types';
import { keep, type Site, type WallMark } from './fixture';
import { PALETTE, box } from './materials';
import { wallBoard } from './props';
import { chair } from './seats';

// Where a floor's workers meet, as it stands in the room: the glass room's table, the stage with its
// panel table in front of the TV, or the anchor desk with its prompter. shared/meeting-place.ts says
// where everything of each is, for the rules and the paths too; this builds all three once and shows
// the one the floor has. The five chairs, the board, the sign and what you use each by are the same
// ones on every floor, stood where its place has them. The glass round the first is meeting-room.ts's,
// which calls this.

/** What the stage and the Steps facing it are made of (see steps.ts), and the anchor desk's top: the studio tables' oak. */
const CHARCOAL = '#101112';
const OAK = '#c9a36b';
/** How high the stage's platform stands. It's there to look at: nothing's in the way of walking onto it, and its table and chairs stand on it. */
const STAGE = 0.06;
/** A camera's body, the glass of its lens and its red light, as the studio's cameras have them (furniture-studio.ts). */
const CAMERA = { body: '#4a4e69', lens: '#7fb7e6', tally: '#ef476f' } as const;

/** Each place as the shared code has it. */
const PLACES = Object.fromEntries(MEETING_KINDS.map((kind) => [kind, meetingPlace({ meeting: kind })])) as Record<MeetingKind, MeetingPlace>;

/** One place's own furniture, built where it stands and shown on a floor that meets there. */
interface Setting {
  group: THREE.Group;
  /** Its table, which a meeting's called from. */
  table: THREE.Object3D;
  /** What the board stands on, where it isn't on a wall: used as the board is. */
  stand?: THREE.Object3D;
  /** How far over the office's floor its own is: what its chairs stand on. */
  lift: number;
  /** What's in the way with it, besides its table. */
  solids: Collider[];
  /** The wall it takes (see Site.wall). */
  marks: WallMark[];
}

/** Something lit that never falls into shadow: a light strip, a footlight. */
const lit = () => toon('#fff7d6', { emissive: '#ffe08a' });
/** The name over a place, as the glass room has it over its door. */
const nameplate = (text: string) => textPlane(text, { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
/** A collider over a rectangle of the floor, up to `top`. */
const solid = ([minX, maxX, minZ, maxZ]: readonly [number, number, number, number], top: number): Collider => ({ minX, maxX, minZ, maxZ, top });
const tableRect = (t: MeetingPlace['table']) => [t.x - t.width / 2, t.x + t.width / 2, t.z - t.depth / 2, t.z + t.depth / 2] as const;
/** The stretch of wall behind a board that hangs on one. */
function boardMark(site: Site, b: MeetingPlace['board']): WallMark {
  const wall = wallFacing(b.rotY);
  return site.wall(wall, wall === 'north' || wall === 'south' ? b.x : b.z, b.y, b.width + 0.4, b.height + 0.4);
}

/** The glass room's: a long table on two pedestals, and the board on the wall behind it. */
function boardroom(site: Site, place: MeetingPlace): Setting {
  const t = place.table;
  const table = new THREE.Group();
  table.add(mesh(roundedBox(t.width, 0.08, t.depth, 0.1), toon(PALETTE.wood), 0, t.height - 0.04, 0));
  for (const sx of [-1, 1]) {
    table.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, t.height - 0.08, 10), toon(PALETTE.deskLeg), sx * (t.width / 2 - 0.7), (t.height - 0.08) / 2, 0));
    table.add(mesh(roundedBox(0.9, 0.05, 0.8, 0.05), toon(PALETTE.deskLeg), sx * (t.width / 2 - 0.7), 0.025, 0));
  }
  table.position.set(t.x, 0, t.z);
  const group = new THREE.Group();
  group.add(table);
  return { group, table, lift: 0, solids: [], marks: [boardMark(site, place.board)] };
}

/**
 * The stage: a low charcoal platform across the front of the lounge, edged in the floor's trim with a
 * row of footlights, the panel's long table on it with a skirt toward the audience and a microphone
 * between each two places, and the TV behind them set in a backdrop from the platform up past its
 * top, with the stage's name over it.
 */
function stage(site: Site, place: MeetingPlace): Setting {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const dark = toon(CHARCOAL);
  const trim = site.looks.trim;
  const [minX, , minZ, maxZ] = place.area;

  // The platform, from just clear of the Steps' first riser to the wall, its three open edges in trim.
  const x0 = minX + 0.02;
  const w = FLOOR.maxX - x0;
  const d = maxZ - minZ;
  const cx = x0 + w / 2;
  const cz = (minZ + maxZ) / 2;
  parts.add(mesh(box(w, STAGE, d), dark, cx, STAGE / 2, cz));
  const NOSE = 0.1;
  const PROUD = 0.006;
  parts.add(mesh(box(NOSE, STAGE + PROUD, d + 2 * PROUD), trim, x0 + NOSE / 2 - PROUD, (STAGE + PROUD) / 2, cz, false));
  for (const s of [-1, 1]) parts.add(mesh(box(w - NOSE, STAGE + PROUD, NOSE), trim, cx + NOSE / 2, (STAGE + PROUD) / 2, cz + s * (d / 2 - NOSE / 2 + PROUD), false));
  for (let i = -2; i <= 2; i++) parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 12), lit(), x0 + 0.34, STAGE + 0.02, cz + i * 1.3, false));

  // The backdrop on the wall the TV hangs on: a dark panel behind it, a plinth under it and a header
  // over it, a strip of light down either side.
  const frame = { z: TV.width / 2 + 0.15, y0: TV.y - TV.height / 2 - 0.15, y1: TV.y + TV.height / 2 + 0.15 };
  const wide = 2 * frame.z + 0.14;
  const top = frame.y1 + 0.62;
  const DEEP = 0.3;
  parts.add(mesh(box(0.04, top - STAGE, wide), dark, FLOOR.maxX - 0.025, (top + STAGE) / 2, TV.z, false));
  parts.add(mesh(box(DEEP, frame.y0 - 0.01 - STAGE, wide), dark, FLOOR.maxX - DEEP / 2, (frame.y0 - 0.01 + STAGE) / 2, TV.z));
  parts.add(mesh(box(DEEP, top - frame.y1 - 0.02, wide), dark, FLOOR.maxX - DEEP / 2, (top + frame.y1 + 0.02) / 2, TV.z));
  parts.add(mesh(box(DEEP + 0.012, 0.05, wide + 0.012), trim, FLOOR.maxX - DEEP / 2 - 0.006, frame.y1 + 0.045, TV.z, false));
  for (const s of [-1, 1]) parts.add(mesh(box(0.05, frame.y1 - frame.y0, 0.05), lit(), FLOOR.maxX - 0.07, TV.y, TV.z + s * (frame.z + 0.035), false));
  const name = nameplate(place.title);
  name.scale.multiplyScalar(0.78);
  name.position.set(FLOOR.maxX - DEEP - 0.012, (top + frame.y1 + 0.07) / 2, TV.z);
  name.rotation.y = -Math.PI / 2;
  group.add(name);
  // The sign beside it hangs clear of the wall: a bracket behind its plate.
  const sign = place.sign;
  parts.add(mesh(box(FLOOR.maxX - sign.x - 0.03, 0.9 * sign.scale, 0.5 * sign.scale), toon(PALETTE.ink), (FLOOR.maxX + sign.x + 0.03) / 2, sign.y, sign.z, false));

  // The panel's table, on the platform: a pale top, and a skirt in the floor's trim on the audience's
  // side and round both ends.
  const t = place.table;
  const table = new THREE.Group();
  const under = t.height - 0.06;
  table.add(mesh(roundedBox(t.width, 0.06, t.depth, 0.05), toon(PALETTE.desk), 0, t.height - 0.03, 0));
  table.add(mesh(box(0.03, under - 0.03, t.depth - 0.08), trim, -t.width / 2 + 0.04, (under + 0.03) / 2, 0));
  for (const sz of [-1, 1]) table.add(mesh(box(t.width - 0.3, under - 0.03, 0.03), trim, -0.12, (under + 0.03) / 2, sz * (t.depth / 2 - 0.055)));
  // Between each two places along it: a leg, clear of everyone's knees, and a microphone on a bent
  // neck leaning toward the panel, clear of everyone's laptop.
  const along = place.seats.map((seat) => seat.z - t.z).sort((a, b) => a - b);
  for (const z of along.slice(1).map((next, i) => (along[i] + next) / 2)) {
    table.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, under, 8), toon(PALETTE.deskLeg), t.width / 2 - 0.09, under / 2, z));
    const mx = -t.width / 2 + 0.15;
    table.add(mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.02, 10), toon(PALETTE.ink), mx, t.height + 0.01, z, false));
    const neck = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 6), toon(PALETTE.ink), mx + 0.052, t.height + 0.128, z, false);
    neck.rotation.z = -0.45;
    table.add(neck);
    table.add(mesh(new THREE.SphereGeometry(0.028, 10, 8), toon(PALETTE.deskLeg), mx + 0.108, t.height + 0.24, z, false));
  }
  const built = mergeByMaterial(table);
  built.position.set(t.x, STAGE, t.z);
  group.add(mergeByMaterial(parts), built);
  const marks = [boardMark(site, place.board), site.wall('east', TV.z, top / 2, wide, top), site.wall('east', sign.z, sign.y, 0.9 * sign.scale, 1.25 * sign.scale)];
  return { group, table: built, lift: STAGE, solids: [], marks };
}

/** A camera's head looking toward +z: its body, a lens with its hood and glass, a handle, a little monitor on its side and its red light. */
function cameraHead(): THREE.Group {
  const g = new THREE.Group();
  const steel = toon(PALETTE.ink);
  g.add(mesh(roundedBox(0.16, 0.17, 0.28, 0.03), toon(CAMERA.body), 0, 0, -0.03));
  const barrel = mesh(new THREE.CylinderGeometry(0.064, 0.05, 0.17, 16), steel, 0, 0, 0.19);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  const glass = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.01, 16), toon(CAMERA.lens), 0, 0, 0.272, false);
  glass.rotation.x = Math.PI / 2;
  g.add(glass);
  g.add(mesh(box(0.022, 0.022, 0.2), steel, 0, 0.14, -0.03, false));
  for (const z of [-0.12, 0.06]) g.add(mesh(box(0.022, 0.06, 0.022), steel, 0, 0.11, z, false));
  g.add(mesh(box(0.014, 0.1, 0.15), steel, -0.09, 0.03, -0.05, false));
  g.add(mesh(box(0.004, 0.084, 0.134), toon(CAMERA.lens), -0.099, 0.03, -0.05, false));
  g.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), toon(CAMERA.tally, { emissive: CAMERA.tally }), 0.045, 0.095, 0.085, false));
  return g;
}

/**
 * The anchor desk: a long news desk with its front corners cut back, an oak top on a front in the
 * floor's trim with a strip of light along it and its name in the middle, open on the anchors' side.
 * Out in front stands the prompter, the meeting's board on a stand with a camera over it, looking at
 * the desk. The catalog's own camera stands on a tripod 0.8 across, which the prompter's 0.3 of floor
 * hasn't room for, so this one is only a head, built here in the same colors.
 */
function anchorDesk(site: Site, place: MeetingPlace): Setting {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const trim = site.looks.trim;
  const ink = toon(PALETTE.ink);
  const t = place.table;
  const hw = t.width / 2;
  const hd = t.depth / 2;
  /** How far each front corner is cut back, and how thick the top and how high the plinth it stands on. */
  const CUT = 0.22;
  const TOP = 0.07;
  const KICK = 0.1;

  // The desk, built round its own middle with its front toward +z.
  const desk = new THREE.Group();
  const outline = new THREE.Shape();
  outline.moveTo(-hw, -hd);
  outline.lineTo(hw, -hd);
  outline.lineTo(hw, hd - CUT);
  outline.lineTo(hw - CUT, hd);
  outline.lineTo(-hw + CUT, hd);
  outline.lineTo(-hw, hd - CUT);
  outline.closePath();
  // Drawn flat and extruded: turned over, the drawing's y is the room's z and its thickness hangs down from the top.
  const slab = new THREE.ExtrudeGeometry(outline, { depth: TOP, bevelEnabled: false });
  slab.rotateX(Math.PI / 2);
  desk.add(mesh(slab, toon(OAK), 0, t.height, 0));
  const high = t.height - TOP - KICK;
  const mid = KICK + high / 2;
  const SKIN = 0.04;
  /** How far inside the desk's edge the front's face is: the sign's plate lies on it. */
  const IN = 0.005;
  desk.add(mesh(box(t.width - 2 * CUT, high, SKIN), trim, 0, mid, hd - IN - SKIN / 2));
  for (const sx of [-1, 1]) {
    const corner = mesh(box(CUT * Math.SQRT2 + SKIN, high, SKIN), trim, sx * (hw - CUT / 2 - (IN + SKIN / 2) * Math.SQRT1_2), mid, hd - CUT / 2 - (IN + SKIN / 2) * Math.SQRT1_2);
    corner.rotation.y = (sx * Math.PI) / 4;
    desk.add(corner);
    desk.add(mesh(box(SKIN, high, t.depth - CUT), trim, sx * (hw - IN - SKIN / 2), mid, -CUT / 2));
  }
  desk.add(mesh(box(t.width - 0.3, KICK, t.depth - 0.3), ink, 0, KICK / 2, 0, false));
  // Light along the front: a strip under the top, and one along the foot of it.
  for (const y of [t.height - TOP - 0.05, KICK + 0.025]) desk.add(mesh(box(t.width - 2 * CUT - 0.16, 0.03, 0.012), lit(), 0, y, hd - IN + 0.003, false));
  const built = mergeByMaterial(desk);
  built.position.set(t.x, 0, t.z);
  // Its name is part of it: a click on the name is a click on the desk.
  const name = nameplate(place.title);
  name.scale.multiplyScalar(0.62);
  name.position.set(0, mid - 0.02, hd - IN + 0.012);
  built.add(name);

  // The prompter's stand, inside its own rectangle of floor: a foot, two uprights under the board, and
  // a mast up through it for the camera.
  const b = place.board;
  const rect = place.fixed.find((f) => f.what === 'the prompter')!.rect;
  const bottom = b.y - b.height / 2 - 0.075;
  const head = b.y + b.height / 2 + 0.075;
  parts.add(mesh(roundedBox(rect[1] - rect[0] - 0.1, 0.05, rect[3] - rect[2] - 0.02, 0.05), ink, b.x, 0.025, b.z));
  for (const sx of [-1, 1]) parts.add(mesh(box(0.05, bottom - 0.03, 0.05), ink, b.x + sx * (b.width / 2 - 0.25), (bottom + 0.07) / 2, b.z));
  parts.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), ink, b.x, head + 0.07, b.z, false));
  parts.add(mesh(box(0.11, 0.05, 0.12), ink, b.x, head + 0.165, b.z, false));
  const camera = cameraHead();
  camera.position.set(b.x, head + 0.275, b.z);
  // Turned to the desk, and tipped down at whoever's sitting at it.
  camera.rotation.set(0.14, b.rotY, 0, 'YXZ');
  parts.add(camera);

  const stand = mergeByMaterial(parts);
  group.add(built, stand);
  return { group, table: built, stand, lift: 0, solids: [solid(rect, head)], marks: [] };
}

/** A chair at the meeting's table, with its laptop on the table in front of it. */
function buildMeetingSeat(def: DeskDef): DeskView {
  const group = new THREE.Group();
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.z = MEETING_LAPTOP.z;
  laptopAnchor.scale.setScalar(MEETING_LAPTOP.scale);
  group.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);
  const ch = chair();
  ch.position.set(0, 0, 0.85);
  group.add(ch);
  // A merge's dance party: up on its chair rather than the table, where the laptops are close together.
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.48, 0.85);
  group.add(stage);
  // Nobody is hired here from the floor, so there's no '+' over a free chair: a meeting fills them.
  const vacancy = new THREE.Group();
  group.add(vacancy);
  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY: 0 };
}

/**
 * Builds the three meeting places into the floor and follows the floor's room (RoomOptions.meeting):
 * the place it has is shown, with what's in the way of it, and the chairs (MEETING_SEATS, whose own
 * definitions are stood there, so their workers and the way in to them follow), the board the
 * meeting's output is written on, the sign that says how it's going and what each is used by all move
 * to it. It hands back the board's face and the sign's, which are the same two wherever they are.
 */
export function buildMeetingPlace(site: Site): { board: THREE.Mesh; sign: THREE.Mesh } {
  const { group, colliders, interactables } = site;
  const settings: Record<MeetingKind, Setting> = { room: boardroom(site, PLACES.room), forum: stage(site, PLACES.forum), desk: anchorDesk(site, PLACES.desk) };
  for (const setting of Object.values(settings)) group.add(setting.group);

  // The table's in the way wherever it is, and it's what a meeting's called from.
  const tableSolid = solid(tableRect(PLACES.room.table), PLACES.room.table.height);
  colliders.push(tableSolid);
  const talk: Interactable = { kind: 'meeting', ...PLACES.room.use.talk };
  interactables.push(talk);
  for (const setting of Object.values(settings)) setting.table.userData.interact = talk;

  const seats = MEETING_SEATS.map((def) => {
    const view = buildMeetingSeat(def);
    group.add(view.group);
    site.desks.set(def.id, view);
    const use: Interactable = { kind: 'desk', deskId: def.id, ...deskSeat(def, 1.2), radius: 1 };
    interactables.push(use);
    view.group.userData.interact = use;
    return { view, use };
  });

  // The board: the meeting's output file as it's being written. One that stands out in the room is read
  // from behind as well, on a second face of the same material.
  const size = PLACES.room.board;
  const { group: frame, face } = wallBoard(size.width, size.height, '#aab4be');
  const rim = frame.children[0] as THREE.Mesh;
  const back = new THREE.Mesh(face.geometry, face.material);
  back.position.z = -face.position.z;
  back.rotation.y = Math.PI;
  frame.add(back);
  group.add(frame);
  const read: Interactable = { kind: 'meeting', ...PLACES.room.use.read };
  interactables.push(read);
  frame.userData.interact = read;
  for (const setting of Object.values(settings)) if (setting.stand) setting.stand.userData.interact = read;

  // The panel that says how it's going, like a room-booking screen: what's on, the round, the tokens,
  // and the summary once it's over. Its plate is behind it.
  const panel = new THREE.Group();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.96), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  panel.add(sign, mesh(roundedBox(0.66, 1.03, 0.03, 0.03), toon(PALETTE.ink), 0, 0, -0.02, false));
  group.add(panel);
  const status: Interactable = { kind: 'meeting', ...PLACES.room.use.sign };
  interactables.push(status);
  panel.userData.interact = status;

  let shown: MeetingKind | undefined;
  site.get('room').on((room) => {
    const kind = room.meeting;
    if (kind === shown) return;
    shown = kind;
    const place = PLACES[kind];
    const setting = settings[kind];
    for (const k of MEETING_KINDS) {
      settings[k].group.visible = k === kind;
      keep(colliders, settings[k].solids, k === kind);
      for (const mark of settings[k].marks) mark.off = k !== kind;
    }
    const t = place.table;
    Object.assign(tableSolid, solid(tableRect(t), t.height + setting.lift));
    Object.assign(talk, place.use.talk);
    seats.forEach(({ view, use }, i) => {
      // The view's own definition is the shared one, so its worker and the way in to it follow.
      Object.assign(view.def, place.seats[i]);
      view.group.position.set(view.def.x, setting.lift, view.def.z);
      view.group.rotation.y = view.def.rotY;
      view.laptopAnchor.position.y = t.height;
      Object.assign(use, deskSeat(view.def, 1.2));
    });
    const b = place.board;
    frame.position.set(b.x, b.y, b.z);
    frame.rotation.y = b.rotY;
    frame.scale.set(b.width / size.width, b.height / size.height, b.width / size.width);
    back.visible = !!b.twoSided;
    // On a wall it hangs in aluminium, like the task queue; standing in the room it's a screen in a dark case.
    rim.material = toon(b.twoSided ? PALETTE.ink : '#aab4be');
    Object.assign(read, place.use.read);
    const s = place.sign;
    panel.position.set(s.x, s.y, s.z);
    panel.rotation.y = s.rotY;
    panel.scale.setScalar(s.scale);
    Object.assign(status, place.use.sign);
  });
  return { board: face, sign };
}
