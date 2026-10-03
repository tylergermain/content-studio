/** The dram in your hand, over the hint bar: what it is, how much is left, and what its keys do. */
import { SIPS, WHISKY_NAME, nameList } from '../../../shared/whisky';
import { key } from '../../core/hint';
import { h } from '../../ui/dom';
import './ui.css';

/** Who's near enough to raise a glass to (see Partners): their names, whether the nearest is near enough for the glasses to meet, and a key that changes when either does. */
export interface Near {
  names: readonly string[];
  touch: boolean;
  key: string;
}

/** The key that raises your glass to whoever's near with one of theirs. */
export const CHEERS_KEY = 'K';

let el: HTMLElement | null = null;
let shown = { sips: 0, canSip: false, near: '' };

/**
 * Shows the dram in your hand, `sips` left (none: no glass, and it's hidden), whether E sips it (there's
 * nothing in front of you that E would use instead), and who K clinks with. Every frame, so it does
 * nothing unless what it says changed.
 */
export function showDram(sips: number, canSip: boolean, near: Near) {
  if (sips === shown.sips && (!sips || (canSip === shown.canSip && near.key === shown.near))) return;
  shown = { sips, canSip, near: near.key };
  if (!sips) {
    el?.remove();
    el = null;
    return;
  }
  if (!el) {
    el = h('div.dram', { role: 'status', 'aria-label': 'Your dram' });
    (document.getElementById('hud') ?? document.body).append(el);
  }
  const level = h('span.level', { 'aria-label': `${sips} of ${SIPS} sips left` }, ...Array.from({ length: SIPS }, (_, i) => h(i < sips ? 'span.on' : 'span')));
  el.replaceChildren(
    h('span.title', {}, `🥃 ${WHISKY_NAME}`),
    level,
    ...(canSip ? [key('E', 'Sip')] : []),
    near.names.length
      ? h('span.near', {}, key(CHEERS_KEY, near.touch ? `Clink glasses with ${nameList(near.names)}` : `Raise a glass to ${nameList(near.names)}`))
      : h('span', { style: 'opacity:.7' }, 'find someone with a glass to clink'),
  );
}
