/**
 * Every 2D window, usable in VR: the panels. The page stays laid out while you're in a headset, so each
 * panel shows a live part of it (painted by paint.ts) and a ray on a panel is the mouse on that part
 * (bridge.ts):
 *
 * - window: the top window (openModal's), about a meter ahead of you; one as big as the screen (the
 *   builder) is a sheet, wider and further off, that the ray passes through where nothing's painted,
 *   into the world under it (worldClick, the builder's floor).
 * - hud: the HUD as it floats over the office (the ☰ menu, people, workers, chat, pop-ups), on X.
 * - hint: the hint bar and the newest toasts, low ahead of you, its key chips relabelled for the
 *   controllers (E is Trigger) and pressed when tapped.
 * - keyboard (keyboard.ts), and a select's options (select.ts); and the panels other parts add (perf).
 *
 * The ray tries them in that order of priority: options, keyboard, window, hint, HUD, the others.
 */
import * as THREE from 'three';
import type { Ctx } from '../../../core/context';
import { toast } from '../../../ui/dom';
import { focusedElement, isEditable, tapKey } from '../keys';
import { codeOfChip } from '../keys-table';
import type { Btn, Hand, NativePanel, PanelHit, PanelHost, VrDebug, VrSession } from '../types';
import { Bridge, type Point, type Surface } from './bridge';
import { Captures, HeldLinks } from './capture';
import { PACE } from './dirty';
import { Keyboard } from './keyboard';
import {
  FOLLOW,
  SHEET,
  WINDOW,
  backAction,
  easePose,
  hintPose,
  isSheet,
  keyboardPose,
  lazyAim,
  metresPerPx,
  offGaze,
  placeAhead,
  pushPull,
  shouldRecenter,
  stack,
  type FollowState,
  type HeadPose,
  type Pose,
} from './layout';
import { chipAt, Marks, onPlane, relabelChips, restoreChips } from './marks';
import { DomPanel, type Segment } from './panel';
import { OptionList } from './select';
import './panels.css';

/** Draw order: each over the ones before, all over the world, all under the controllers' pointers (1500). */
const ORDER = { hud: 1000, sheet: 1004, window: 1010, hint: 1020, keyboard: 1040, options: 1050, hover: 1090 } as const;
/** What the HUD sheet leaves out of the page: the office's canvas and the YouTube players laid behind it, the windows (panels of their own), and the rest. */
const EXCLUDE = '#scene, .webscreens, #modal-root, #loading, #hint, #toasts, #crosshair, #fade, #telescope-view, .vr-links';
/** A window's glass, opaque: there's nothing behind it to blur in a headset. */
const GLASS = '#f1f1f4';
const DARK_GLASS = '#26262a';
/** px a second the stick scrolls at full tilt. */
const SCROLL = 1100;
/** How much of the per-frame paint time is the latest frame's, in what perf reads. */
const SMOOTH = 0.1;
/** A frame's painting budget, ms. */
const BUDGET = 4;
const HANDS: readonly Hand[] = ['left', 'right'];

type Grabbed = DomPanel | Keyboard;

