/**
 * The 🥽 Enter VR button, bottom right of the office (button.css). It's only put there where a VR
 * headset is (see installVr); in VR it reads Leave VR, for the HUD's floating sheet.
 */
import './button.css';
import { h } from '../../ui/dom';

export interface VrButton {
  readonly el: HTMLButtonElement;
  /** Enter VR, Leave VR, or starting (greyed). */
  set(state: 'enter' | 'leave' | 'busy'): void;
}

/** Puts the button in the HUD; `onClick` gets every press. */
export function vrButton(onClick: () => void): VrButton {
  const label = h('span.lbl', {}, 'Enter VR');
  const el = h('button.btn.vr-btn', { id: 'vr-enter', type: 'button', title: 'Put on your headset and step into the office' }, '🥽', label);
  el.addEventListener('click', () => {
    // First, while the click still counts as one (a headset is only asked for from a click).
    onClick();
    // The game keeps the keys: Space or Enter mustn't press this again.
    el.blur();
  });
  document.getElementById('hud')!.append(el);
  return {
    el,
    set(state) {
      label.textContent = state === 'leave' ? 'Leave VR' : state === 'busy' ? 'Starting VR…' : 'Enter VR';
      el.title = state === 'leave' ? 'Back to the screen' : 'Put on your headset and step into the office';
      el.setAttribute('aria-busy', String(state === 'busy'));
    },
  };
}
