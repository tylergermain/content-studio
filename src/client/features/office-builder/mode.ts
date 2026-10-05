/**
 * Build mode: the camera goes up over the room, and you drag the desks and the furniture about on the
 * floor itself, turn them, paint them, add more from the catalog and take them away, on the office
 * floor or upstairs (levels.ts). What you do is a draft only you see (draft.ts) until you save it;
 * closing the builder puts the room back as it's saved.
 */
import type * as THREE from 'three';
import { isSolid, kindDef, type FurnitureKind } from '../../../shared/furniture';
import { cleanRoom, roomOf } from '../../../shared/floorplan';
import { validateLayout } from '../../../shared/office-builder';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { openModal, toast } from '../../ui/dom';
import { openDeskLabel } from '../../ui/floorplan';
import { DraftLayout, draftOf } from './draft';
import { createBuilderKeys } from './keys';
import { createLevels } from './levels';
import { createPlacing } from './placing';
import type { LayoutSync } from './sync';
import { createBuilderUi, type Picked } from './ui';
import { BuilderCamera, BuilderGizmo } from './view';

export interface BuildDeps {
  /** The toon outline the office is drawn with: it can't be cut away with the walls, so the builder draws without it. */
  effect: { enabled: boolean };
  /** Opens the floor's own setup: its boards, kiosk agents and ticker (see features/studio). */
  setup(): void;
}

type Drag =
  /** Dragging a desk or a piece: `dx`, `dz` from where the mouse is on the floor to its middle, and the draft `before`. */
  | { kind: 'move'; id: string; dx: number; dz: number; before: string; moved: boolean; sx: number; sy: number }
  /** Dragging the floor itself. Let go without moving and it's a click: on `pick`, or on nothing (null). */
  | { kind: 'pan'; at: { x: number; z: number }; pick: string | null; moved: boolean; sx: number; sy: number }
  | { kind: 'orbit'; x: number; y: number };

const HELP = 'Drag anything to move it. R turns it, Delete removes it.';
/** Whether `o` is drawn: it and everything it hangs from. */
const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));

interface Session {
  frame(dt: number): void;
  late(): void;
  planChanged(): void;
  close(): void;
}

