/** The dram in your hand, over the hint bar: what it is, how much is left, and what its keys do. */
import { SIPS, WHISKY_NAME, nameList } from '../../../shared/whisky';
import { key } from '../../core/hint';
import { h } from '../../ui/dom';
import './ui.css';

export interface DramShown {
  /** Sips left; none is no glass in hand. */
  sips: number;
  /** E sips: there's nothing in front of you that E would use instead. */
  canSip: boolean;
  /** Who's near enough to clink with, by name: C raises your glass to them. */
  near: readonly string[];
}

let el: HTMLElement | null = null;
let shownKey = '';

/** Shows (or hides, with no sips) the dram in your hand, only when what it says changed. */
export function showDram(d: DramShown) {
  const k = d.sips ? `${d.sips}|${d.canSip}|${d.near.join(',')}` : '';
  if (k === shownKey) return;
  shownKey = k;
  if (!d.sips) {
    el?.remove();
    el = null;
    return;
  }
  if (!el) {
    el = h('div.dram', { role: 'status', 'aria-label': 'Your dram' });
    (document.getElementById('hud') ?? document.body).append(el);
  }
  const level = h('span.level', { 'aria-label': `${d.sips} of ${SIPS} sips left` }, ...Array.from({ length: SIPS }, (_, i) => h(i < d.sips ? 'span.on' : 'span')));
  el.replaceChildren(
    h('span.title', {}, `🥃 ${WHISKY_NAME}`),
    level,
    ...(d.canSip ? [key('E', 'Sip')] : []),
    d.near.length ? h('span.near', {}, key('C', `Cheers with ${nameList(d.near)}`)) : h('span', { style: 'opacity:.7' }, 'find someone with a glass to clink'),
  );
}
