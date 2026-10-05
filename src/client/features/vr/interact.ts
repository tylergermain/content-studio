/**
 * What the controllers' buttons do in VR (docs/vr.md has the table). The pointing hand's ray aims for
 * the office instead of the crosshair (input/pointer.ts's setAim), with reach measured from your head,
 * so the hint bar and every kind's reach mean what they do on a screen.
 *
 * - Trigger: on a panel, a click there (panels/). Off the panels with a window up, a click into the
 *   world under it (the office builder's floor). Otherwise it's E, pressed and held for as long as the
 *   trigger is, so the whole key chain runs as it does on a keyboard: sitting, desks, the coffee, the
 *   ball's wind-up, the elevator. Where E would fly the camera about (VR_BLOCKED) it says so instead.
 * - Grip: on a panel, takes hold of it to move it; otherwise Space (jump, or up off a seat).
 * - B / Y: back (the panels' say first: the keyboard, the HUD), else Escape, which closes the top window
 *   exactly as the key does.
 * - X: the HUD sheet. A: the keyboard; held in a text field that has a 🎤, push to talk (Ctrl+Space).
 * - Both sticks clicked: the perf overlay.
 *
 * Which way a press goes is settled when it goes down and kept until it comes up, wherever the ray
 * wanders meanwhile; a key pressed by both hands at once is held until both let go.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import type { Frame } from '../../core/registry';
import { isTyping } from '../../player';
import { modalOpen, toast } from '../../ui/dom';
import { beam } from './controllers';
import { IDLE, VR_BLOCKED, aPress, triggerRoute, type TriggerRoute } from './input-map';
import { focusedElement, keyDown, keyUp, tapKey } from './keys';
import type { Btn, Hand, PanelHit, PanelHost, VrControllers, VrPerf, VrSession } from './types';

const HANDS: readonly Hand[] = ['left', 'right'];
/** The hint bar's panel (its id starts so): pointing at it keeps aiming where you were, since its chips are for that. */
const HINT_PANEL = /^hint/;
/** How long the pointer reaches, in meters, for the hand that's aiming and the other one. */
const REACH_LONG = 1.6;
const REACH_SHORT = 0.35;

interface HandState {
  trigger: TriggerRoute | null;
  grip: 'grab' | 'key' | null;
}