export function createBuildMode(ctx: Ctx, sync: LayoutSync, deps: BuildDeps) {
  let session: Session | null = null;

  const canBuild = () => store.me.admin && !!store.floor && !ctx.upTop() && !ctx.trip();

  // Anything else that takes you somewhere (another floor) closes the builder first.
  ctx.activities.add({ id: 'office-builder', active: () => !!session, stop: () => session?.close(), takesCamera: true, hidesHands: true });
  ctx.ticks.add('me', ({ dt }) => session?.frame(dt));
  ctx.ticks.add('hud', () => session?.late());

  function open() {
    if (session) return;
    if (!canBuild()) {
      toast('Open an office floor as an admin to build', 'warn');
      return;
    }
    ctx.activities.stopAll('start');
    session = start();
  }

  function start(): Session {
    const { net, camera, renderer, scene, office } = ctx;
    const floor = store.floor;
    const cam = new BuilderCamera(camera);
    const gizmo = new BuilderGizmo();
    scene.add(gizmo.group);

    const draft = new DraftLayout(sync.saved(), sync.deskIds);
    let revision = store.floorPlan.layoutRevision ?? 0;
    /** The layout as it's saved, and as it was last sent to be: the draft's the same as one, or there's something to save. */
    let savedKey = draft.key();
    let sentKey = '';
    let selected: string | null = null;
    let hovered: string | null = null;
    let wallsCut = true;
    let pending = false;
    let conflict = false;
    let asking = false;
    let status: { text: string; tone: 'info' | 'warn' } = { text: HELP, tone: 'info' };
    let drag: Drag | null = null;
    let closed = false;

    const dirty = () => draft.key() !== savedKey;
    /** Why a desk can't be moved, if it can't: a worker's sitting at it. */
    const locked = (id: string) => {
      if (draft.isDesk(id)) return store.workerAtDesk(id) ? 'Send this desk’s worker home before moving it' : undefined;
      const k = draft.piece(id) && kindDef(draft.piece(id)!.kind);
      return k?.pinned ? `The ${k.label.toLowerCase()} hangs where it is: keep it there, or remove it` : undefined;
    };

    function say(text: string | undefined, tone: 'info' | 'warn' = 'info') {
      status = { text: text || HELP, tone: text ? tone : 'info' };
    }

    /** What's picked, as the inspector shows it. */
    function picked(): Picked | null {
      const pose = selected ? draft.pose(selected) : undefined;
      if (!selected || !pose) return null;
      const piece = draft.piece(selected);
      if (piece) return { id: selected, pose: { x: pose.x, z: pose.z, rotY: pose.rotY }, piece, label: piece.kind === 'sign' ? (piece.text ?? '') : kindDef(piece.kind).label, icon: kindDef(piece.kind).icon };
      return { id: selected, pose: { x: pose.x, z: pose.z, rotY: pose.rotY }, label: store.floorPlan.labels[selected]?.text || `Desk ${selected.replace('desk-', '')}`, icon: '🖥️', locked: locked(selected) };
    }

    /** The draft, in the room: everything stands where it has it, with the outlines under what's picked and pointed at. */
    function show() {
      levels.follow();
      // What's picked is on the level being worked on, or it isn't picked.
      if (selected && (!draft.pose(selected) || draft.levelOf(selected) !== levels.now)) selected = null;
      sync.arrange(draft.now, 0);
      sync.paint(draft.now.look);
      outline();
      ui.render();
    }

    function outline(bad = false) {
      const at = draft.footprint(selected);
      gizmo.pick(at?.box ?? null, at?.radius, bad);
      const over = hovered !== selected ? draft.footprint(hovered) : null;
      gizmo.point(over?.box ?? null, over?.radius);
    }

    function select(id: string | null) {
      selected = id;
      say(id ? locked(id) : '', 'warn');
      outline();
      ui.render();
    }

    /** A change to what's picked (`change` says why it couldn't be made, if it couldn't), unless a worker's desk is what's picked. */
    function change(make: (id: string) => string | undefined) {
      if (!selected || pending) return;
      say(locked(selected) ?? make(selected), 'warn');
      show();
    }
    /** The office floor or upstairs: which one's being worked on, and what moves between them. */
    const levels = createLevels({ draft, cam, gizmo, picked: () => selected, select, busy: () => pending, say, show });

    /** The new piece `id` is what's picked, or there was no room for one. */
    function added(id: string | null, what: string) {
      if (id) selected = id;
      say(id ? `${what} added. Drag it where you want it.` : 'There’s no room for it here: clear some floor first', id ? 'info' : 'warn');
      show();
    }

    /** Another piece like the one picked, beside it: not a desk, nor what the office has only one of. */
    function duplicate() {
      const piece = selected ? draft.piece(selected) : undefined;
      if (piece && !pending && !kindDef(piece.kind).fixed) added(draft.duplicate(piece.id), 'Another one');
    }

    /** Adds a piece of `kind` in the middle of the view. What the floor already has its one of is picked instead. */
    function addKind(kind: FurnitureKind) {
      if (pending) return;
      if (kindDef(kind).fixed && draft.piece(kind)) {
        say(`This floor already has its ${kindDef(kind).label.toLowerCase()}: here it is`);
        return select(kind);
      }
      added(draft.add(kind, cam.x, cam.z, levels.now), kindDef(kind).label);
    }

    function remove() {
      if (!selected || pending) return;
      if (draft.isDesk(selected)) say('Desks can be moved, but each one stays on the floor', 'warn');
      else {
        const hung = draft.remove(selected);
        say(hung ? `${hung === 1 ? 'The painting' : `The ${hung} paintings`} on it went with it. Undo brings ${hung === 1 ? 'it' : 'them'} back.` : '');
      }
      show();
    }

    /** Back to the layout as it's saved, losing the draft. */
    function reload() {
      draft.load(sync.saved());
      revision = store.floorPlan.layoutRevision ?? 0;
      savedKey = draft.key();
      pending = conflict = false;
      say('');
      show();
    }

    function save() {
      if (pending || conflict || !dirty() || !net.up) return;
      const clean = validateLayout(draft.now.desks, draft.now.furniture, roomOf(draft.now));
      if (typeof clean === 'string') {
        say(clean, 'warn');
        return ui.render();
      }
      // As the office will keep it, so what comes back is known to be this.
      const room = cleanRoom(draft.now.room);
      draft.now = { ...clean, ...(draft.now.look !== undefined ? { look: draft.now.look } : {}), ...(Object.keys(room).length ? { room } : {}) };
      sentKey = draft.key();
      pending = true;
      net.send({ t: 'floor.layout', desks: draft.now.desks, furniture: draft.now.furniture, look: draft.now.look, room: draft.now.room, revision });
      say('Saving your layout…');
      ui.render();
    }

    /** The floor's plan changed: your save went through, someone else's did, or the back office was built out. */
    function planChanged() {
      const next = store.floorPlan.layoutRevision ?? 0;
      if (next !== revision) {
        const now = JSON.stringify(draftOf(sync.saved()));
        if (pending && now === sentKey) {
          revision = next;
          savedKey = now;
          pending = false;
          say('Saved. Everyone on the floor sees the new layout.');
        } else if (dirty()) {
          conflict = true;
          pending = false;
          say('Someone saved a newer layout. Reload it before saving yours.', 'warn');
        } else return reload();
      }
      show();
    }

    const ui = createBuilderUi(
      {
        picked,
        status: () => status,
        dirty,
        pending: () => pending,
        conflict: () => conflict,
        asking: () => asking,
        canUndo: () => draft.canUndo,
        canRedo: () => draft.canRedo,
        wallsCut: () => wallsCut,
        look: () => draft.now.look,
        room: () => roomOf(draft.now),
        online: () => net.up,
        ...levels.state,
      },
      {
        add: addKind,
        place: (kind, e) => place(kind, e),
        moveTo: (x, z) => change((id) => draft.edit(() => draft.setPose(id, x, z, draft.pose(id)!.rotY), id)),
        turn: (way) => change((id) => draft.turn(id, way)),
        edit: (patch) => change((id) => draft.repiece(id, patch)),
        remedia: (media) => change((id) => draft.edit(() => (media ? (draft.piece(id)!.media = media) : delete draft.piece(id)!.media), id)),
        duplicate,
        remove,
        sign: () => selected && draft.isDesk(selected) && openDeskLabel(net, selected),
        undo: () => !pending && draft.step() && (say(''), show()),
        redo: () => !pending && draft.step(true) && (say(''), show()),
        save,
        reload,
        reset: () => {
          if (pending) return;
          const was = store.floorPlan.desks ?? {};
          say(draft.reset(Object.fromEntries(Object.entries(was).filter(([id]) => store.workerAtDesk(id)))), 'warn');
          show();
        },
        walls: () => {
          wallsCut = !wallsCut;
          renderer.clippingPlanes = [gizmo.clip(wallsCut)];
          ui.render();
        },
        paint: (look) => {
          if (pending) return;
          draft.edit((d) => (look === undefined ? delete d.look : (d.look = look)));
          show();
        },
        // Why the room couldn't change, for the panel to say under the choice it was (room-ui.ts).
        room(patch) {
          if (pending) return undefined;
          const why = draft.setRoom(patch);
          say(why, 'warn');
          show();
          return why;
        },
        ...levels.act,
        expand: () => net.send({ t: 'floor.expand' }),
        shrink: () => net.send({ t: 'floor.shrink' }),
        setup: deps.setup,
        close: requestClose,
        discard: close,
        keep: () => {
          asking = false;
          ui.render();
        },
      },
    );

    /** A card off the catalog, clicked or carried out onto the floor (placing.ts). */
    const place = createPlacing({
      draft,
      cam,
      view: ui.view,
      busy: () => pending,
      level: () => levels.now,
      add: addKind,
      made: (id) => ((selected = id), show()),
      dragTo,
      drop,
      cancel: (before) => (draft.restore(before), say(''), show()),
    });

    // ---- The mouse ------------------------------------------------------------------------------

    /** The desk or the piece under the mouse, by its id: one on the level being worked on. */
    function pick(e: PointerEvent): string | null {
      const roots = [...sync.deskIds.map((id) => office.desks.get(id)!.group), ...office.furniture.roots()];
      for (const hit of cam.rayAt(e, ui.view).intersectObjects(roots, true)) {
        // Not what's cut away with the walls, nor what's put away.
        if (hit.point.y > gizmo.height + 0.01 || !shown(hit.object)) continue;
        let o: THREE.Object3D | null = hit.object;
        while (o && typeof o.userData.piece !== 'string') o = o.parent;
        // (What's on the other level is looked past: under the deck from upstairs, there's the office floor.)
        if (o && draft.levelOf(o.userData.piece as string) === levels.now) return o.userData.piece as string;
      }
      return null;
    }

    function down(e: PointerEvent) {
      if (asking || e.target !== ui.view) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      try {
        ui.view.setPointerCapture(e.pointerId);
      } catch {
        // a pointer the browser no longer has (it came up meanwhile): the drag just ends at the view's edge
      }
      if (e.button !== 0 || e.shiftKey) {
        drag = { kind: 'orbit', x: e.clientX, y: e.clientY };
        return;
      }
      const at = cam.floorAt(e, ui.view);
      if (!at) return;
      const id = pick(e);
      const piece = id ? draft.piece(id) : undefined;
      const pan = (hit: string | null): Drag => ({ kind: 'pan', at, pick: hit, moved: false, sx: e.clientX, sy: e.clientY });
      // A rug's most of the floor: the first press on one picks it (or drags the floor), the next drags it.
      // (What hangs from the ceiling goes the same way. A painting or a doorway is as small as a wall: one press drags it.)
      const flat = !!piece && !isSolid(piece) && !kindDef(piece.kind).hangs && piece.kind !== 'doorway';
      if (!id || (flat && selected !== id) || pending) drag = pan(id);
      else {
        select(id);
        const p = draft.pose(id)!;
        drag = locked(id) ? pan(id) : { kind: 'move', id, dx: p.x - at.x, dz: p.z - at.z, before: draft.key(), moved: false, sx: e.clientX, sy: e.clientY };
      }
    }

    /**
     * Drags the picked thing to under the mouse, on the grid (a finer one with Alt held) and on its own
     * level's floor, a painting onto a wall no further than `within` (see dragPose), and says if it can't be there.
     */
    function dragTo(id: string, e: PointerEvent, dx: number, dz: number, within?: number) {
      const at = cam.floorAt(e, ui.view);
      if (!at || !draft.dragTo(id, { x: at.x + dx, z: at.z + dz }, e.altKey, within)) return;
      sync.arrange(draft.now, 0);
      const why = draft.problem(id);
      say(why, 'warn');
      outline(!!why);
      ui.render();
    }

    function move(e: PointerEvent) {
      if (!drag) {
        const over = e.target === ui.view ? pick(e) : null;
        if (over !== hovered) {
          hovered = over;
          ui.view.style.cursor = over ? 'grab' : '';
          outline();
        }
        return;
      }
      if (drag.kind === 'orbit') {
        cam.yaw -= (e.clientX - drag.x) * 0.006;
        cam.pitch += (e.clientY - drag.y) * 0.006;
        drag.x = e.clientX;
        drag.y = e.clientY;
        return cam.place();
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      if (drag.kind === 'pan') {
        // The spot of floor you took hold of stays under the mouse.
        const at = cam.floorAt(e, ui.view);
        if (!at) return;
        cam.x -= at.x - drag.at.x;
        cam.z -= at.z - drag.at.z;
        return cam.place();
      }
      ui.view.style.cursor = 'grabbing';
      dragTo(drag.id, e, drag.dx, drag.dz);
    }

    /** Lets go of what's being dragged: where it can't stand, it goes back where it was. */
    function drop(id: string, before: string) {
      const why = draft.problem(id);
      if (why) draft.restore(before);
      else draft.remember(before);
      say(why && `${why}: it’s back where it was`, 'warn');
      show();
    }

    function up(e: PointerEvent) {
      const d = drag;
      drag = null;
      if (ui.view.hasPointerCapture(e.pointerId)) ui.view.releasePointerCapture(e.pointerId);
      ui.view.style.cursor = hovered ? 'grab' : '';
      if (!d || d.kind === 'orbit') return;
      if (d.kind === 'pan') {
        if (!d.moved) select(d.pick);
      } else if (d.moved) drop(d.id, d.before);
    }

    function wheel(e: WheelEvent) {
      if (e.target !== ui.view) return;
      e.preventDefault();
      cam.dist *= Math.exp(e.deltaY * 0.0012);
      cam.place();
    }

    // ---- The keys (keys.ts) ---------------------------------------------------------------------

    const keys = createBuilderKeys({
      cam,
      draft,
      change,
      onTop: () => modal.backdrop.parentElement?.lastElementChild === modal.backdrop,
      asking: () => asking,
      picked: () => !!selected,
      escape() {
        if (asking) {
          asking = false;
          return ui.render();
        }
        if (drag?.kind === 'move') {
          draft.restore(drag.before);
          drag = null;
          return show();
        }
        return selected ? select(null) : requestClose();
      },
      step: (again) => !pending && draft.step(again) && show(),
      duplicate,
      save,
      remove,
    });

    // ---- Opening and closing --------------------------------------------------------------------

    function requestClose() {
      if (!dirty() || pending) return close();
      asking = true;
      ui.render();
    }

    function close() {
      if (!closed) modal.close();
    }

    /** The builder's gone: the room's back as it's saved, drawn the way it always is. */
    function cleanUp() {
      closed = true;
      session = null;
      for (const off of offs) off();
      keys.stop();
      scene.remove(gizmo.group);
      renderer.clippingPlanes = [];
      deps.effect.enabled = true;
      document.body.classList.remove('building');
      sync.arrange(sync.saved(), store.floorPlan.wing);
      sync.paint(store.floorPlan.look);
      sync.settle();
    }

    const offs = [
      store.on('workers', () => ui.render()),
      net.onMessage((m) => {
        // The office said no to the save (a warning, to you alone).
        if (m.t === 'toast' && pending && m.level !== 'info') {
          pending = false;
          say(m.text, 'warn');
          ui.render();
        }
        if (m.t === 'floor.enter' && store.floor !== floor) close();
      }),
      net.onStatus((online) => {
        if (!online && pending) {
          pending = false;
          say('Connection lost. Your draft is still here.', 'warn');
        }
        ui.render();
      }),
    ];
    ui.view.addEventListener('pointerdown', down);
    ui.view.addEventListener('pointermove', move);
    ui.view.addEventListener('pointerup', up);
    ui.view.addEventListener('pointercancel', up);
    ui.view.addEventListener('wheel', wheel, { passive: false });
    ui.view.addEventListener('contextmenu', (e) => e.preventDefault());

    const modal = openModal(ui.root, { escCloses: false, closeButton: false, backdropCloses: false, doing: '📐 arranging the office', onClose: cleanUp });
    modal.backdrop.classList.add('ob-backdrop');
    document.body.classList.add('building');
    deps.effect.enabled = false;
    renderer.clippingPlanes = [gizmo.clip(wallsCut)];
    cam.place();
    show();

    return {
      frame(dt) {
        keys.steer(dt);
        // Every frame: the office puts its camera back on your shoulders before this.
        cam.place();
      },
      late() {
        // From up here the room's past where the weather's haze starts.
        const fog = scene.fog as THREE.Fog | null;
        if (fog) {
          fog.near = Math.max(fog.near, cam.dist + 120);
          fog.far = Math.max(fog.far, cam.dist + 320);
        }
      },
      planChanged,
      close,
    };
  }

  return { open, canBuild, active: () => !!session, planChanged: () => session?.planChanged() };
}