/** The panels for a session (see the file's note). */
export function startPanels(ctx: Ctx, s: VrSession): PanelHost & { ids(): string[]; readonly lastPaintMs: number } {
  const { renderer, canvas } = ctx;
  const group = new THREE.Group();
  group.name = 'vr-panels';
  ctx.scene.add(group);
  document.documentElement.classList.add('vr-panels');

  const hudEl = document.getElementById('hud');
  /** The office's canvas, and whatever holds it that isn't the page's own (an emulator's full-screen box). */
  const holdsCanvas = (el: Element) => el === canvas || (el !== document.body && el !== document.documentElement && el.contains(canvas) && !(hudEl && el.contains(hudEl)));
  const hudSkip = (el: Element) => !!el.closest(EXCLUDE) || holdsCanvas(el);

  const win = new DomPanel({ id: 'window', order: ORDER.window, pace: PACE.window, base: GLASS });
  const sheet = new DomPanel({ id: 'sheet', order: ORDER.sheet, pace: PACE.sheet, seeThrough: true });
  const hud = new DomPanel({ id: 'hud', order: ORDER.hud, pace: PACE.sheet, seeThrough: true, rootBox: false, skip: hudSkip });
  const hint = new DomPanel({ id: 'hint', order: ORDER.hint, pace: PACE.hint, base: (el) => (el.id === 'hint' ? DARK_GLASS : GLASS) });
  const doms = [hint, win, sheet, hud];
  const kb = new Keyboard(ORDER.keyboard);
  const options = new OptionList(ORDER.options);
  for (const m of [...doms.map((p) => p.mesh), kb.mesh, options.mesh]) group.add(m);
  const natives: NativePanel[] = [];

  const captures = new Captures();
  captures.install();
  const links = new HeldLinks();
  links.install();
  const bridge = new Bridge(captures, { select: openOptions, say: (t) => toast(t) });

  let winRoot: Element | null = null;
  const winSurface: Surface = { root: () => winRoot, skip: () => false };
  const hudSurface: Surface = { root: () => document.body, skip: hudSkip };
  const surfaceOf = (p: DomPanel): Surface => (p === hud ? hudSurface : winSurface);
  const follow = new Map<object, FollowState>();
  const anims = new Map<DomPanel, { from: Pose; to: Pose; t: number }>();
  let kbPose: Pose = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
  let kbPinned = false;
  let lastPaintMs = 0;
  const head = (): HeadPose => ({ position: s.head.position, yaw: s.head.yaw, pitch: s.head.pitch });
  let aim = { yaw: s.head.yaw, pitch: s.head.pitch };

  // ---- Where they go ----

  function ahead(p: DomPanel, kind: 'window' | 'sheet', ease: boolean) {
    const d = kind === 'sheet' ? SHEET : WINDOW;
    const to = placeAhead(head(), d.dist, d.drop);
    if (ease && p.mesh.visible) anims.set(p, { from: { ...p.pose, position: { ...p.pose.position } }, to, t: 0 });
    else p.place(to);
    p.pinned = false;
  }

  function placeKb(pose: Pose) {
    kbPose = pose;
    kb.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    kb.mesh.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    kb.mesh.updateMatrixWorld(true);
  }

  function keyboardHere() {
    kbPinned = false;
    placeKb(keyboardPose(head(), win.shown ? { pose: win.pose, height: win.h * win.mpp } : null, kb.height));
  }

  // ---- What they show ----

  function rectOf(el: Element) {
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }

  /** The top window now, laid out on its panel: a window or a sheet by its size. */
  function layoutWindow(fresh: boolean) {
    const root = winRoot;
    const src = root ? rectOf(root) : null;
    if (!root || !src || src.w < 2 || src.h < 2) {
      for (const p of [win, sheet]) if (p.shown) p.show(false);
      return;
    }
    const kind = isSheet(src.w, src.h, innerWidth, innerHeight) ? 'sheet' : 'window';
    const p = kind === 'sheet' ? sheet : win;
    const other = p === win ? sheet : win;
    if (other.shown) {
      other.show(false);
      other.unwatchAll();
    }
    p.setSegments([{ el: root, src, at: { x: 0, y: 0 } }], src, metresPerPx(kind, innerWidth), s.quality.panelScale);
    p.watch([root]);
    if (!p.shown || fresh) {
      ahead(p, kind, p.shown);
      p.show(true);
    }
  }

  function layoutHud() {
    if (!hud.shown) return;
    const src = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    hud.setSegments([{ el: document.body, src, at: { x: 0, y: 0 } }], src, metresPerPx('sheet', innerWidth), s.quality.panelScale);
  }

  /** The newest two toasts, then the hint bar, stacked. */
  function layoutHint() {
    const parts: { el: Element; src: ReturnType<typeof rectOf> }[] = [];
    const toasts = document.getElementById('toasts');
    for (const t of [...(toasts?.children ?? [])].slice(-2)) {
      const src = rectOf(t);
      if (src.w > 1 && src.h > 1) parts.push({ el: t, src });
    }
    const bar = document.getElementById('hint');
    if (bar && !bar.classList.contains('hidden')) {
      const src = rectOf(bar);
      if (src.w > 1 && src.h > 1) parts.push({ el: bar, src });
    }
    if (!parts.length) {
      if (hint.shown) hint.show(false);
      return;
    }
    const st = stack(parts.map((p) => p.src));
    const segments: Segment[] = parts.map((p, i) => ({ el: p.el, src: p.src, at: st.at[i] }));
    hint.setSegments(segments, st, metresPerPx('hint', innerWidth), s.quality.panelScale);
    if (!hint.shown) hint.show(true);
  }

  // The hint's key chips, said the controllers' way (E is Trigger).
  const chips = new MutationObserver(() => relabelChips());
  const hintEl = document.getElementById('hint');
  if (hintEl) chips.observe(hintEl, { childList: true, subtree: true });
  relabelChips();
  hint.watch([hintEl, document.getElementById('toasts')].filter((e): e is HTMLElement => !!e));

  // ---- The keyboard by itself, and pop-ups bringing the HUD ----

  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as Element | null;
    if (!isEditable(t) || kb.shown) return;
    kb.show(true);
    keyboardHere();
  };
  document.addEventListener('focusin', onFocusIn, true);
  /** Since when nothing that takes typing has had the focus, while the keyboard's up by itself (it goes after a moment). */
  let unfocusedSince = 0;
  // Something new on the page itself (the floor menu, a live greeting): the HUD comes up to show it.
  const popups = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && !hudSkip(n) && n.checkVisibility() && !hud.shown) toggleSheet();
  });
  popups.observe(document.body, { childList: true });

  function toggleSheet() {
    if (hud.shown) {
      hud.show(false);
      hud.unwatchAll();
      return;
    }
    hud.watch([document.body]);
    hud.show(true);
    layoutHud();
    ahead(hud, 'sheet', false);
  }

  // ---- The options list ----

  function openOptions(sel: HTMLSelectElement) {
    const p = [win, sheet, hud].find((d) => d.shown && d.segments[0]?.el.contains(sel));
    if (!p) return;
    const seg = p.segments[0];
    const l = p.local(seg, rectOf(sel));
    const at = new THREE.Vector3(l.x, l.y - l.h / 2, 0).applyMatrix4(p.mesh.matrixWorld);
    const toward = new THREE.Vector3().subVectors(s.head.position, at).setY(0).normalize().multiplyScalar(0.06);
    at.add(toward);
    options.show(sel, { position: { x: at.x, y: at.y - 0.12, z: at.z }, yaw: p.pose.yaw, pitch: p.pose.pitch });
  }

  // ---- The ray ----

  const caster = new THREE.Raycaster();

  type Target = { id: string; native?: NativePanel; dom?: DomPanel };
  /** What the ray tries, in order. */
  function targets(): Target[] {
    const out: Target[] = [];
    if (options.visible()) out.push({ id: options.id, native: options });
    if (kb.shown) out.push({ id: kb.id, native: kb });
    for (const p of [win, sheet, hint, hud]) if (p.shown && p.mesh.visible) out.push({ id: p.id, dom: p });
    for (const n of natives) if (n.visible()) out.push({ id: n.id, native: n });
    return out;
  }

  const lastHits = new Map<THREE.Ray, PanelHit | null>();
  const rays: Partial<Record<Hand, THREE.Ray>> = {};
  /** Which hand's ray a hit came from (interact asks hit() for each hand, then tells us the hand). */
  function learn(hand: Hand, hit: PanelHit | null) {
    if (!hit) return;
    for (const [ray, h] of lastHits) if (h === hit) rays[hand] = ray;
  }

  function hit(ray: THREE.Ray): PanelHit | null {
    let found: PanelHit | null = null;
    for (const t of targets()) {
      if (t.dom) {
        const on = onPlane(t.dom.mesh, ray);
        if (on && t.dom.inked(on.uv.x, on.uv.y)) {
          found = { panel: t.id, ...on };
          break;
        }
      } else if (t.native) {
        caster.set(ray.origin, ray.direction);
        t.native.mesh.updateWorldMatrix(true, false);
        const h = caster.intersectObject(t.native.mesh, false)[0];
        if (h?.uv) {
          found = { panel: t.id, point: h.point, uv: h.uv, distance: h.distance };
          break;
        }
      }
    }
    lastHits.set(ray, found);
    return found;
  }

  const byId = (id: string | null): Target | null => (id ? (targets().find((t) => t.id === id) ?? null) : null);

  interface HandState { t: number; over: string | null; press: string | null; chip: HTMLElement | null }
  const hands: Record<Hand, HandState> = { left: { t: 0, over: null, press: null, chip: null }, right: { t: 0, over: null, press: null, chip: null } };
  const lookOn: Record<Hand, PanelHit | null> = { left: null, right: null };

  function point(hand: Hand, h: PanelHit | null, trigger: Btn, scroll: number) {
    learn(hand, h);
    const st = hands[hand];
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - st.t) / 1000));
    st.t = now;
    const id = st.press ?? h?.panel ?? null;
    const target = byId(id);
    let uv = h && h.panel === id ? h.uv : null;
    if (st.press && !uv && target && rays[hand]) uv = onPlane((target.native ?? target.dom)!.mesh, rays[hand]!, true)?.uv ?? null;
    if (st.over !== id) {
      const was = byId(st.over);
      was?.native?.point('leave', new THREE.Vector2(-1, -1), hand);
      st.over = id;
      st.chip = null;
    }
    lookOn[hand] = h;
    if (!target || !uv) {
      if (!trigger.pressed) st.press = null;
      return;
    }
    if (target.native) {
      target.native.point(trigger.down ? 'down' : trigger.up ? 'up' : 'move', uv, hand);
      if (scroll && target.native.scroll) target.native.scroll(scroll * SCROLL * dt);
    } else if (target.dom === hint) {
      const at = hint.clientAt(uv.x, uv.y);
      st.chip = at ? chipAt(at.seg.el, at) : null;
      const code = st.chip && trigger.down ? codeOfChip(st.chip.dataset.vrChip ?? st.chip.textContent ?? '') : null;
      if (code) tapKey(code);
    } else if (target.dom) {
      const at = target.dom.clientAt(uv.x, uv.y, !!st.press);
      if (at) {
        const surface = surfaceOf(target.dom);
        target.dom.lookedAt = true;
        bridge.move(hand, surface, at);
        if (trigger.down) bridge.down(hand, surface, at);
        if (trigger.up) bridge.up(hand, surface, at);
        if (scroll) bridge.wheel(hand, surface, at, scroll * SCROLL * dt);
      }
    }
    if (trigger.down) st.press = id;
    if (!trigger.pressed) st.press = null;
  }

  // ---- Into the world under a sheet (the builder's floor) ----

  const world: Record<Hand, Point | null> = { left: null, right: null };
  const ndc = new THREE.Vector3();
  /** Where a point in the world is on the page, through the head as drawn: the camera's set to it first, so the page's own raycast lands there too. */
  function toPage(at: THREE.Vector3): Point | null {
    const cam = ctx.camera;
    const xrCam = renderer.xr.getCamera();
    cam.position.copy(s.head.position);
    cam.quaternion.copy(s.head.quaternion);
    cam.updateMatrixWorld(true);
    if (xrCam.projectionMatrix.elements[15] === 0) {
      cam.projectionMatrix.copy(xrCam.projectionMatrix);
      cam.projectionMatrixInverse.copy(xrCam.projectionMatrixInverse);
    }
    ndc.copy(at).project(cam);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    const c = canvas.getBoundingClientRect();
    const r = c.width > 0 ? c : new DOMRect(0, 0, innerWidth, innerHeight);
    let p = { x: r.left + ((ndc.x + 1) / 2) * r.width, y: r.top + ((1 - ndc.y) / 2) * r.height };
    // The page maps the point back through the box it listens on: through that box's own size.
    let el = bridge.pick(winSurface, p)?.el ?? null;
    while (el && el.getBoundingClientRect().width * el.getBoundingClientRect().height < innerWidth * innerHeight * 0.5) el = el.parentElement;
    const b = el?.getBoundingClientRect();
    if (b && (Math.abs(b.width - r.width) > 1 || Math.abs(b.height - r.height) > 1)) p = { x: b.left + ((ndc.x + 1) / 2) * b.width, y: b.top + ((1 - ndc.y) / 2) * b.height };
    return p;
  }

  function worldClick(hand: Hand, at: THREE.Vector3 | null, trigger: Btn) {
    if (!sheet.shown || !winRoot) return;
    const p = (at && toPage(at)) ?? (bridge.pressing(hand) ? world[hand] : null);
    if (!p) return;
    world[hand] = p;
    bridge.move(hand, winSurface, p);
    if (trigger.down) bridge.down(hand, winSurface, p);
    if (trigger.up) bridge.up(hand, winSurface, p);
  }

  // ---- Taking hold of one ----

  const grabs: Record<Hand, { target: Grabbed; dist: number; off: THREE.Vector3; t: number } | null> = { left: null, right: null };

  function grab(hand: Hand, h: PanelHit | null, squeeze: Btn, push: number): boolean {
    learn(hand, h);
    if (squeeze.down) {
      const target: Grabbed | null = !h ? null : h.panel === kb.id ? kb : ([win, sheet, hud].find((p) => p.id === h.panel) ?? null);
      if (!target || !h) return false;
      const pos = target.mesh.getWorldPosition(new THREE.Vector3());
      grabs[hand] = { target, dist: h.distance, off: pos.sub(h.point), t: performance.now() };
      return true;
    }
    const g = grabs[hand];
    if (!g) return false;
    if (!squeeze.pressed) {
      grabs[hand] = null;
      return true;
    }
    const ray = rays[hand];
    if (!ray) return true;
    const now = performance.now();
    g.dist = pushPull(g.dist, push, Math.min(0.1, (now - g.t) / 1000));
    g.t = now;
    const pos = ray.at(g.dist, new THREE.Vector3()).add(g.off);
    const yaw = Math.atan2(s.head.position.x - pos.x, s.head.position.z - pos.z);
    if (g.target instanceof Keyboard) {
      placeKb({ position: pos, yaw, pitch: kbPose.pitch });
      kbPinned = true;
    } else {
      anims.delete(g.target);
      g.target.place({ position: pos, yaw, pitch: g.target.pose.pitch });
      g.target.pinned = true;
    }
    return true;
  }

  // ---- The hover box and the dot where each ray is ----

  const marks = new Marks(group, ORDER.hover);
  function showHover(hand: Hand) {
    const h = lookOn[hand];
    marks.dotAt(hand, h?.point ?? null, s.head.position);
    const p = h ? ([win, sheet, hud, hint].find((d) => d.id === h.panel) ?? null) : null;
    marks.boxOn(hand, p, p === hint ? hands[hand].chip : p ? bridge.hot(hand) : null);
  }

  // ---- Each frame ----

  const debug = (window as unknown as { __vr?: VrDebug }).__vr;

  s.tick('hud', ({ dt, now }) => {
    const hp = head();
    const top = document.getElementById('modal-root')?.lastElementChild?.firstElementChild ?? null;
    if (top !== winRoot) {
      winRoot = top;
      options.close();
      if (!top) {
        for (const p of [win, sheet]) {
          p.show(false);
          p.unwatchAll();
        }
      }
      layoutWindow(true);
    } else layoutWindow(false);
    if (options.open && !options.visible()) options.close();
    layoutHud();
    layoutHint();

    // Where each goes: eased back in front of you, or after your gaze.
    for (const p of [win, sheet, hud]) {
      if (!p.shown) continue;
      const a = anims.get(p);
      if (a) {
        a.t = Math.min(1, a.t + dt / FOLLOW.ease);
        p.place(easePose(a.from, a.to, a.t));
        if (a.t >= 1) anims.delete(p);
        continue;
      }
      const f = follow.get(p) ?? { away: 0 };
      follow.set(p, f);
      if (!HANDS.some((hd) => grabs[hd]?.target === p) && shouldRecenter(f, hp, p.pose.position, dt, p.pinned)) ahead(p, p === win ? 'window' : 'sheet', true);
      p.lookedAt = offGaze(hp, p.pose.position) < 40;
    }
    aim = lazyAim(aim, hp, dt);
    hint.place(hintPose(hp, aim));
    hint.lookedAt = true;
    if (kb.shown && !kbPinned && !HANDS.some((hd) => grabs[hd]?.target === kb)) {
      if (win.shown) keyboardHere();
      else {
        const f = follow.get(kb) ?? { away: 0 };
        follow.set(kb, f);
        if (shouldRecenter(f, hp, kbPose.position, dt)) keyboardHere();
      }
    }
    if (kb.auto && !isEditable(focusedElement())) {
      unfocusedSince ||= now;
      if (now - unfocusedSince > 300) kb.hide();
    } else unfocusedSince = 0;
    kb.update(now);

    // Painting, a few ms of it a frame; the live quads; the hover boxes.
    const t0 = performance.now();
    const until = t0 + BUDGET;
    const focus = focusedElement();
    for (const p of doms) {
      if (performance.now() >= until) break;
      if (!p.painting && p.due(now)) p.start(now, focus);
      if (p.painting) p.step(until, renderer);
    }
    lastPaintMs += (performance.now() - t0 - lastPaintMs) * SMOOTH;
    for (const p of doms) p.updateSubs(now, 30);
    for (const hd of HANDS) showHover(hd);
    bridge.settle();
    bridge.frame++;
  });

  const host = {
    get busy() {
      return !!winRoot || hud.shown || kb.shown;
    },
    hit,
    point,
    worldClick,
    grab,
    back(): boolean {
      const act = backAction({ options: options.visible(), window: !!winRoot, keyboard: kb.shown, sheet: hud.shown });
      if (act === 'options') options.close();
      else if (act === 'keyboard') kb.hide();
      else if (act === 'sheet') toggleSheet();
      return act !== 'escape';
    },
    toggleSheet,
    toggleKeyboard() {
      if (kb.shown) return kb.hide();
      kb.show(false);
      keyboardHere();
    },
    add(p: NativePanel) {
      natives.push(p);
      return () => {
        const i = natives.indexOf(p);
        if (i >= 0) natives.splice(i, 1);
      };
    },
    ids: () => targets().map((t) => t.id),
    get lastPaintMs() {
      return lastPaintMs;
    },
  };
  if (debug) debug.panels = host;

  s.onEnd(() => {
    bridge.cancelAll();
    captures.restore();
    chips.disconnect();
    popups.disconnect();
    document.removeEventListener('focusin', onFocusIn, true);
    restoreChips();
    for (const p of doms) p.dispose();
    kb.dispose();
    options.dispose();
    marks.dispose();
    group.removeFromParent();
    document.documentElement.classList.remove('vr-panels');
    natives.length = 0;
    // Last, so the links list shows on the page you're back on.
    links.restore();
  });

  return host;
}