/** Wires the controllers' buttons to the office for the session (see the file's note). */
export function startInteract(ctx: Ctx, parts: Pick<Parts, 'pointer'>, s: VrSession, pads: VrControllers, panels: PanelHost, perf: VrPerf): void {
  const { pointer } = parts;
  const state: Record<Hand, HandState> = { left: { trigger: null, grip: null }, right: { trigger: null, grip: null } };
  const hits: Record<Hand, PanelHit | null> = { left: null, right: null };
  const held = holder(ctx.canvas);

  // ---- Aiming: the pointing hand's ray, unless it's on a panel ----
  /** The last ray that pointed into the world, kept while the ray's on the hint bar so its chips act on what you were aiming at. */
  const lastRay = new THREE.Ray();
  let aimed = false;
  pointer.setAim({
    ray: () => {
      const h = pads.byHand(pads.dominant);
      if (!h.connected) return null;
      const hit = panels.hit(h.ray);
      if (!hit) {
        aimed = true;
        return lastRay.copy(h.ray);
      }
      return HINT_PANEL.test(hit.panel) && aimed ? lastRay : null;
    },
    eye: () => s.head.position,
  });

  // ---- A: a tap shows the keyboard; held in a field with a 🎤, push to talk ----
  let aDownAt = 0;
  /** Where push to talk went, while A holds it; or 'done' once A's press has done what it does. */
  let talk: HTMLElement | 'done' | null = null;
  function pressA(a: Btn, now: number) {
    if (a.down) {
      aDownAt = now;
      talk = null;
    }
    if (a.pressed && talk === null) {
      const field = focusedElement();
      const mic = !!field && isTyping() && !!(field.closest('.backdrop') ?? field.ownerDocument.body).querySelector('.dictate-mic');
      const what = aPress(now - aDownAt, mic);
      if (what === 'keyboard') {
        panels.toggleKeyboard();
        talk = 'done';
      } else if (what === 'talk' && field) {
        keyDown('Space', { ctrl: true, target: field });
        talk = field;
      }
    }
    if (a.up) {
      if (talk === null) panels.toggleKeyboard();
      else if (talk !== 'done') keyUp('Space', { ctrl: true, target: talk });
      talk = null;
    }
  }

  // ---- Each frame, once the pointer has found what the aiming hand points at ----
  s.tick('aim', ({ now }: Frame) => {
    const windowUp = modalOpen();
    for (const hand of HANDS) {
      const p = pads.byHand(hand);
      hits[hand] = p.connected ? panels.hit(p.ray) : null;
    }
    // The right stick scrolls whichever panel a ray is on, the right hand's first.
    const scrolling: Hand | null = hits.right ? 'right' : hits.left ? 'left' : null;
    const dominant = pads.dominant;

    for (const hand of HANDS) {
      const p = pads.byHand(hand);
      const st = state[hand];
      const hit = hits[hand];
      const t = p.trigger;

      // The trigger.
      if (t.down) {
        const target = pointer.target();
        st.trigger = triggerRoute({ onPanel: !!hit, windowUp, blocked: !!target && VR_BLOCKED.has(target.kind) });
        if (st.trigger === 'key') {
          // Like clicking the scene, it takes the focus off a text box (the chat) you were in.
          if (isTyping()) (document.activeElement as HTMLElement | null)?.blur?.();
          held.press('KeyE');
          if (target) p.pulse(0.35, 30);
        } else if (st.trigger === 'blocked') toast('Not in VR yet');
        else if (st.trigger === 'panel') p.pulse(0.2, 15);
      }
      // Every panel hears where each ray is (hover, and leaving), and the trigger when the press is theirs;
      // the right stick scrolls, unless it's pushing away the panel its hand holds.
      const scroll = scrolling === hand && !(hand === 'right' && st.grip === 'grab') ? pads.right.stick.y : 0;
      panels.point(hand, hit, st.trigger === 'panel' ? t : IDLE, scroll);
      // Under a window, the world off its panel (the builder's floor): the aiming hand's hover, and a press that went there to its end.
      if (st.trigger === 'world' || (windowUp && !hit && hand === dominant && p.connected)) {
        panels.worldClick(hand, p.connected ? worldPoint(ctx, p.ray) : null, st.trigger === 'world' ? t : IDLE);
      }
      if (!t.pressed) {
        if (st.trigger === 'key') held.release('KeyE');
        st.trigger = null;
      }

      // The grip: hold of a panel, or Space.
      const g = p.squeeze;
      const push = -p.stick.y;
      if (g.down) {
        if (panels.grab(hand, hit, g, push)) st.grip = 'grab';
        else if (!windowUp) {
          st.grip = 'key';
          held.press('Space');
        }
      } else if (st.grip === 'grab') panels.grab(hand, hit, g, push);
      if (!g.pressed) {
        if (st.grip === 'key') held.release('Space');
        st.grip = null;
      }

      // B / Y: back; Escape goes where a key would, so the top window's own Esc handler closes it.
      if (p.secondary.down && !panels.back()) tapKey('Escape');

      // The pointer: to the panel it's on, else a long one for the aiming hand (warm on something to use).
      if (hit) beam(p, hit.distance, true, true);
      else beam(p, hand === dominant && !windowUp ? REACH_LONG : REACH_SHORT, hand === dominant && !windowUp && !!pointer.target(), false);
    }

    if (pads.left.primary.down) panels.toggleSheet();
    pressA(pads.right.primary, now);
    const { left, right } = pads;
    if ((left.stickPress.down || right.stickPress.down) && left.stickPress.pressed && right.stickPress.pressed) perf.toggle();
  });

  s.onEnd(() => {
    pointer.setAim(null);
    held.releaseAll();
    if (talk instanceof HTMLElement) keyUp('Space', { ctrl: true, target: talk });
  });
}

/**
 * Keys held for the controllers, sent to the office's canvas (not a text box that has the focus):
 * down when the first hand presses one, up when the last lets go.
 */
function holder(canvas: HTMLCanvasElement) {
  const count = new Map<string, number>();
  return {
    press(code: string) {
      const n = count.get(code) ?? 0;
      count.set(code, n + 1);
      if (!n) keyDown(code, { target: canvas });
    },
    release(code: string) {
      const n = count.get(code) ?? 0;
      if (!n) return;
      count.set(code, n - 1);
      if (n === 1) keyUp(code, { target: canvas });
    },
    releaseAll() {
      for (const [code, n] of count) if (n) keyUp(code, { target: canvas });
      count.clear();
    },
  };
}

const raycaster = new THREE.Raycaster();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const onFloor = new THREE.Vector3();

/**
 * Where a ray meets the office (the floor you're on, if it misses everything nearer), for a click
 * into the world under a window (see PanelHost.worldClick); null when it points at the sky.
 */
function worldPoint(ctx: Ctx, ray: THREE.Ray): THREE.Vector3 | null {
  raycaster.set(ray.origin, ray.direction);
  raycaster.camera = ctx.camera;
  raycaster.far = 60;
  for (const hit of raycaster.intersectObject(ctx.office.group, true)) {
    let shown = true;
    for (let o: THREE.Object3D | null = hit.object; o && shown; o = o.parent) shown = o.visible;
    if (shown) return hit.point;
  }
  floor.constant = -ctx.player.pos.y;
  const at = ray.intersectPlane(floor, onFloor);
  return at && at.distanceTo(ray.origin) < 60 ? at.clone() : null;
}
