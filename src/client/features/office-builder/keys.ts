/**
 * The builder's keys: Escape, undo and redo, another one, save, turning, nudging and removing what's
 * picked, and the keys held down to move the camera. What each does to the draft is mode.ts's to say.
 */
import { SNAP } from '../../../shared/office-builder';
import { isTyping } from '../../player';
import type { DraftLayout } from './draft';
import type { BuilderCamera } from './view';

const CAMERA_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const NUDGE: Record<string, [right: number, ahead: number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export interface BuilderKeysDeps {
  cam: BuilderCamera;
  draft: DraftLayout;
  /** A change to what's picked: `make` says why it couldn't be made, if it couldn't (see change in mode.ts). */
  change(make: (id: string) => string | undefined): void;
  /** Whether the builder's the window on top (not the desk sign's editor over it). */
  onTop(): boolean;
  /** Whether it's asking before it closes: nothing but Escape is taken then. */
  asking(): boolean;
  /** Whether something's picked, for the arrows to nudge: with nothing picked they slide the view. */
  picked(): boolean;
  /** Escape, unless it's a text box's: out of the question, the drag, what's picked or the builder, whichever's first. */
  escape(): void;
  /** Ctrl/⌘ Z and Y: back to before the last change, or (`again`) on to the one just undone. */
  step(again: boolean): unknown;
  duplicate(): void;
  save(): void;
  remove(): void;
}

/** Takes the keys for the builder from when it's made until `stop()`. */
export function createBuilderKeys(deps: BuilderKeysDeps) {
  const { cam, draft } = deps;
  /** The camera's keys that are down. */
  const held = new Set<string>();

  /** An arrow key with something picked: it goes a step that way, the way the screen has it. */
  function nudge([right, ahead]: [number, number]) {
    // The nearest of the floor's own four ways to the screen's.
    const q = (Math.round(cam.yaw / (Math.PI / 2)) * Math.PI) / 2;
    const c = Math.round(Math.cos(q));
    const s = Math.round(Math.sin(q));
    deps.change((id) => {
      const p = draft.pose(id)!;
      return draft.edit(() => draft.setPose(id, p.x + (c * right - s * ahead) * SNAP, p.z + (-s * right - c * ahead) * SNAP, p.rotY), id);
    });
  }

  function keyDown(e: KeyboardEvent) {
    if (!deps.onTop()) return;
    const take = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Escape') {
      take();
      if (isTyping(e)) return (e.target as HTMLElement).blur();
      return deps.escape();
    }
    if (isTyping(e) || deps.asking()) return;
    const act = (run: () => unknown) => {
      take();
      run();
    };
    if (e.metaKey || e.ctrlKey) {
      if (e.code === 'KeyZ') act(() => deps.step(e.shiftKey));
      else if (e.code === 'KeyY') act(() => deps.step(true));
      else if (e.code === 'KeyD') act(deps.duplicate);
      else if (e.code === 'KeyS') act(deps.save);
      return;
    }
    if (e.code === 'KeyR') act(() => deps.change((id) => draft.turn(id, e.shiftKey ? -1 : 1)));
    else if (e.code === 'Delete' || e.code === 'Backspace') act(deps.remove);
    else if (deps.picked() && NUDGE[e.code]) act(() => nudge(NUDGE[e.code]));
    else if (CAMERA_KEYS.has(e.code)) act(() => held.add(e.code));
  }
  const keyUp = (e: KeyboardEvent) => held.delete(e.code);
  const letGo = () => held.clear();

  window.addEventListener('keydown', keyDown, true);
  window.addEventListener('keyup', keyUp, true);
  window.addEventListener('blur', letGo);

  return {
    /** The camera's keys that are down slide it, turn it and zoom it, for a frame `dt` long. */
    steer(dt: number) {
      const on = (code: string) => (held.has(code) ? 1 : 0);
      const far = cam.dist * 0.9 * dt;
      cam.pan((on('KeyD') + on('ArrowRight') - on('KeyA') - on('ArrowLeft')) * far, (on('KeyW') + on('ArrowUp') - on('KeyS') - on('ArrowDown')) * far);
      cam.yaw += (on('KeyQ') - on('KeyE')) * 1.6 * dt;
      cam.dist *= Math.exp((on('Minus') - on('Equal')) * 1.4 * dt);
    },
    stop() {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', letGo);
    },
  };
}
